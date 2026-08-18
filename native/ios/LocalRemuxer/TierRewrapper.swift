//
//  TierRewrapper.swift
//  TomoTV
//
//  Slipstream (memories/CLAUDE-slipstream.md): stateless per-segment rewrap of
//  a server tier's MPEG-TS segment into an fMP4 media segment on the session
//  timeline. The server cuts on the source-keyframe grid the session adopted,
//  so segment n here IS segment n of the primary variant's timeline; this only
//  changes the wrapper and the timestamps, never the samples.
//
//  movenc accepts Annex-B H.264 from a TS demux directly — verified against
//  lavf with a real Jellyfin segment (no auto-inserted bitstream filter; the
//  muxer converts startcodes to length prefixes and builds avcC itself).
//  Audio is dropped: tier variants are video-only, the shared audio group
//  carries sound (original bits, always).
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg macros are invisible to Swift; same literals the sibling files define.
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE: Int32 = 1_000_000
private let SWIFT_AVFMT_FLAG_BITEXACT: Int32 = 0x0400
private let SWIFT_AV_INPUT_BUFFER_PADDING_SIZE = 64

private func tierErr(_ code: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buf, buf.count)
    return String(cString: buf)
}

/// In-memory byte sources/sinks for the FFmpeg custom-IO callbacks.
private final class TierBuffer {
    var input: Data
    var readOffset = 0
    var output = Data()
    init(input: Data) { self.input = input }
}

private let tierReadCallback: @convention(c) (UnsafeMutableRawPointer?, UnsafeMutablePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
    guard let opaque, let buf, size > 0 else { return SWIFT_AVERROR_EOF }
    let holder = Unmanaged<TierBuffer>.fromOpaque(opaque).takeUnretainedValue()
    let remaining = holder.input.count - holder.readOffset
    guard remaining > 0 else { return SWIFT_AVERROR_EOF }
    let n = min(Int(size), remaining)
    holder.input.withUnsafeBytes { raw in
        buf.update(from: raw.baseAddress!.advanced(by: holder.readOffset).assumingMemoryBound(to: UInt8.self), count: n)
    }
    holder.readOffset += n
    return Int32(n)
}

private let tierWriteCallback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
    guard let opaque, let buf, size > 0 else { return size }
    let holder = Unmanaged<TierBuffer>.fromOpaque(opaque).takeUnretainedValue()
    holder.output.append(buf, count: Int(size))
    return size
}

struct TierRewrapped {
    /// ftyp + moov — byte-stable across segments (bitexact muxing, same SPS/PPS).
    let initSegment: Data
    /// styp + moof + mdat, timestamps on the session timeline.
    let mediaSegment: Data
}

enum TierRewrapper {
    /// Rewrap one server TS segment to an fMP4 fragment starting at
    /// `targetStartSeconds` on the session timeline. Pure function of its
    /// inputs; every FFmpeg context lives and dies inside the call, so
    /// concurrent segment requests need no shared state.
    static func rewrap(tsData: Data, targetStartSeconds: Double) -> TierRewrapped? {
        let holder = TierBuffer(input: tsData)
        let opaque = Unmanaged.passUnretained(holder).toOpaque()

        // ---- Input: the TS segment from memory ----
        let inBufSize = 1 << 16
        guard let inBuf = av_malloc(inBufSize) else { return nil }
        guard let inAvio = avio_alloc_context(inBuf.assumingMemoryBound(to: UInt8.self), Int32(inBufSize), 0, opaque, tierReadCallback, nil, nil) else {
            av_free(inBuf)
            return nil
        }
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard inputCtx != nil else {
            var freeing: UnsafeMutablePointer<AVIOContext>? = inAvio
            av_free(inAvio.pointee.buffer)
            avio_context_free(&freeing)
            return nil
        }
        inputCtx!.pointee.pb = inAvio
        var ret = avformat_open_input(&inputCtx, nil, nil, nil)
        guard ret >= 0, let input = inputCtx else {
            NSLog("[TierRewrapper] open_input: %@", tierErr(ret))
            var freeing: UnsafeMutablePointer<AVIOContext>? = inAvio
            av_free(inAvio.pointee.buffer)
            avio_context_free(&freeing)
            return nil
        }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
            var freeing: UnsafeMutablePointer<AVIOContext>? = inAvio
            av_free(inAvio.pointee.buffer)
            avio_context_free(&freeing)
        }
        ret = avformat_find_stream_info(input, nil)
        guard ret >= 0 else {
            NSLog("[TierRewrapper] find_stream_info: %@", tierErr(ret))
            return nil
        }
        let videoIndex = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard videoIndex >= 0, let inStream = input.pointee.streams[Int(videoIndex)] else {
            NSLog("[TierRewrapper] no video stream in tier segment")
            return nil
        }

        // ---- Output: fragmented MP4 into memory ----
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        ret = avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil)
        guard ret >= 0, let output = outputCtx else { return nil }
        guard let outBufRaw = av_malloc(inBufSize) else {
            avformat_free_context(output)
            return nil
        }
        guard let outAvio = avio_alloc_context(outBufRaw.assumingMemoryBound(to: UInt8.self), Int32(inBufSize), 1, opaque, nil, tierWriteCallback, nil) else {
            av_free(outBufRaw)
            avformat_free_context(output)
            return nil
        }
        output.pointee.pb = outAvio
        // Deterministic bytes: the init segment must be identical whichever
        // segment produced it, since every media segment references one map.
        output.pointee.flags |= SWIFT_AVFMT_FLAG_BITEXACT
        defer {
            var freeing: UnsafeMutablePointer<AVIOContext>? = outAvio
            av_free(outAvio.pointee.buffer)
            avio_context_free(&freeing)
            avformat_free_context(output)
        }

        guard let outStream = avformat_new_stream(output, nil) else { return nil }
        ret = avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar)
        guard ret >= 0 else { return nil }
        outStream.pointee.time_base = inStream.pointee.time_base
        outStream.pointee.codecpar.pointee.codec_tag = 0

        // Header is written lazily on the first video packet, not here: with
        // empty_moov the moov (and its avcC) is emitted at write_header from
        // codecpar.extradata, and this build's TS demux leaves extradata EMPTY
        // for Annex-B H.264 (measured: extradata_size=0 after find_stream_info
        // on a real Jellyfin segment). The hollow avcC made AVPlayer's byte
        // pump reject every sample (-19601). SPS/PPS live in-band before the
        // opening IDR; they are lifted into extradata before the header goes out.
        var headerWritten = false
        func writeHeaderIfNeeded(firstPacket: UnsafeMutablePointer<AVPacket>) -> Bool {
            if headerWritten { return true }
            let par = outStream.pointee.codecpar!
            if par.pointee.extradata_size == 0, let parameterSets = annexBParameterSets(firstPacket) {
                let padded = parameterSets.count + SWIFT_AV_INPUT_BUFFER_PADDING_SIZE
                if let buf = av_mallocz(padded) {
                    parameterSets.withUnsafeBytes { raw in
                        buf.copyMemory(from: raw.baseAddress!, byteCount: parameterSets.count)
                    }
                    par.pointee.extradata = buf.assumingMemoryBound(to: UInt8.self)
                    par.pointee.extradata_size = Int32(parameterSets.count)
                }
            }
            // Same fragment shape as the primary variant's muxer (buildMuxer):
            // one moof per segment, no sidx, styp prepended by the caller's shape.
            // frag_discont + avoid_negative_ts disabled: each segment is its own
            // muxer session, and without these movenc rebases the first dts to
            // zero — every tier segment landed at tfdt=0 instead of its grid
            // position (measured on real server segments).
            output.pointee.avoid_negative_ts = 0
            var muxOpts: OpaquePointer? = nil
            av_dict_set(&muxOpts, "movflags", "empty_moov+default_base_moof+frag_custom+frag_discont", 0)
            let hret = avformat_write_header(output, &muxOpts)
            av_dict_free(&muxOpts)
            guard hret >= 0 else {
                NSLog("[TierRewrapper] write_header: %@", tierErr(hret))
                return false
            }
            headerWritten = true
            return true
        }

        // ---- Copy video packets, shifted onto the session timeline ----
        // Shift anchors the first DTS to the adopted segment start, so the
        // fragment's tfdt (baseMediaDecodeTime) lands exactly on the grid;
        // presentation runs one reorder delay later, uniform across segments.
        // A pts anchor would push seg0's dts negative, which tfdt (unsigned)
        // cannot carry.
        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        guard let pkt = packet else { return nil }
        var shift: Int64? = nil
        let targetInTb = av_rescale_q(Int64(targetStartSeconds * Double(SWIFT_AV_TIME_BASE)), AVRational(num: 1, den: SWIFT_AV_TIME_BASE), inStream.pointee.time_base)
        var wrote = false
        while av_read_frame(input, pkt) >= 0 {
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIndex else { continue }
            if shift == nil {
                let anchor = pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE ? pkt.pointee.dts : pkt.pointee.pts
                if anchor != SWIFT_AV_NOPTS_VALUE {
                    shift = targetInTb - anchor
                }
            }
            guard let s = shift else { continue }
            // TS packets can carry partial timing. movenc requires BOTH stamps
            // on every packet — a NOPTS write produced a fragment whose
            // timebase AVPlayer rejected (-19601, first live session). Fill
            // the missing side from the other; drop a packet with neither.
            var pts = pkt.pointee.pts
            var dts = pkt.pointee.dts
            if pts == SWIFT_AV_NOPTS_VALUE && dts == SWIFT_AV_NOPTS_VALUE { continue }
            if pts == SWIFT_AV_NOPTS_VALUE { pts = dts }
            if dts == SWIFT_AV_NOPTS_VALUE { dts = pts }
            pkt.pointee.pts = pts + s
            pkt.pointee.dts = dts + s
            pkt.pointee.stream_index = 0
            guard writeHeaderIfNeeded(firstPacket: pkt) else { return nil }
            ret = av_interleaved_write_frame(output, pkt)
            if ret < 0 {
                NSLog("[TierRewrapper] write_frame: %@", tierErr(ret))
                return nil
            }
            wrote = true
        }
        guard wrote else {
            NSLog("[TierRewrapper] tier segment carried no video packets")
            return nil
        }
        av_write_trailer(output)

        // ---- Split init (ftyp+moov) from the fragment at the first moof ----
        let bytes = holder.output
        guard let moofRange = bytes.range(of: Data("moof".utf8)), moofRange.lowerBound >= 4 else {
            NSLog("[TierRewrapper] no moof in rewrapped output (%d bytes)", bytes.count)
            return nil
        }
        let fragmentStart = moofRange.lowerBound - 4
        let initSegment = bytes.subdata(in: 0..<fragmentStart)
        // The trailer appends an mfra box after the last fragment; an HLS media
        // segment is moof+mdat only, so the walk keeps exactly those.
        var mediaSegment = RemuxSession.stypBox
        var off = fragmentStart
        while off + 8 <= bytes.count {
            let size = Int(bytes[off]) << 24 | Int(bytes[off + 1]) << 16 | Int(bytes[off + 2]) << 8 | Int(bytes[off + 3])
            guard size >= 8, off + size <= bytes.count else { break }
            let type = bytes.subdata(in: (off + 4)..<(off + 8))
            if type == Data("moof".utf8) || type == Data("mdat".utf8) {
                mediaSegment += bytes.subdata(in: off..<(off + size))
            }
            off += size
        }
        return TierRewrapped(initSegment: initSegment, mediaSegment: mediaSegment)
    }

    /// Concatenated SPS+PPS NAL units (with start codes) from an Annex-B
    /// H.264 access unit, movenc's expected extradata shape for conversion to
    /// avcC. Returns nil when the packet carries no parameter sets.
    private static func annexBParameterSets(_ pkt: UnsafeMutablePointer<AVPacket>) -> Data? {
        guard let base = pkt.pointee.data, pkt.pointee.size > 4 else { return nil }
        let data = Data(bytes: base, count: Int(pkt.pointee.size))
        var out = Data()
        var i = 0
        while i + 4 <= data.count {
            // 3- or 4-byte start code.
            let isStart4 = data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && i + 4 < data.count && data[i + 3] == 1
            let isStart3 = data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1
            guard isStart4 || isStart3 else {
                i += 1
                continue
            }
            let nalStart = i + (isStart4 ? 4 : 3)
            guard nalStart < data.count else { break }
            // Find the next start code to bound this NAL.
            var j = nalStart
            var nalEnd = data.count
            while j + 3 <= data.count {
                if data[j] == 0 && data[j + 1] == 0 && (data[j + 2] == 1 || (j + 4 <= data.count && data[j + 2] == 0 && data[j + 3] == 1)) {
                    nalEnd = j
                    break
                }
                j += 1
            }
            let nalType = data[nalStart] & 0x1F
            if nalType == 7 || nalType == 8 {
                out += Data([0, 0, 0, 1]) + data.subdata(in: nalStart..<nalEnd)
            }
            i = nalEnd
        }
        return out.isEmpty ? nil : out
    }
}
