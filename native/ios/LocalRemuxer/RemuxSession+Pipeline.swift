//
//  RemuxSession+Pipeline.swift
//  TomoTV
//
//  The FFmpeg pipeline: input open, stream-copy / VideoToolbox transcode,
//  fragment segmentation, seek-restart, and the per-rendition muxers. Split
//  out of Remuxer.swift for readability; behaviour is unchanged. The FFmpeg
//  macro constants below are file-private here because other engine files keep
//  their own copies.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's error/constant macros don't survive the Clang importer.
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')
private let SWIFT_AVERROR_EXIT: Int32 = -1_414_092_869 // FFERRTAG('E','X','I','T')
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE: Int32 = 1_000_000
private let SWIFT_AVSEEK_FLAG_BACKWARD: Int32 = 1

private func averr(_ code: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buf, buf.count)
    return String(cString: buf)
}

extension RemuxSession {
    // MARK: - FFmpeg pipeline

    /// Open and probe errors no retry fixes: no demuxer, protocol or decoder, and the HTTP 4xx a
    /// server answers for good. FFERRTAG(0xF8, a, b, c), since the macros do not import.
    static let permanentInputErrors: Set<Int32> = Set(["DEM", "PRO", "DEC", "400", "401", "403", "404", "4XX"].map { tag in
        let bytes = Array(tag.utf8)
        return -(0xF8 | Int32(bytes[0]) << 8 | Int32(bytes[1]) << 16 | Int32(bytes[2]) << 24)
    })

    static func isPermanentInputError(_ code: Int32) -> Bool { permanentInputErrors.contains(code) }

    /// Interrupt callback: aborts blocking network I/O when the session dies.
    static let interruptCallback: @convention(c) (UnsafeMutableRawPointer?) -> Int32 = { opaque in
        guard let opaque else { return 0 }
        let session = Unmanaged<RemuxSession>.fromOpaque(opaque).takeUnretainedValue()
        return session.isCancelled || session.hasFailed ? 1 : 0
    }

    /// Muxer output goes to the rendition that owns the AVIO context, so the
    /// opaque pointer is the Rendition rather than the session. Touched only
    /// from the pipeline thread (every av_* output call happens there).
    static let writeCallback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
        guard let opaque, let buf, size > 0 else { return size }
        let rendition = Unmanaged<Rendition>.fromOpaque(opaque).takeUnretainedValue()
        rendition.pending.append(buf, count: Int(size))
        return size
    }

    /// Byte offset of the first `moof` box, walking the ISO-BMFF box chain
    /// rather than scanning for the literal, so payload bytes can never be
    /// mistaken for a box header. Returns 0 when the data already starts with
    /// a fragment, nil when no `moof` is present.
    static func firstFragmentOffset(in data: Data) -> Int? {
        var offset = 0
        while offset + 8 <= data.count {
            let size = data.withUnsafeBytes { raw -> UInt64 in
                let b = raw.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self)
                return (UInt64(b[0]) << 24) | (UInt64(b[1]) << 16) | (UInt64(b[2]) << 8) | UInt64(b[3])
            }
            let type = String(decoding: data[(offset + 4)..<(offset + 8)], as: UTF8.self)
            if type == "moof" { return offset }

            var boxSize = size
            if boxSize == 1 {
                // 64-bit largesize follows the header
                guard offset + 16 <= data.count else { return nil }
                boxSize = data.withUnsafeBytes { raw -> UInt64 in
                    let b = raw.baseAddress!.advanced(by: offset + 8).assumingMemoryBound(to: UInt8.self)
                    return (0..<8).reduce(UInt64(0)) { ($0 << 8) | UInt64(b[$1]) }
                }
            }
            // Upper bound as well as lower: boxSize is a UInt64 read straight out
            // of the box header, and Int(_:) traps above Int.max. Anything past
            // the buffer ends the walk regardless, so clamping to count is enough.
            guard boxSize >= 8, boxSize <= UInt64(data.count) else { return nil }
            offset += Int(boxSize)
        }
        return nil
    }

    /// Add each track's generation-start DTS back onto every tfdt in the
    /// segment, making baseMediaDecodeTime absolute. The mov muxer normalizes
    /// a track's timeline to the first packet it sees, so without this every
    /// seek-restart produces fragments claiming the file starts over at t=0.
    /// `offsets` maps mp4 track_id (1-based, stream order) to the value to
    /// add, already in that track's timescale (the muxer rewrites the output
    /// stream time base to 1/timescale at write_header, so recorded DTS
    /// values are in the right units).
    static func patchTfdtToAbsolute(in data: inout Data, offsets: [UInt32: Int64]) {
        func u32(_ at: Int) -> UInt32 {
            (UInt32(data[at]) << 24) | (UInt32(data[at + 1]) << 16) | (UInt32(data[at + 2]) << 8) | UInt32(data[at + 3])
        }
        func u64(_ at: Int) -> UInt64 {
            (0..<8).reduce(UInt64(0)) { ($0 << 8) | UInt64(data[at + $1]) }
        }
        func put(_ value: UInt64, at: Int, bytes: Int) {
            for i in 0..<bytes {
                data[at + i] = UInt8((value >> (8 * (bytes - 1 - i))) & 0xFF)
            }
        }
        func boxType(_ at: Int) -> String { String(decoding: data[(at + 4)..<(at + 8)], as: UTF8.self) }

        var offset = 0
        while offset + 8 <= data.count {
            let size = Int(u32(offset))
            guard size >= 8, offset + size <= data.count else { return }
            if boxType(offset) == "moof" {
                var trafOffset = offset + 8
                while trafOffset + 8 <= offset + size {
                    let trafSize = Int(u32(trafOffset))
                    guard trafSize >= 8, trafOffset + trafSize <= offset + size else { break }
                    if boxType(trafOffset) == "traf" {
                        var trackId: UInt32 = 0
                        var child = trafOffset + 8
                        while child + 8 <= trafOffset + trafSize {
                            let childSize = Int(u32(child))
                            guard childSize >= 8, child + childSize <= trafOffset + trafSize else { break }
                            // The size checks below are per-box minimums, not the
                            // `>= 8` bare header the loop guarantees: Data's
                            // subscript is bounds-checked, so reading a field a
                            // short box does not contain traps and kills the
                            // pipeline thread rather than skipping the box.
                            switch boxType(child) {
                            case "tfhd":
                                // 8 header + 4 version/flags + 4 track_ID.
                                guard childSize >= 16 else { break }
                                trackId = u32(child + 12)
                            case "tfdt":
                                guard let add = offsets[trackId], add != 0 else { break }
                                // 8 header + 4 version/flags + 4 (v0) or 8 (v1)
                                // baseMediaDecodeTime.
                                guard childSize >= 16 else { break }
                                // Clamped at 0: an AAC encoder's priming makes a
                                // generation's first audio DTS slightly negative,
                                // and 0 + (-1024) must not wrap around.
                                let version = data[child + 8]
                                if version == 1 {
                                    guard childSize >= 20 else { break }
                                    let absolute = Int64(bitPattern: u64(child + 12)) &+ add
                                    put(UInt64(max(0, absolute)), at: child + 12, bytes: 8)
                                } else {
                                    let absolute = Int64(u32(child + 12)) &+ add
                                    put(UInt64(max(0, absolute)), at: child + 12, bytes: 4)
                                }
                            default:
                                break
                            }
                            child += childSize
                        }
                    }
                    trafOffset += trafSize
                }
            }
            offset += size
        }
    }

    /// Segment type box every HLS fMP4 media segment must start with
    /// (major brand "msdh", compatible with "msdh"/"msix"). AVFoundation
    /// refuses to decode segments that lack it, even though the fragments
    /// themselves are valid.
    static let stypBox: Data = {
        var box = Data()
        box.append(contentsOf: [0, 0, 0, 24])
        box.append(contentsOf: Array("styp".utf8))
        box.append(contentsOf: Array("msdh".utf8))
        box.append(contentsOf: [0, 0, 0, 0])
        box.append(contentsOf: Array("msdh".utf8))
        box.append(contentsOf: Array("msix".utf8))
        return box
    }()

    /// An empty free box: legal anywhere between a segment's boxes, and skipped by every parser.
    static let freeBox = Data([0, 0, 0, 8] + Array("free".utf8))

    /// A source that will not open or cannot be planned, before any master has named the copy: a
    /// session whose rungs can carry it alone lets the source go instead of dying.
    func failStartup(_ message: String, retryable: Bool = false) {
        if retryable, !config.isLive {
            retrySource(because: message)
            return
        }
        guard releaseSource(because: message, unusable: true) else { return fail(message) }
        onStage?(["token": token, "stage": "source_released", "elapsed": Date().timeIntervalSince(startedAt)])
    }

    func fail(_ message: String) {
        if handOverToRungs(because: message) { return }
        NSLog("[LocalRemuxer] Pipeline failed: %@", message)
        stateLock.lock()
        let first = !failed
        failed = true
        stateLock.unlock()
        if first { onFailed?(["token": token, "message": message]) }
    }

    /// One output rendition: its own mp4 muxer, its own byte buffer, its own
    /// segment files. The primary rendition carries video plus the default
    /// audio track; each alternate audio track gets an audio-only rendition so
    /// HLS can offer it for selection.
    ///
    /// The muxer is rebuilt from scratch on every seek-restart because it
    /// requires monotonic DTS across fragments, but the box itself (and its
    /// file naming and completed-segment bookkeeping) outlives that.
    final class Rendition {
        /// "" for the primary, "a1"/"a2"… for alternate audio. Also the file
        /// prefix, so the primary keeps the plain init.mp4/segN.m4s names.
        let prefix: String
        /// Input stream indices this rendition carries.
        let inputStreams: [Int32]
        /// Present when this rendition's audio has to be re-encoded (FLAC where
        /// the source allows it, AAC otherwise); nil means the audio is copied.
        var transcoder: AudioTranscoder?
        /// Present when the video codec needs re-encoding to H.264. Primary
        /// rendition only; alternates are audio-only.
        var videoTranscoder: VideoTranscoder?
        /// Present when the copied video is Dolby Vision profile 7, which Apple cannot decode
        /// dual layer. Mutually exclusive with videoTranscoder: a re-encode drops the RPU.
        var dolbyVision: DolbyVisionConverter?

        var ctx: UnsafeMutablePointer<AVFormatContext>?
        var avio: UnsafeMutablePointer<AVIOContext>?
        /// input stream index -> output stream index, for the current muxer.
        var streamMap: [Int32: Int32] = [:]
        /// Muxer output accumulates here; the pipeline drains it into files at
        /// fragment boundaries. Per rendition, since each has its own muxer.
        var pending = Data()
        /// Segments this rendition has written. Guarded by the session lock.
        var completed = Set<Int>()
        /// First DTS written per output stream since the last muxer rebuild,
        /// in that stream's time base. The mov muxer normalizes every track's
        /// timeline to its first packet, so a generation restarted at 60s
        /// writes fragments claiming t=0; finishSegment() adds these back so
        /// tfdt really is absolute. Without this, a buffer mixing segments
        /// from two generations (early segments surviving the prune window, a
        /// seek regenerating later ones) jumps the playhead by the restart
        /// offset — found by the harness as decode positions +20s off on an
        /// Xvid AVI whose early segments escaped pruning.
        var baseDts: [Int32: Int64] = [:]

        /// Record the first DTS a stream writes in the current generation.
        func noteBaseDts(streamIndex: Int32, dts: Int64) {
            if baseDts[streamIndex] == nil, dts != Int64(bitPattern: 0x8000_0000_0000_0000) {
                baseDts[streamIndex] = dts
            }
        }

        /// Last DTS written per output stream since the muxer was built.
        var lastDts: [Int32: Int64] = [:]
        /// Output streams fed ADTS AAC (a TS source): each packet loses its 7 or 9 byte header at the write.
        var adtsStreams: Set<Int32> = []

        /// The mov muxer rejects a DTS at or below the previous one. The first packets a
        /// seek lands on can carry none, or run backwards by a tick (the demuxer's
        /// reorder buffer is cold), so they are nudged past the last one instead.
        func repairTimestamps(_ pkt: UnsafeMutablePointer<AVPacket>, streamIndex: Int32) {
            let none = Int64(bitPattern: 0x8000_0000_0000_0000)
            if let last = lastDts[streamIndex] {
                if pkt.pointee.dts == none || pkt.pointee.dts <= last { pkt.pointee.dts = last + 1 }
            } else if pkt.pointee.dts == none, pkt.pointee.pts != none {
                pkt.pointee.dts = pkt.pointee.pts
            }
            if pkt.pointee.dts != none {
                if pkt.pointee.pts != none, pkt.pointee.pts < pkt.pointee.dts { pkt.pointee.pts = pkt.pointee.dts }
                lastDts[streamIndex] = pkt.pointee.dts
            }
        }

        init(prefix: String, inputStreams: [Int32], transcoder: AudioTranscoder?, videoTranscoder: VideoTranscoder? = nil,
             dolbyVision: DolbyVisionConverter? = nil) {
            self.prefix = prefix
            self.inputStreams = inputStreams
            self.transcoder = transcoder
            self.videoTranscoder = videoTranscoder
            self.dolbyVision = dolbyVision
        }

        /// Live generation this muxer writes for; each splice gets its own init segment.
        var initGeneration = 0
        var initName: String { RemuxSession.liveInitName(prefix: prefix, generation: initGeneration) }
        func segmentName(_ n: Int) -> String { prefix.isEmpty ? "seg\(n).m4s" : "\(prefix)-seg\(n).m4s" }

        /// Set when the muxer runs with delay_moov (Dolby passthrough), where the
        /// init segment does not exist until the first fragment is cut. Cleared
        /// by finishSegment() once it has written it.
        var awaitingDeferredInit = false

        func takePending() -> Data {
            let data = pending
            pending.removeAll(keepingCapacity: true)
            return data
        }

        /// Tear down just the muxer, keeping identity and bookkeeping.
        func freeMuxer() {
            if let avio {
                av_free(avio.pointee.buffer)
                var freeingIO: UnsafeMutablePointer<AVIOContext>? = avio
                avio_context_free(&freeingIO)
            }
            if let ctx { avformat_free_context(ctx) }
            avio = nil
            ctx = nil
            streamMap = [:]
            baseDts = [:]
            lastDts = [:]
            adtsStreams = []
        }
    }

    /// AudioSpecificConfig for an ADTS AAC stream the demuxer gave no extradata for (a TS source;
    /// this build has no aac_adtstoasc bsf). ADTS carries Main/LC/SSR/LTP, profile = object type - 1.
    static func aacAudioSpecificConfig(_ par: UnsafeMutablePointer<AVCodecParameters>) -> Data? {
        let rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
        guard let rateIndex = rates.firstIndex(of: Int(par.pointee.sample_rate)) else { return nil }
        let channels = Int(par.pointee.ch_layout.nb_channels)
        guard (1...7).contains(channels) else { return nil }
        let objectType = (0...3).contains(par.pointee.profile) ? Int(par.pointee.profile) + 1 : 2
        let bits = (objectType << 11) | (rateIndex << 7) | (channels << 3)
        return Data([UInt8(bits >> 8), UInt8(bits & 0xFF)])
    }

    /// Build (or rebuild) the muxer for one rendition and write its init
    /// segment. Returns false on a fatal error.
    func buildMuxer(for rendition: Rendition, input: UnsafeMutablePointer<AVFormatContext>) -> Bool {
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        var ret = avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil)
        guard ret >= 0, let output = outputCtx else {
            fail("alloc_output: \(averr(ret))")
            return false
        }
        // The Dolby Vision configuration record rides the copied HEVC stream, and the mp4
        // muxer refuses to write dvcC/dvvC at the default compliance level, which silently
        // downgrades a DV source to plain HDR10.
        output.pointee.strict_std_compliance = FF_COMPLIANCE_UNOFFICIAL

        let ioBufSize = 1 << 16
        guard let ioBuf = av_malloc(ioBufSize) else {
            avformat_free_context(output)
            fail("av_malloc io buffer")
            return false
        }
        let opaque = Unmanaged.passUnretained(rendition).toOpaque()
        guard let avio = avio_alloc_context(
            ioBuf.assumingMemoryBound(to: UInt8.self), Int32(ioBufSize), 1, opaque, nil, Self.writeCallback, nil
        ) else {
            av_free(ioBuf)
            avformat_free_context(output)
            fail("avio_alloc_context")
            return false
        }
        output.pointee.pb = avio

        // Every failure path from here on must free what the two guards above already
        // handle inline: the muxer context, the custom AVIO context, and its buffer.
        // Ownership only transfers to the rendition at the very end (freeMuxer takes
        // over from there); until then this defer is the single cleanup path.
        var committed = false
        defer {
            if !committed {
                var freeingIO: UnsafeMutablePointer<AVIOContext>? = avio
                av_free(avio.pointee.buffer)
                avio_context_free(&freeingIO)
                avformat_free_context(output)
            }
        }

        var streamMap = [Int32: Int32]()
        for inIndex in rendition.inputStreams {
            guard let inStream = input.pointee.streams[Int(inIndex)],
                  let outStream = avformat_new_stream(output, nil) else {
                fail("avformat_new_stream")
                return false
            }

            // A transcoded track is described by its encoder, not the source:
            // AAC on the audio encoder's clock, H.264 on the video encoder's.
            let codecType = inStream.pointee.codecpar.pointee.codec_type
            if codecType == AVMEDIA_TYPE_AUDIO, let transcoder = rendition.transcoder, let encParams = transcoder.encoderParameters {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, encParams)
                guard ret >= 0 else {
                    fail("parameters_copy (encoder): \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = transcoder.encoderTimeBase
            } else if codecType == AVMEDIA_TYPE_VIDEO, let videoTranscoder = rendition.videoTranscoder, let encParams = videoTranscoder.encoderParameters {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, encParams)
                guard ret >= 0 else {
                    fail("parameters_copy (video encoder): \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = videoTranscoder.encoderTimeBase
            } else {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar)
                guard ret >= 0 else {
                    fail("parameters_copy: \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = inStream.pointee.time_base
                // ADTS AAC from a TS demux: movenc needs an AudioSpecificConfig in the esds and
                // raw frames in the samples (its ADTS check returns -1 on the first packet).
                if outStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_AAC,
                   outStream.pointee.codecpar.pointee.extradata_size == 0,
                   let config = Self.aacAudioSpecificConfig(outStream.pointee.codecpar),
                   let buf = av_mallocz(config.count + SWIFT_AV_INPUT_BUFFER_PADDING_SIZE) {
                    config.withUnsafeBytes { raw in buf.copyMemory(from: raw.baseAddress!, byteCount: config.count) }
                    outStream.pointee.codecpar.pointee.extradata = buf.assumingMemoryBound(to: UInt8.self)
                    outStream.pointee.codecpar.pointee.extradata_size = Int32(config.count)
                    rendition.adtsStreams.insert(Int32(output.pointee.nb_streams - 1))
                }
            }
            // Default tag for everything except HEVC: FFmpeg's mp4 muxer
            // defaults HEVC to the 'hev1' sample entry, which AVFoundation
            // refuses in HLS — a bare -12927 on EVERY HEVC file through the
            // copy path (found by the HDR10 harness run; H.264 was fine
            // because the default there is 'avc1'). Apple requires 'hvc1'
            // (parameter sets in the sample entry), which is valid here
            // because demuxed MKV/MP4 sources always carry hvcC extradata.
            outStream.pointee.codecpar.pointee.codec_tag =
                outStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_HEVC
                    ? (UInt32(UInt8(ascii: "h")) | UInt32(UInt8(ascii: "v")) << 8 | UInt32(UInt8(ascii: "c")) << 16 | UInt32(UInt8(ascii: "1")) << 24)
                    : 0
            // The record was copied from the source and still says profile 7. The packets this
            // rendition writes will not.
            if codecType == AVMEDIA_TYPE_VIDEO, rendition.dolbyVision != nil {
                DolbyVisionConverter.rewriteConfiguration(outStream.pointee.codecpar)
            }
            streamMap[inIndex] = Int32(output.pointee.nb_streams - 1)
            if codecType == AVMEDIA_TYPE_AUDIO {
                let parameters = outStream.pointee.codecpar.pointee
                let codec: String?
                switch parameters.codec_id {
                case AV_CODEC_ID_AAC:
                    codec = parameters.profile >= 0 ? "mp4a.40.\(parameters.profile + 1)" : nil
                case AV_CODEC_ID_FLAC: codec = "fLaC"
                case AV_CODEC_ID_ALAC: codec = "alac"
                case AV_CODEC_ID_AC3: codec = "ac-3"
                case AV_CODEC_ID_EAC3: codec = "ec-3"
                case AV_CODEC_ID_OPUS: codec = "Opus"
                default: codec = nil
                }
                stateLock.lock()
                resolvedAudioCodecs[rendition.prefix] = codec
                resolvedAudioChannels[rendition.prefix] = Int(parameters.ch_layout.nb_channels)
                stateLock.unlock()
            }
        }

        var muxOpts: OpaquePointer? = nil
        // One moof per segment holding a traf per track. Deliberately without
        // separate_moof (splits video and audio into two moof/mdat pairs) and
        // without dash (prepends per-track sidx boxes); both make AVFoundation
        // reject the segment in an HLS context. The styp box Apple requires is
        // prepended in finishSegment(), since the plain mp4 muxer never emits
        // one.
        //
        // delay_moov is set ONLY when this rendition copies Dolby through. AC-3
        // and E-AC-3 carry their configuration in a dac3/dec3 sample-entry box
        // built from bitstream fields the muxer cannot know until it has seen a
        // packet, so without the flag write_header fails outright with "Cannot
        // write moov atom before AC3 packets".
        //
        // With it, the moov is deferred and the box order shifts by one flush:
        // write_header emits nothing, the first cut emits ftyp+moov and no
        // media, and every cut after that is a clean moof+mdat. finishSegment()
        // handles that first cut. Measured against this exact FFmpeg build, not
        // assumed; an earlier note here claimed the flag folded the first
        // fragment into the moov as a bare mdat, which is what a single flush
        // looks like if you stop before the second one.
        //
        // Scoped to Dolby renditions on purpose. It is a muxer-wide flag, and
        // every other codec already writes a complete moov up front, so leaving
        // them alone keeps their init-segment timing exactly as it was.
        let carriesDolbyCopy =
            rendition.transcoder == nil
                && rendition.inputStreams.contains { index in
                    guard let stream = input.pointee.streams[Int(index)] else { return false }
                    let id = stream.pointee.codecpar.pointee.codec_id
                    return id == AV_CODEC_ID_AC3 || id == AV_CODEC_ID_EAC3
                }

        var movflags = "empty_moov+default_base_moof+frag_custom"
        if carriesDolbyCopy { movflags += "+delay_moov" }
        av_dict_set(&muxOpts, "movflags", movflags, 0)
        ret = avformat_write_header(output, &muxOpts)
        av_dict_free(&muxOpts)
        guard ret >= 0 else {
            fail("write_header: \(averr(ret))")
            return false
        }

        avio_flush(avio)
        if carriesDolbyCopy {
            // Nothing was emitted; the init segment arrives at the first cut.
            rendition.awaitingDeferredInit = true
            _ = rendition.takePending()
        } else {
            // Bytes emitted by write_header (ftyp + empty moov) are the init
            // segment. Identical every generation, so overwriting is harmless.
            do {
                let initialization = rendition.takePending()
                try initialization.write(to: dir.appendingPathComponent(rendition.initName))
                if let codec = VideoCodecDeclaration.fromInit(initialization) {
                    stateLock.lock()
                    resolvedVideoCodecs = codec
                    stateLock.unlock()
                }
            } catch {
                fail("write \(rendition.initName): \(error.localizedDescription)")
                return false
            }
        }

        rendition.ctx = output
        rendition.avio = avio
        rendition.streamMap = streamMap
        committed = true
        return true
    }

    /// Wall time of the segment just closed against its media duration, with the
    /// cushion ahead of the playhead. The generation's first segment reports no
    /// time: it carries the input seek.
    func reportThroughput(segment n: Int, cushion: Int) {
        let now = Date()
        let produced = now.timeIntervalSince(segmentClock)
        segmentClock = now
        let first = segmentsInGeneration == 0
        segmentsInGeneration += 1
        var sample: [String: Any] = [
            "token": token,
            "generation": generation,
            "segment": n,
            "segmentSeconds": segmentDurationSeconds(n),
            "cushion": cushion,
            "throttled": sleptOnCap,
            "thermal": VideoTranscoder.thermalName(),
        ]
        if !(first && generation > 0) {
            sample["produceSeconds"] = produced
            sample["readSeconds"] = readSecondsInSegment
        }
        bytesInSegment = 0
        readSecondsInSegment = 0
        sleptOnCap = false
        onThroughput?(sample)
    }

    /// The subtitle tracks the master publishes: a live session's once its input has resolved.
    func publishedSubtitles(waitSeconds: Double) -> [RemuxSubtitle] {
        if config.isLive {
            _ = waitUntil(deadline: waitSeconds) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return self.liveStreamsResolved || self.failed || self.cancelled
            }
        }
        stateLock.lock()
        defer { stateLock.unlock() }
        return liveSubtitles ?? config.subtitles
    }

    /// What the pipeline has pulled so far: alive, bytes, seconds blocked on the input, wall seconds.
    func progress() -> [String: Any] {
        stateLock.lock()
        defer { stateLock.unlock() }
        let serverAvailable = !adoptedStarts.isEmpty && config.tiers.indices.contains { !rungsUnavailable.contains($0) }
        return [
            "alive": !cancelled && !failed,
            "bytesRead": pulledBytes,
            "readSeconds": pulledReadSeconds,
            "elapsedSeconds": Date().timeIntervalSince(startedAt),
            "sourceState": sourceState.rawValue,
            "recovering": recovering,
            "hasPlayableSupplier": !cancelled && !failed && (sourceReady || serverAvailable),
            "sourceRetryAfterSeconds": sourceState == .retryWait ? max(0, sourceRetryAt.timeIntervalSinceNow) : 0,
        ]
    }

    /// The input stream a configured track names. A sourced track is the nth stream of its type, held to
    /// the count and codec the server probed; a mismatch is refused, never re-guessed.
    func sourceStream(_ input: UnsafeMutablePointer<AVFormatContext>, index: Int, source: SourcePosition?, type: AVMediaType) -> (stream: Int32?, refusal: String) {
        let ofType = (0..<Int32(input.pointee.nb_streams)).filter { input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == type }
        guard let source else {
            return ofType.contains(where: { Int($0) == index }) ? (Int32(index), "") : (nil, "stream \(index) is not present in the input")
        }
        guard ofType.count == source.count else {
            return (nil, "stream \(index) expects \(source.count) of its type, the input has \(ofType.count)")
        }
        let stream = ofType[source.ordinal]
        let codec = input.pointee.streams[Int(stream)].map { String(cString: avcodec_get_name($0.pointee.codecpar.pointee.codec_id)) } ?? ""
        guard codec == source.codec else {
            return (nil, "stream \(index) expects \(source.codec) at position \(source.ordinal), the input has \(codec)")
        }
        return (stream, "")
    }

    /// Publish what the engine decided for every stream, once the renditions
    /// exist and before a single packet moves. Goes to the device console and,
    /// through `onPlan`, to JS — which is the only channel that reaches a
    /// physical Apple TV.
    ///
    /// Deliberately built from the live objects rather than from the same
    /// conditions restated: `action` is "copy" exactly when the rendition holds
    /// no transcoder, so the report cannot claim a copy the pipeline is not
    /// doing.
    ///
    /// Called again after every seek-restart, because `restart(at:)` rebuilds
    /// each rendition's transcoders from scratch and a rebuild could in
    /// principle open a different encoder than the first attempt did (the
    /// candidate ladder tries FLAC before AAC and takes whichever opens). A
    /// stale plan would be worse than no plan, since the suite asserts against
    /// it. Identical plans are dropped rather than re-emitted, so a normal seek
    /// costs nothing and a genuine change is impossible to miss.
    func reportPlan(
        input: UnsafeMutablePointer<AVFormatContext>,
        videoIn: Int32,
        audioIndices: [Int32],
        audioIdentity: [Int32: Int],
        renditions: [Rendition]
    ) {
        // Read the video transcoder off the renditions rather than taking it as
        // an argument: after a restart the caller's copy is the pre-seek object,
        // and reporting that would defeat the point of reporting at all.
        let videoTranscoder = renditions.first { $0.videoTranscoder != nil }?.videoTranscoder

        // An audio-only session has no video track to report. The key is left
        // out entirely rather than filled with a placeholder, so a reader can
        // tell "no video" from "video we failed to describe".
        var video: [String: Any] = ["streamIndex": Int(videoIn)]
        if videoIn >= 0, let stream = input.pointee.streams[Int(videoIn)] {
            video["source"] = EnginePlan.describe(stream.pointee.codecpar)
            if let dovi = EnginePlan.dolbyVision(stream.pointee.codecpar) { video["dolbyVision"] = dovi }
        }
        if let encoded = videoTranscoder?.encoderParameters {
            video["action"] = "encode"
            video["output"] = EnginePlan.describe(encoded)
        } else {
            video["action"] = "copy"
            // "dolbyVision" above describes the source, which is dual layer. Say what leaves.
            if renditions.contains(where: { $0.dolbyVision != nil }) {
                video["dolbyVisionOutput"] = "profile 8.1, RPU, single layer"
            }
        }

        var audio: [[String: Any]] = []
        for index in audioIndices {
            guard let stream = input.pointee.streams[Int(index)] else { continue }
            let rendition = renditions.first { $0.inputStreams.contains(index) }
            var entry: [String: Any] = [
                "streamIndex": Int(index),
                "rendition": (rendition?.prefix).flatMap { $0.isEmpty ? nil : $0 } ?? "primary",
                "source": EnginePlan.describe(stream.pointee.codecpar),
            ]
            if let transcoder = rendition?.transcoder, let encoded = transcoder.encoderParameters {
                entry["action"] = "encode"
                entry["encoder"] = transcoder.encoderName
                entry["output"] = EnginePlan.describe(encoded)
            } else {
                entry["action"] = "copy"
            }
            audio.append(entry)
        }
        for (position, track) in config.audioTracks.enumerated() where track.usesServerAudio {
            var entry: [String: Any] = [
                "streamIndex": track.index,
                "identity": track.identity,
                "rendition": serverAudioPrefix(position),
                "action": "encode",
                "encoder": "server:aac",
                "output": ["codec": "aac", "channels": track.serverAudioChannels, "bitRate": 96_000],
            ]
            if let index = sourceStream(input, index: track.index, source: track.source, type: AVMEDIA_TYPE_AUDIO).stream,
               let stream = input.pointee.streams[Int(index)] {
                entry["source"] = EnginePlan.describe(stream.pointee.codecpar)
            }
            audio.append(entry)
        }
        if !config.isLive, !config.audioTracks.isEmpty {
            let positions = Dictionary(uniqueKeysWithValues: config.audioTracks.enumerated().map { ($0.element.index, $0.offset) })
            // A local entry reports the input stream it read; the track list is keyed by Index.
            let position = { (entry: [String: Any]) -> Int in
                let reported = entry["streamIndex"] as? Int ?? -1
                let identity = entry["identity"] == nil ? audioIdentity[Int32(reported)] ?? reported : reported
                return positions[identity] ?? Int.max
            }
            audio.sort { position($0) < position($1) }
        }

        // One line per stream, keyed on what the report actually claims, so an
        // unchanged plan after a seek is silent and a changed one is loud.
        let signature = ([videoIn >= 0 ? EnginePlan.summary(video) : "no video"] + audio.map { entry in
            "\(entry["streamIndex"] as? Int ?? -1):\(entry["encoder"] as? String ?? "-"):\(EnginePlan.summary(entry))"
        }).joined(separator: "|")
        if signature == lastPlanSignature { return }
        let isRevision = lastPlanSignature != nil
        lastPlanSignature = signature

        if isRevision {
            NSLog("[LocalRemuxer] plan CHANGED after restart, re-reporting")
        }
        if videoIn >= 0 {
            NSLog("[LocalRemuxer] plan video: %@", EnginePlan.summary(video))
            // Only a copy carries the RPU; an encode drops it and the source line says so.
            if let dovi = EnginePlan.dolbyVisionSummary(video["dolbyVision"] as? [String: Any]) {
                NSLog("[LocalRemuxer] plan Dolby Vision: %@, action %@", dovi, (video["action"] as? String) ?? "?")
            }
        } else {
            NSLog("[LocalRemuxer] plan: audio-only session, no video track")
        }
        for entry in audio {
            NSLog("[LocalRemuxer] plan audio %d: %@", entry["streamIndex"] as? Int ?? -1, EnginePlan.summary(entry))
        }

        var payload: [String: Any] = ["token": token, "audio": audio]
        if videoIn >= 0 { payload["video"] = video }
        onPlan?(payload)
    }

    func declineAdoption(_ reason: String) {
        NSLog("[LocalRemuxer] Slipstream: %@, staying on the fixed grid", reason)
        stateLock.lock()
        tierUnavailableReason = reason
        stateLock.unlock()
    }

    /// Fetch a rung's media playlist and parse its segment list (durations +
    /// verbatim URLs). nil = fetch/parse failed.
    func fetchTierSegments(_ urlString: String, timeout: Double = 8) -> [TierSegment]? {
        guard let url = URL(string: urlString) else { return nil }
        let request = URLRequest(url: url, timeoutInterval: timeout)
        let semaphore = DispatchSemaphore(value: 0)
        let resultLock = NSLock()
        var body: String? = nil
        let meter = TransferMeter()
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            resultLock.lock()
            if error == nil, let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                body = String(decoding: data, as: UTF8.self)
            }
            resultLock.unlock()
            semaphore.signal()
        }
        task.delegate = meter
        transfers.begin(task)
        task.resume()
        let timedOut = semaphore.wait(timeout: .now() + timeout) == .timedOut
        if timedOut { task.cancel() }
        transfers.end(task)
        resultLock.lock()
        let text = timedOut ? nil : body
        resultLock.unlock()
        guard let text, text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#EXTM3U") else { return nil }
        // A playlist is written before it is sent, so its body moves at the wire's pace.
        if let transfer = meter.read() {
            notePlaylistTransfer(bytes: transfer.bytes, from: transfer.start, to: transfer.end)
        }
        var segments: [TierSegment] = []
        var pendingDuration: Double? = nil
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXTINF:") {
                pendingDuration = Double(line.dropFirst(8).split(separator: ",").first ?? "")
            } else if !line.hasPrefix("#"), !line.isEmpty, let duration = pendingDuration {
                segments.append(TierSegment(duration: duration, url: line))
                pendingDuration = nil
            }
        }
        guard !segments.isEmpty, segments.allSatisfy({ $0.duration.isFinite && $0.duration > 0 }) else { return nil }
        return segments
    }

    /// Slipstream: fetch the ladder's playlists and adopt the canonical rung's
    /// segment list as the session grid. Higher rungs are validated against it
    /// (same count = same source-keyframe grid, M1) and dropped on a mismatch.
    /// Soft failure: the session continues on the fixed grid with no ladder.
    func adoptTierGrid() {
        guard !config.tiers.isEmpty else { return }
        // Every exit below must mark the grid decided or awaitGrid stalls its
        // full deadline on the serving queue.
        defer {
            stateLock.lock()
            gridResolved = true
            stateLock.unlock()
        }
        // The tier variants are video-only and lean on the audio GROUP; a
        // config with no explicit track list can't build one (see
        // masterPlaylist), so the session stays on the fixed grid.
        guard !config.audioTracks.isEmpty || config.serverVideoOnly else {
            return declineAdoption("no explicit audio tracks")
        }
        let deadline = openedAt.addingTimeInterval(Self.masterBudgetSeconds)
        var canonicalRung = 0
        var adopted: [TierSegment]?
        var attempt = 0
        while adopted == nil && !isCancelled && !hasFailed && deadline.timeIntervalSinceNow > 0.1 {
            canonicalRung = attempt % config.tiers.count
            adopted = fetchTierSegments(config.tiers[canonicalRung].playlistUrl, timeout: min(8, deadline.timeIntervalSinceNow))
            if adopted == nil { recordSupplierFailure(.rung(canonicalRung), failure: .transport) }
            attempt += 1
            if adopted == nil { usleep(100_000) }
        }
        guard let canonical = adopted else {
            return declineAdoption("playlist fetch failed")
        }
        guard canonical.count > 1 else {
            return declineAdoption("playlist held \(canonical.count) segments")
        }
        var starts: [Double] = []
        var durations: [Double] = []
        var acc = 0.0
        for seg in canonical {
            starts.append(acc)
            durations.append(seg.duration)
            acc += seg.duration
        }
        stateLock.lock()
        guard !gridResolved, !cancelled, !failed else { return stateLock.unlock() }
        tierSegments = [canonicalRung: canonical]
        adoptedStarts = starts
        adoptedDurations = durations
        gridResolved = true
        stateLock.unlock()
        // The other rungs are adopted when AVPlayer asks for them (adoptRung): each playlist is 48 KB,
        // and on a 0.6 Mb/s link two of them are 1.3s the first video segment needs. A rung whose
        // playlist then fails answers 404, which AVPlayer steps over (measured: -12938 in its error
        // log, the next rung up played, no stall).
        NSLog("[LocalRemuxer] Slipstream: adopted the server grid, %d segments, %.1fs total, %d rungs offered", canonical.count, acc, config.tiers.count)
    }

    /// A rung's own playlist, fetched the first time anything asks for it and held to the adopted
    /// grid: the same segment count is the same source-keyframe grid (M1).
    func adoptRung(_ k: Int) -> Bool {
        guard k >= 0, k < config.tiers.count else { return false }
        return dedupedMaterialization("adopt-t\(k)") { () -> Bool? in
            stateLock.lock()
            let known = !(tierSegments[k]?.isEmpty ?? true)
            let retired = rungsUnavailable.contains(k)
            let durations = adoptedDurations
            stateLock.unlock()
            if known { return true }
            if retired || durations.isEmpty { return false }
            guard awaitSupplierRetry(.rung(k)) else { return false }
            // A fetch that failed is the link or the server having a moment, and is asked again
            // on the next request; only a playlist that arrived on another grid retires the rung.
            guard let segments = fetchTierSegments(config.tiers[k].playlistUrl) else {
                NSLog("[LocalRemuxer] Slipstream: rung %d playlist fetch failed", k)
                recordSupplierFailure(.rung(k), failure: .transport)
                return false
            }
            let fits = segments.count == durations.count && zip(segments, durations).allSatisfy { abs($0.0.duration - $0.1) <= 0.001 }
            if !fits { NSLog("[LocalRemuxer] Slipstream: rung %d grid mismatch (%d vs %d), retiring it", k, segments.count, durations.count) }
            stateLock.lock()
            if fits { tierSegments[k] = segments } else { rungsUnavailable.insert(k) }
            stateLock.unlock()
            if !fits { recordSupplierFailure(.rung(k), failure: .unsupported) }
            return fits
        } ?? false
    }

    func runPipeline() {
        // Startup breakdown. Nothing between startRemux resolving and the plan was
        // timed, and that window is 6-8s on the first session of a process.
        let tStart = CFAbsoluteTimeGetCurrent()
        func mark(_ stage: String) {
            let elapsed = CFAbsoluteTimeGetCurrent() - tStart
            NSLog("[LocalRemuxer] startup %@ +%.3fs", stage, elapsed)
            onStage?(["token": token, "stage": stage, "elapsed": elapsed])
        }

        // Slipstream grid adoption runs concurrent with the input open — on a
        // WAN server both are long round-trips and stacking them delays the
        // first frame. Playlist serving waits on awaitGrid, never on this
        // thread, and adoptTierGrid guards its state under stateLock.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.adoptTierGrid()
            self?.probeTier()
        }
        if !config.tiers.isEmpty {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.probeLink()
                self?.watchLinkWhileRidingTier()
            }
        }

        if config.serverVideoOnly {
            awaitGrid()
            guard !config.isLive, !demuxerOwesTracks, tierOffered, config.audioTracks.isEmpty || audioLoActive,
                  releaseSource(because: "server-video fallback", unusable: true) else {
                return fail("server-video fallback cannot serve the complete track catalogue")
            }
            mark("source_released")
            return
        }
        let verdictLists = decideCopy()
        stateLock.lock()
        let refused = sourceProbeFailure != nil
        stateLock.unlock()
        if !verdictLists, releaseSource(because: refused ? "the source request failed" : "the link cannot carry the copy") {
            mark("source_released")
        }
        while !isCancelled && !hasFailed {
            stateLock.lock()
            let state = sourceState
            stateLock.unlock()
            if state == .unavailable { break }
            if state == .dormant || state == .retryWait {
                guard wakeSourceIfAffordable() else {
                    usleep(100_000)
                    continue
                }
                mark("source_warming")
            }
            runSourcePipeline(mark: mark)
            stateLock.lock()
            let retrying = sourceState == .retryWait || sourceState == .dormant
            stateLock.unlock()
            if !retrying { break }
        }
    }

    func archiveReadSpanLocked() {
        if let from = readSpanFrom { readSpans.append((from: from, upTo: readSpanUpTo)) }
        readSpanFrom = nil
        readSpanUpTo = 0
    }

    private func runSourcePipeline(mark: (String) -> Void) {
        stateLock.lock()
        archiveReadSpanLocked()
        stateLock.unlock()
        let opaque = Unmanaged.passUnretained(self).toOpaque()

        // ---- Input: opened once; seeks reuse the same context ----
        EngineLog.configure()
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard inputCtx != nil else { return fail("avformat_alloc_context") }
        inputCtx!.pointee.interrupt_callback = AVIOInterruptCB(callback: Self.interruptCallback, opaque: opaque)

        var openOpts: OpaquePointer? = nil
        av_dict_set(&openOpts, "reconnect", "1", 0)
        av_dict_set(&openOpts, "reconnect_streamed", "1", 0)
        av_dict_set(&openOpts, "reconnect_delay_max", "5", 0)
        // A silently wedged read (TCP stall with no RST) otherwise blocks
        // av_read_frame forever: the interrupt callback only fires on session
        // cancel, `failed` never gets set, and every segment request starves
        // out its 20s deadline with the producer looking alive. 15s per I/O
        // operation turns the stall into an error the reconnect options above
        // can retry, or a clean fail() the player recovers from.
        av_dict_set(&openOpts, "rw_timeout", "15000000", 0)
        // Pinned, not inherited: FFmpeg's default flips to 1 at avformat 63 and
        // tvOS has no trust store to verify against until we ship a CA file.
        av_dict_set(&openOpts, "tls_verify", "0", 0)
        for (name, value) in config.httpHeaders {
            if name.caseInsensitiveCompare("User-Agent") == .orderedSame {
                av_dict_set(&openOpts, "user_agent", value, 0)
            } else {
                av_dict_set(&openOpts, "headers", "\(name): \(value)\r\n", AV_DICT_APPEND)
            }
        }
        // FAST channels serve segments from extension-less URLs (measured on amagi.tv);
        // the HLS demuxer refuses those unless told not to be picky.
        if config.isLive { av_dict_set(&openOpts, "extension_picky", "0", 0) }
        // An origin refusing its segments answers in milliseconds while the open sits on it (measured:
        // CBC held a session 49s). The check runs beside the open, so a live origin costs no startup.
        if config.isLive && config.probeOrigin {
            let inputUrl = config.inputUrl
            let headers = config.httpHeaders
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let stopped = { [weak self] in self?.isCancelled ?? true }
                guard let refusal = EndpointProbe.hlsOriginRefusal(inputUrl, headers: headers, timeout: 5, cancelled: stopped) else { return }
                self?.fail(refusal)
            }
        }
        var ret = avformat_open_input(&inputCtx, config.inputUrl, nil, &openOpts)
        av_dict_free(&openOpts)
        guard ret >= 0, let input = inputCtx else { return failStartup("open_input: \(averr(ret))", retryable: !Self.isPermanentInputError(ret)) }
        mark("open_input")
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }

        ret = probeStreamInfo(input)
        guard ret >= 0 else { return failStartup("find_stream_info: \(averr(ret))", retryable: !Self.isPermanentInputError(ret)) }
        mark("find_stream_info")

        // Audio-only sources run this same pipeline with no video track at all,
        // so a music file AVPlayer cannot open (Vorbis in Ogg, APE, TTA) is
        // rewrapped here instead of being handed to the server. Everything
        // downstream that assumed a video stream is guarded on `hasVideo`.
        // Off-thread: the probe costs 11.1s on an iPhone (measured), all of it in
        // VTDecompressionSessionCreate, and it decides nothing.
        DispatchQueue.global(qos: .utility).async { VideoTranscoder.logDecodeSupport() }
        mark("vt_decode_probe")

        var videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        // Live: a manifest exposes every variant as a program tagged with its bandwidth;
        // carry the top one and confine audio discovery to it.
        var carriedProgram: UnsafeMutablePointer<AVProgram>? = nil
        if config.isLive, videoIn >= 0 {
            var bestBitrate: Int64 = -1
            for p in 0..<Int(input.pointee.nb_programs) {
                guard let program = input.pointee.programs[p],
                      let tag = av_dict_get(program.pointee.metadata, "variant_bitrate", nil, 0),
                      let bitrate = Int64(String(cString: tag.pointee.value)), bitrate > bestBitrate else { continue }
                for s in 0..<Int(program.pointee.nb_stream_indexes) {
                    let index = Int32(program.pointee.stream_index[s])
                    guard input.pointee.streams[Int(index)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_VIDEO else { continue }
                    bestBitrate = bitrate
                    videoIn = index
                    carriedProgram = program
                    break
                }
            }
            if carriedProgram == nil { carriedProgram = av_find_program_from_stream(input, nil, videoIn) }
            if bestBitrate > 0 {
                NSLog("[LocalRemuxer] live variant: %lld bps of %d program(s)", bestBitrate, input.pointee.nb_programs)
            }
        }
        let hasVideo = videoIn >= 0

        // Resolve the audio tracks to carry, in the order the playlist will
        // advertise them. Several tracks: each becomes an audio-only rendition
        // ("a0", "a1", …) and the variant is video-only — see masterPlaylist()
        // for why (picker labels). A lone track is muxed with the video.
        let streamCount = Int32(input.pointee.nb_streams)
        let localAudioTracks = config.audioTracks.filter { !$0.usesServerAudio }
        // Input stream to the configured track's Index, which names it everywhere outside the demuxer.
        var audioIdentity: [Int32: Int] = [:]
        var audioIndices: [Int32] = []
        for track in localAudioTracks {
            let found = sourceStream(input, index: track.index, source: track.source, type: AVMEDIA_TYPE_AUDIO)
            guard let stream = found.stream else {
                if config.isLive { continue }
                return failStartup("configured audio \(found.refusal)")
            }
            audioIdentity[stream] = track.index
            audioIndices.append(stream)
        }
        if audioIndices.isEmpty && config.audioTracks.isEmpty {
            let best = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, videoIn, nil, 0)
            if best >= 0 { audioIndices = [best] }
        }
        guard hasVideo || !audioIndices.isEmpty else { return failStartup("no video or audio stream") }
        var imageSubtitleTracks = config.subtitles.filter { $0.isImage }
        // Live: carry every audio stream the demuxer sees. The server's probe of a channel can
        // list fewer tracks than the stream carries (measured: one of two AAC tracks).
        if config.isLive, hasVideo {
            let candidates: [Int32] = carriedProgram.map { program in
                (0..<Int(program.pointee.nb_stream_indexes)).map { Int32(program.pointee.stream_index[$0]) }
            } ?? Array(0..<streamCount)
            audioIndices = audioIndices.filter { candidates.contains($0) }
            for i in candidates where !audioIndices.contains(i) {
                guard input.pointee.streams[Int(i)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO else { continue }
                audioIndices.append(i)
            }
            if audioIndices.isEmpty {
                let best = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, videoIn, nil, 0)
                if best >= 0 { audioIndices = [best] }
            }
            let tracks: [RemuxAudioTrack] = audioIndices.enumerated().map { position, index in
                if let known = config.audioTracks.first(where: { $0.index == Int(index) }) { return known }
                let metadata = input.pointee.streams[Int(index)]?.pointee.metadata
                let language = av_dict_get(metadata, "language", nil, 0).map { String(cString: $0.pointee.value) } ?? ""
                let title = av_dict_get(metadata, "title", nil, 0).map { String(cString: $0.pointee.value) } ?? ""
                let name = !title.isEmpty ? title : !language.isEmpty ? language : "Audio \(position + 1)"
                return RemuxAudioTrack(index: Int(index), name: name, language: language, serverAudioUrl: "")
            }
            // Image subtitle tracks (DVB, teletext) come off the stream too: a channel read from its
            // origin has no server probe to list them.
            var found: [RemuxSubtitle] = candidates.compactMap { index in
                guard let stream = input.pointee.streams[Int(index)], let par = stream.pointee.codecpar,
                      par.pointee.codec_type == AVMEDIA_TYPE_SUBTITLE, ImageSubtitleDecoder.handles(par.pointee.codec_id) else { return nil }
                if let known = imageSubtitleTracks.first(where: { $0.index == Int(index) }) { return known }
                let language = av_dict_get(stream.pointee.metadata, "language", nil, 0).map { String(cString: $0.pointee.value) } ?? ""
                let title = av_dict_get(stream.pointee.metadata, "title", nil, 0).map { String(cString: $0.pointee.value) } ?? ""
                return RemuxSubtitle(index: Int(index), name: !title.isEmpty ? title : language, language: language, vttUrl: "", localVtt: "",
                                     isDefault: stream.pointee.disposition & AV_DISPOSITION_DEFAULT != 0, isForced: stream.pointee.disposition & AV_DISPOSITION_FORCED != 0,
                                     isImage: true, isEngineText: false)
            }
            // Names are the picker's only handle on a track, so each is unique.
            let names = found.map { $0.name }
            for position in found.indices where names[position].isEmpty || names.filter({ $0 == names[position] }).count > 1 {
                let track = found[position]
                let name = track.name.isEmpty ? "Subtitles \(position + 1)" : "\(track.name) (\(position + 1))"
                found[position] = RemuxSubtitle(index: track.index, name: name, language: track.language, vttUrl: "", localVtt: "",
                                                isDefault: track.isDefault, isForced: track.isForced, isImage: true, isEngineText: false)
            }
            imageSubtitleTracks = found
            stateLock.lock()
            liveAudioTracks = tracks
            liveSubtitles = found
            stateLock.unlock()
        }
        // With no video there is no variant for alternates to hang off, so an
        // audio-only session carries one track. Multi-track audio-only files
        // are a theoretical shape, not one a music library produces.
        if !hasVideo && audioIndices.count > 1 { audioIndices = [audioIndices[0]] }
        // Live carries no text subtitles, so every stream but the video, the audio and the image
        // subtitle tracks is dead weight; discarding it is what stops the HLS demuxer downloading
        // the variants nobody reads.
        if config.isLive {
            let carried = Set(audioIndices + (hasVideo ? [videoIn] : []) + imageSubtitleTracks.map { Int32($0.index) })
            for i in 0..<streamCount where !carried.contains(i) {
                input.pointee.streams[Int(i)]?.pointee.discard = AVDISCARD_ALL
            }
        }

        // Image subtitle tracks (PGS, DVD/VobSub, DVB, XSUB): one decoder each,
        // fed from the read loop below. The packets are demuxed either way — the
        // loop drops any stream no rendition claims — so this adds decode and
        // PNG encoding but not a single extra byte off the network. Their canvas
        // falls back to the video's dimensions, since most files leave it unset
        // in codecpar and only the decoder learns the real one.
        let videoParams = hasVideo ? input.pointee.streams[Int(videoIn)]?.pointee.codecpar : nil
        let fallbackWidth = Int(videoParams?.pointee.width ?? 0)
        let fallbackHeight = Int(videoParams?.pointee.height ?? 0)
        // Input stream to the subtitle's Index: the decoders are keyed by Index, which the routes ask by.
        var subtitleIdentity: [Int32: Int32] = [:]
        for sub in imageSubtitleTracks {
            let index = Int32(sub.index)
            let found = sub.isExternal ? (stream: Int32?.none, refusal: "") : sourceStream(input, index: sub.index, source: sub.source, type: AVMEDIA_TYPE_SUBTITLE)
            if let stream = found.stream { subtitleIdentity[stream] = index }
            stateLock.lock()
            let existingDecoder = imageSubtitles[index]
            stateLock.unlock()
            if let existingDecoder {
                existingDecoder.flush(demuxedUpTo: demuxedUpTo)
                continue
            }
            if sub.isExternal {
                guard !sub.serverSupUrl.isEmpty else { return failStartup("external image subtitle \(sub.index) has no producer") }
                startServerImageSubtitles()
                continue
            }
            guard let streamIndex = found.stream, let stream = input.pointee.streams[Int(streamIndex)] else {
                if !sub.serverSupUrl.isEmpty {
                    startServerImageSubtitles()
                    continue
                }
                return failStartup("configured image subtitle \(found.refusal)")
            }
            guard let decoder = ImageSubtitleDecoder(
                stream: stream,
                fallbackWidth: fallbackWidth,
                fallbackHeight: fallbackHeight,
                dir: dir,
                reportedIndex: index,
                namePrefix: "pgs\(sub.index)"
            ) else {
                if !sub.serverSupUrl.isEmpty {
                    startServerImageSubtitles()
                    continue
                }
                return failStartup("image subtitle \(sub.index) has no decoder")
            }
            stateLock.lock()
            imageSubtitles[index] = decoder
            stateLock.unlock()
        }
        if !imageSubtitles.isEmpty {
            NSLog("[LocalRemuxer] harvesting %d image subtitle track(s)", imageSubtitles.count)
        }

        // Same terms as the image ones: decode cost, nothing off the network.
        for sub in config.subtitles where sub.isEngineText {
            let index = Int32(sub.index)
            let found = sourceStream(input, index: sub.index, source: sub.source, type: AVMEDIA_TYPE_SUBTITLE)
            if let stream = found.stream { subtitleIdentity[stream] = index }
            stateLock.lock()
            let existingDecoder = textSubtitles[index]
            stateLock.unlock()
            if let existingDecoder {
                existingDecoder.flush()
                continue
            }
            guard let streamIndex = found.stream, let stream = input.pointee.streams[Int(streamIndex)] else {
                if !sub.serverVttUrl.isEmpty { continue }
                return failStartup("configured text subtitle \(found.refusal)")
            }
            guard let decoder = TextSubtitleDecoder(stream: stream) else {
                if !sub.serverVttUrl.isEmpty { continue }
                return failStartup("text subtitle \(sub.index) has no decoder")
            }
            stateLock.lock()
            textSubtitles[index] = decoder
            stateLock.unlock()
        }
        stateLock.lock()
        subtitleDecodersBuilt = true
        stateLock.unlock()
        if !textSubtitles.isEmpty {
            NSLog("[LocalRemuxer] decoding %d text subtitle track(s) on device", textSubtitles.count)
        }
        mark("image_subtitle_decoders")

        // Audio AVPlayer can't decode (AC3, DTS, TrueHD, Opus, Vorbis) is
        // re-encoded on the way through, losslessly where the encoder allows;
        // AAC, ALAC and well-formed FLAC copy untouched. Video is always copied.
        // Transcoders are built before the muxers, which describe the output
        // track from the encoder.
        func makeTranscoder(for streamIndex: Int32) -> AudioTranscoder?? {
            guard let audioStream = input.pointee.streams[Int(streamIndex)] else { return .some(nil) }
            guard AudioTranscoder.needsTranscode(stream: audioStream) else { return .some(nil) }
            guard let transcoder = AudioTranscoder(inputStream: audioStream) else {
                return nil // unrecoverable
            }
            return .some(transcoder)
        }

        // Video AVPlayer cannot decode is re-encoded to H.264 through
        // VideoToolbox; H.264/HEVC (and hardware-gated AV1) keep copying.
        // Built before the muxers, which describe the output track from the
        // encoder. A nil here (interlaced, wrong pixel format, no encoder)
        // fails the session cleanly and the player falls back to the server.
        var primaryVideoTranscoder: VideoTranscoder? = nil
        if hasVideo, let videoStream = input.pointee.streams[Int(videoIn)] {
            let videoCodecId = videoStream.pointee.codecpar.pointee.codec_id
            if VideoTranscoder.needsTranscode(stream: videoStream) {
                guard let transcoder = VideoTranscoder(inputStream: videoStream) else {
                    return failStartup("no transcode path for video codec \(videoCodecId.rawValue)")
                }
                NSLog("[LocalRemuxer] Transcoding video stream %d via VideoToolbox", videoIn)
                primaryVideoTranscoder = transcoder
            }
        }

        // Dual-layer Dolby Vision decodes nowhere on Apple hardware, so a copied profile 7
        // reaches the panel as plain HDR10. Converting its RPUs to single-layer 8.1 is what
        // makes the Dolby Vision path engage, and it costs what a stream copy costs.
        //
        // The playlist is written from Jellyfin's metadata before this runs and already claims
        // 8.1 for such a source, so a profile 7 the converter cannot take fails the session to
        // the server rather than serving a stream that contradicts its own manifest.
        var primaryDolbyVision: DolbyVisionConverter? = nil
        if hasVideo, primaryVideoTranscoder == nil, let stream = input.pointee.streams[Int(videoIn)],
           let record = DolbyVisionConverter.configuration(stream.pointee.codecpar),
           record.dv_profile == 7, record.rpu_present_flag == 1 {
            guard let converter = DolbyVisionConverter(inputStream: stream) else {
                return failStartup("Dolby Vision profile 7 source is not length-prefixed HEVC")
            }
            NSLog("[LocalRemuxer] Dolby Vision profile 7 on stream %d: converting RPUs to 8.1", videoIn)
            primaryDolbyVision = converter
        }

        var builtRenditions: [Rendition] = []
        // Slipstream sessions always de-mux audio into its own rendition group
        // (see masterPlaylist): variant switches must never touch audio. Keyed on the
        // configured ladder, not the adopted one: adoption can finish after this line runs.
        let splitAudio = audioIndices.count > 1 || config.audioTracks.count > 1 || !config.tiers.isEmpty || config.audioTracks.contains(where: { $0.usesServerAudio })
        if hasVideo && splitAudio {
            builtRenditions.append(Rendition(prefix: "", inputStreams: [videoIn], transcoder: nil, videoTranscoder: primaryVideoTranscoder,
                                             dolbyVision: primaryDolbyVision))
        }
        for (discoveredPosition, audioIndex) in audioIndices.enumerated() {
            let position = config.isLive ? discoveredPosition : config.audioTracks.firstIndex(where: { $0.index == audioIdentity[audioIndex] }) ?? discoveredPosition
            guard let transcoder = makeTranscoder(for: audioIndex) else {
                return failStartup("no transcode path for audio stream \(audioIndex)")
            }
            if hasVideo && splitAudio {
                builtRenditions.append(Rendition(prefix: audioPrefix(position), inputStreams: [audioIndex], transcoder: transcoder, videoTranscoder: nil))
            } else {
                // The audio-only case lands here too, with the video index left
                // out of the stream list entirely.
                let streams = hasVideo ? [videoIn, audioIndex] : [audioIndex]
                builtRenditions.append(Rendition(prefix: "", inputStreams: streams, transcoder: transcoder, videoTranscoder: primaryVideoTranscoder,
                                                 dolbyVision: primaryDolbyVision))
            }
        }
        if builtRenditions.isEmpty {
            // Video with no audio at all.
            builtRenditions = [Rendition(prefix: "", inputStreams: [videoIn], transcoder: nil, videoTranscoder: primaryVideoTranscoder,
                                         dolbyVision: primaryDolbyVision)]
        }

        stateLock.lock()
        let goneAlready = cancelled
        for rendition in builtRenditions {
            if let previous = renditions.first(where: { $0.prefix == rendition.prefix }) {
                rendition.completed = previous.completed
            }
        }
        renditions = builtRenditions
        producingSegment = 0
        reachedEnd = false
        stateLock.unlock()
        defer { builtRenditions.forEach { $0.freeMuxer() } }
        // stop() deletes the segment directory, so a session torn down during the
        // open has nowhere to write and must not try.
        if goneAlready { return }

        mark("renditions_built")
        reportPlan(input: input, videoIn: videoIn, audioIndices: audioIndices, audioIdentity: audioIdentity, renditions: builtRenditions)

        let microTb = AVRational(num: 1, den: SWIFT_AV_TIME_BASE)

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        guard let pkt = packet else { return fail("av_packet_alloc") }

        // Annex-B H.264/HEVC from a TS demux arrives with no extradata (this build has no
        // extract_extradata bsf), and movenc reads codecpar once, when the muxer is built.
        // The parameter sets ride the first keyframe: read up to it, lift them onto the input
        // stream, and replay that keyframe as the loop's first packet.
        var queuedPacket: UnsafeMutablePointer<AVPacket>? = nil
        if hasVideo, let videoStream = input.pointee.streams[Int(videoIn)],
           videoStream.pointee.codecpar.pointee.extradata_size == 0,
           videoStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_H264 || videoStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_HEVC,
           builtRenditions.contains(where: { $0.videoTranscoder == nil && $0.inputStreams.contains(videoIn) }) {
            let hevc = videoStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_HEVC
            while av_read_frame(input, pkt) >= 0 {
                let opensOnKeyframe = pkt.pointee.stream_index == videoIn && pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0
                if pkt.pointee.stream_index == videoIn, TierRewrapper.annexBHasA53Captions(pkt, hevc: hevc) {
                    stateLock.lock()
                    embeddedCaptions = true
                    stateLock.unlock()
                }
                if opensOnKeyframe,
                   let sets = TierRewrapper.annexBParameterSets(pkt, hevc: hevc),
                   let buf = av_mallocz(sets.count + SWIFT_AV_INPUT_BUFFER_PADDING_SIZE) {
                    sets.withUnsafeBytes { raw in buf.copyMemory(from: raw.baseAddress!, byteCount: sets.count) }
                    videoStream.pointee.codecpar.pointee.extradata = buf.assumingMemoryBound(to: UInt8.self)
                    videoStream.pointee.codecpar.pointee.extradata_size = Int32(sets.count)
                    NSLog("[LocalRemuxer] Parameter sets lifted from the opening keyframe (%d bytes)", sets.count)
                }
                // Stream info that opened far from a keyframe holds no dimensions either, and the
                // muxer refuses a video track without them; the parser reads them off the SPS.
                if opensOnKeyframe,
                   videoStream.pointee.codecpar.pointee.width <= 0 || videoStream.pointee.codecpar.pointee.height <= 0,
                   let parser = av_parser_init(Int32(videoStream.pointee.codecpar.pointee.codec_id.rawValue)),
                   let codec = avcodec_find_decoder(videoStream.pointee.codecpar.pointee.codec_id),
                   let codecCtx = avcodec_alloc_context3(codec) {
                    var parsed: UnsafeMutablePointer<UInt8>? = nil
                    var parsedSize: Int32 = 0
                    _ = av_parser_parse2(parser, codecCtx, &parsed, &parsedSize, pkt.pointee.data, pkt.pointee.size, SWIFT_AV_NOPTS_VALUE, SWIFT_AV_NOPTS_VALUE, -1)
                    if parser.pointee.width > 0, parser.pointee.height > 0 {
                        videoStream.pointee.codecpar.pointee.width = parser.pointee.width
                        videoStream.pointee.codecpar.pointee.height = parser.pointee.height
                        NSLog("[LocalRemuxer] Dimensions read from the opening keyframe: %dx%d", parser.pointee.width, parser.pointee.height)
                    }
                    var freeing: UnsafeMutablePointer<AVCodecContext>? = codecCtx
                    avcodec_free_context(&freeing)
                    av_parser_close(parser)
                }
                if opensOnKeyframe {
                    queuedPacket = av_packet_clone(pkt)
                    av_packet_unref(pkt)
                    break
                }
                av_packet_unref(pkt)
            }
        }

        stateLock.lock()
        if embeddedCaptions { NSLog("[LocalRemuxer] CEA-608/708 captions in the opening video packets, declared in the master") }
        stateLock.unlock()

        for rendition in builtRenditions {
            guard buildMuxer(for: rendition, input: input) else { return }
        }
        stateLock.lock()
        sourceReady = true
        sourceState = .ready
        liveStreamsResolved = true
        stateLock.unlock()
        segmentClock = Date()

        var currentSegment = 0
        // Every generation, including the first, opens on a video keyframe.
        // Starting mid-GOP would feed the muxer leading B-frames whose DTS runs
        // behind the anchor and can arrive out of order, which it rejects.
        var awaitingKeyframe = true
        // Transcode path: which segment already had its boundary IDR
        // requested, so a run of input frames past the boundary doesn't force
        // one keyframe per frame while the encoder catches up.
        var keyframeForcedAtSegment = -1

        // Timeline anchor, in AV_TIME_BASE units: `outputPts = inputPts - anchor`.
        // Fixed ONCE, by the first keyframe generation 0 muxes, and reused
        // unchanged by every seek-restart, so output time equals source media
        // time for the whole session.
        //
        // This used to be re-derived per generation as `keyframe - segment*6`,
        // which relabelled whatever keyframe a seek landed on as if it sat
        // exactly on the requested segment boundary. Since the seek runs
        // BACKWARD, that keyframe is at or before the boundary, so the entire
        // media timeline shifted later by the gap (up to a full GOP). Audio and
        // video shifted together and stayed in sync with each other, but the
        // WebVTT rendition carries absolute source times and is never rebased,
        // so subtitles ran ahead of the picture by that gap after every seek,
        // and the reported position stopped matching the content on screen.
        //
        // Deliberately not the container's `start_time`, which need not line up
        // with the first packet and produced negative, non-monotonic DTS on
        // files with B-frames.
        var sessionAnchorUs: Int64? = nil
        var timelineAnchorUs: Int64 = 0

        // Segment this generation was restarted for. The generation opens on
        // the keyframe at or before it, which can belong to an earlier segment.
        var generationRequestSegment = 0
        // The generation's opening segment when its keyframe sits past that
        // segment's nominal start, so the segment is short at the head and must
        // not be published; -1 when the opening segment is whole.
        var partialOpenSegment = -1

        // Live: the timing stream's last source PTS (splice detection) and keyframe
        // (interval measurement), where output time resumes after a splice, and the
        // open segment's start in output seconds (the cut boundary is relative to it).
        var lastTimingPtsUs: Int64? = nil
        var lastKeyframeUs: Int64? = nil
        var liveResumeUs: Int64 = 0
        var lastOutputEndUs: Int64 = 0
        var segmentOpenSeconds = 0.0

        /// Close segment `n` on every rendition. All renditions are cut on the
        /// same boundary so their timelines stay interchangeable, which is what
        /// lets AVPlayer swap audio renditions mid-playback.
        func finishSegment(_ n: Int) {
            for rendition in builtRenditions {
                guard let ctx = rendition.ctx, let avio = rendition.avio else { continue }
                av_write_frame(ctx, nil) // flush the open fragment
                avio_flush(avio)
                var data = rendition.takePending()

                // Dolby passthrough (delay_moov): this first cut carried the
                // deferred ftyp+moov and no media at all. Publish it as the init
                // segment, then cut again so this segment gets its own fragment.
                // Without the second cut the packets written so far would merge
                // into the NEXT segment and every boundary would slip by one.
                if rendition.awaitingDeferredInit {
                    do {
                        try data.write(to: dir.appendingPathComponent(rendition.initName))
                        if let codec = VideoCodecDeclaration.fromInit(data) {
                            stateLock.lock()
                            resolvedVideoCodecs = codec
                            stateLock.unlock()
                        }
                    } catch {
                        return fail("write \(rendition.initName): \(error.localizedDescription)")
                    }
                    rendition.awaitingDeferredInit = false
                    av_write_frame(ctx, nil)
                    avio_flush(avio)
                    data = rendition.takePending()
                }

                // Never publish the generation's opening segment when its
                // keyframe landed past that segment's start: the fragment is
                // short at the head. Flushing it above keeps the next one
                // clean; discarding it here means a later request for this
                // index restarts at its own boundary, which necessarily seeks
                // to an earlier keyframe and covers the segment in full.
                if n == partialOpenSegment { continue }
                guard !data.isEmpty else { continue }

                // The header already shipped ftyp+moov as the init segment, so
                // a media segment should start at its moof. Guard anyway: a
                // muxer that ever prefixes header boxes here would bake them
                // into the segment, which AVFoundation rejects with a bare
                // -12889.
                guard let fragmentStart = Self.firstFragmentOffset(in: data) else {
                    return fail("segment \(n) (\(rendition.prefix.isEmpty ? "primary" : rendition.prefix)) contains no moof box")
                }
                if fragmentStart > 0 {
                    data = data.subdata(in: fragmentStart..<data.count)
                }

                // tfdt back to absolute (track_id is 1-based in stream order).
                var offsets: [UInt32: Int64] = [:]
                for (_, outIndex) in rendition.streamMap {
                    if let base = rendition.baseDts[outIndex], base != 0 {
                        offsets[UInt32(outIndex) + 1] = base
                    }
                }
                var segment = Self.stypBox + data
                if !offsets.isEmpty {
                    Self.patchTfdtToAbsolute(in: &segment, offsets: offsets)
                }

                do {
                    try segment.write(to: dir.appendingPathComponent(rendition.segmentName(n)), options: .atomic)
                } catch {
                    return fail("write \(rendition.segmentName(n)): \(error.localizedDescription)")
                }
                // One lock with the retry state: a waiter woken by this segment reads a recovered source.
                stateLock.lock()
                rendition.completed.insert(n)
                sourceRetryAttempts = 0
                recovering = false
                stateLock.unlock()
            }

            stateLock.lock()
            let playhead = lastRequestedSegment
            sourceRetryAttempts = 0
            recovering = false
            if let takeover = sourceTakeoverSegment, n >= takeover + Self.followSegments {
                sourceTakeoverSegment = nil
            }
            stateLock.unlock()
            if config.isLive {
                // The window trails production, not the playhead: live never seeks back to regenerate.
                stateLock.lock()
                let oldest = max(0, n - liveKeepSegments + 1)
                firstRetainedSegment = oldest
                stateLock.unlock()
                pruneSegments(outside: oldest...n)
                // The window slid: image cues and their files behind it go with the segments.
                let windowSeconds = liveWindowSecondsNow()
                for decoder in imageSubtitles.values { decoder.prune(before: demuxedUpToOutput - windowSeconds) }
            } else {
                pruneSegments(outside: (playhead - keepWindow)...(playhead + keepWindow))
            }

            // Cushion + input-throughput diagnostics, throttled to ~5s: the field
            // data that validates the read-ahead depth against a given server link.
            let elapsed = Date().timeIntervalSince(lastThroughputLog)
            if elapsed >= 5 {
                let mbps = Double(inputBytesSinceLog) * 8 / elapsed / 1_000_000
                NSLog("[LocalRemuxer] segment %d done: cushion %d/%d segs, input %.1f Mb/s", n, max(0, n - playhead), aheadWindow, mbps)
                inputBytesSinceLog = 0
                lastThroughputLog = Date()
            }
            reportThroughput(segment: n, cushion: n - playhead)
        }

        /// Live: the cut boundary is relative to the open segment, so a keyframe-aligned
        /// cut overshoots by at most one keyframe interval and the grid never drifts.
        func nextBoundarySeconds() -> Double {
            config.isLive ? segmentOpenSeconds + config.liveSegmentSeconds : segmentStartSeconds(currentSegment + 1)
        }

        /// Live: record the closing segment's real length and the next one's start.
        func noteLiveCut(atOutputSeconds seconds: Double) {
            stateLock.lock()
            liveDurations[currentSegment] = max(0.001, seconds - segmentOpenSeconds)
            liveDates[currentSegment + 1] = Date()
            stateLock.unlock()
            segmentOpenSeconds = seconds
        }

        /// Rebuild every rendition's muxer and transcoders for a new generation. False on fatal error.
        func rebuildRenditions() -> Bool {
            for rendition in builtRenditions {
                rendition.freeMuxer()
                _ = rendition.takePending() // drop bytes of the abandoned fragment

                // Rebuild the audio transcoder rather than reusing it: AAC
                // encoders cannot be flushed, so a reused one would emit queued
                // frames still carrying pre-seek timestamps and the muxer would
                // reject them as non-monotonic. A fresh one seeds its sample
                // clock from the first packet it is handed, keeping audio
                // aligned with video wherever the generation opens.
                if rendition.transcoder != nil {
                    guard let audioIndex = rendition.inputStreams.first(where: {
                        input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO
                    }), let rebuilt = makeTranscoder(for: audioIndex), rebuilt != nil else {
                        fail("failed to rebuild audio transcoder after seek")
                        return false
                    }
                    rendition.transcoder = rebuilt
                }

                // Same rule for video: a flushed VideoToolbox session is done,
                // and a reused one would emit frames carrying pre-seek
                // timestamps. Identical settings produce identical SPS/PPS, so
                // the rewritten init segment stays byte-stable (asserted by
                // the harness, since AVPlayer caches init segments).
                if rendition.videoTranscoder != nil {
                    guard let stream = input.pointee.streams[Int(videoIn)],
                          let rebuilt = VideoTranscoder(inputStream: stream) else {
                        fail("failed to rebuild video transcoder after seek")
                        return false
                    }
                    rendition.videoTranscoder = rebuilt
                }

                guard buildMuxer(for: rendition, input: input) else { return false }
            }

            // Subtitle decoders survive the seek — their events are in source
            // time and everything already harvested stays valid — but their
            // internal state must not: a half-received PGS display set would
            // otherwise merge with packets from the new position. Events already
            // recorded are recognised on the way past and not duplicated.
            //
            // They are also told how far the read actually got, so a display set
            // still on screen is closed there rather than being carried across
            // the region this seek skips.
            if config.isLive {
                let windowSeconds = liveWindowSecondsNow()
                for decoder in imageSubtitles.values {
                    decoder.flush(demuxedUpTo: demuxedUpToOutput)
                    decoder.prune(before: demuxedUpToOutput - windowSeconds)
                }
            } else {
                for decoder in imageSubtitles.values { decoder.flush(demuxedUpTo: demuxedUpTo) }
            }
            // No "still on screen" state to close: every cue carries its own end.
            for decoder in textSubtitles.values { decoder.flush() }

            // The transcoders above were rebuilt from scratch; re-derive the
            // plan so a rebuild that reached a different decision cannot leave
            // JS (and the regression suite) asserting against a stale claim.
            // No-ops when the decisions are unchanged, which is the normal case.
            reportPlan(input: input, videoIn: videoIn, audioIndices: audioIndices, audioIdentity: audioIdentity, renditions: builtRenditions)
            return true
        }

        /// Live splice: close the open segment and open a new generation, with its own init
        /// segment, on the next keyframe. The input position is untouched.
        func rollGeneration() -> Bool {
            let endSeconds = Double(lastOutputEndUs) / Double(SWIFT_AV_TIME_BASE)
            noteLiveCut(atOutputSeconds: max(endSeconds, segmentOpenSeconds + 0.001))
            finishSegment(currentSegment)
            currentSegment += 1
            generation += 1
            for rendition in builtRenditions { rendition.initGeneration = generation }
            guard rebuildRenditions() else { return false }
            stateLock.lock()
            producingSegment = currentSegment
            stateLock.unlock()
            liveResumeUs = lastOutputEndUs
            lastTimingPtsUs = nil
            lastKeyframeUs = nil
            awaitingKeyframe = true
            keyframeForcedAtSegment = -1
            partialOpenSegment = -1
            segmentsInGeneration = 0
            segmentClock = Date()
            sleptOnCap = false
            return true
        }

        /// Seek input + rebuild every rendition's muxer. False on fatal error.
        /// `failOnSeekError: false` hands the seek failure back to the caller
        /// (the input-recovery loop owns its own retry/fail decision) instead
        /// of killing the session on the first attempt.
        func restart(at segment: Int, failOnSeekError: Bool = true) -> Bool {
            let restartStart = Date()
            let containerStartUs = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : input.pointee.start_time
            let targetUs = Int64(segmentStartSeconds(segment) * Double(SWIFT_AV_TIME_BASE)) + containerStartUs
            let seekRet = avformat_seek_file(input, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
            if seekRet < 0 {
                if !failOnSeekError {
                    NSLog("[LocalRemuxer] Recovery seek to segment %d failed: %@", segment, averr(seekRet))
                    return false
                }
                // A session that cannot seek must die, not limp: continuing
                // from the current position would stamp whatever content comes
                // next with the requested segment's timestamps (or hang the
                // request entirely, as a VP6 AVI with a defective index did in
                // the harness). Failing here answers the player in
                // milliseconds and the app falls back to the server transcode.
                fail("input seek to segment \(segment) failed: \(averr(seekRet))")
                return false
            }
            guard rebuildRenditions() else { return false }

            // Provisional: the keyframe block below moves currentSegment back
            // to wherever the seek actually landed. producingSegment keeps
            // reporting the REQUESTED segment while the generation catches up
            // to it, so a waiter on that segment neither re-asserts its seek
            // (the control block drops a seek equal to producingSegment) nor
            // throttles the producer that is filling it.
            currentSegment = segment
            generationRequestSegment = segment
            partialOpenSegment = -1
            awaitingKeyframe = true
            keyframeForcedAtSegment = -1
            stateLock.lock()
            producingSegment = segment
            reachedEnd = false
            // The seek skips a region: this generation's read starts a new span.
            archiveReadSpanLocked()
            stateLock.unlock()
            NSLog("[LocalRemuxer] Seek-restart at segment %d took %.2fs", segment, Date().timeIntervalSince(restartStart))
            generation += 1
            segmentsInGeneration = 0
            segmentClock = Date()
            sleptOnCap = false
            return true
        }

        // The grid must be decided before the first cut: a flip mid-production
        // leaves already-written segments on the fixed grid under indices the
        // playlist declares on the adopted one. Free — masterPlaylist waits on
        // the same condition, so nothing can request a segment before it either.
        awaitGrid()

        readLoop: while true {
            // Session control between packets: cancellation, seeks, throttle.
            var heldThisPass = false
            while true {
                stateLock.lock()
                let stop = cancelled || failed || sourceReleased
                var seekTo = sessionAnchorUs == nil ? nil : pendingSeekSegment
                if sessionAnchorUs != nil { pendingSeekSegment = nil }
                // Drop a seek the pipeline already answered: a waiter's
                // re-assert can race the restart that is serving it, and
                // restarting again would tear the muxers down for nothing.
                if let target = seekTo,
                   target == producingSegment || (sourceTakeoverSegment == nil && (renditions.first?.completed.contains(target) ?? false)) {
                    seekTo = nil
                }
                // Never sleep while a request waits on a segment inside the
                // production window: lastRequestedSegment is overwritten by
                // every request (including ones served instantly from disk),
                // so on its own it can park the producer while a live request
                // just ahead of it starves to the 20s deadline.
                let starvedWaiter = activeWaiters.keys.contains {
                    $0 >= producingSegment && $0 <= producingSegment + aheadWindow
                }
                // Tier hold: AVPlayer is living on the server renditions and
                // nothing is consuming engine output — pause source reads so a
                // starving link is not shared with a pull nobody needs. Any
                // primary/engine-rendition request flips the timestamps and
                // reads resume within one poll tick.
                // On a link with room for the copy beside the rung, the copy is kept just ahead of
                // AVPlayer's rung fetches instead: its next try at the copy then lands on disk.
                let riding = ridingTierLocked()
                var follow = Follow.hold
                var followSeek = false
                if sessionAnchorUs != nil, riding, seekTo == nil, !stop, !starvedWaiter, copyFollowsLocked() {
                    follow = followLocked()
                    if case .seek(let target) = follow {
                        seekTo = target
                        followSeek = true
                    }
                }
                let takeoverCapacity = testLinkBps ?? wireLinkBps ?? playlistLinkBps ?? 0
                if sourceBandwidth > 0, takeoverCapacity < Double(sourceBandwidth) * 1.2 { sourceTakeoverSegment = nil }
                let takingOver = sourceTakeoverSegment != nil
                let held = sessionAnchorUs != nil && !takingOver && !demuxerOwesTracks && (riding ? follow == .hold : openingHoldLocked())
                let tierHold = held && seekTo == nil && !stop && !starvedWaiter
                // Live never throttles: the source arrives at its own pace and reads must keep up.
                let throttled = !config.isLive
                    && ((producingSegment > lastRequestedSegment + aheadWindow && seekTo == nil && !stop && !starvedWaiter) || tierHold)
                stateLock.unlock()

                if stop { break readLoop }
                // Held under a rung, the demuxer feeds no image cues: the server's copy takes over.
                if riding, tierHold { startServerImageSubtitles() }
                if let seekTo, followSeek {
                    // A move nobody asked for must not end a session that plays fine on its rung.
                    if restart(at: seekTo, failOnSeekError: false) { break }
                    stateLock.lock()
                    followDisabled = true
                    stateLock.unlock()
                    continue
                }
                if let seekTo {
                    guard restart(at: seekTo) else { break readLoop }
                    break
                }
                if !throttled { break }
                sleptOnCap = true
                heldThisPass = true
                usleep(100_000)
            }
            // A sample that spanned a hold would spread its bytes over the whole of it.
            if heldThisPass { restartLinkSample() }

            let readStarted = Date()
            if let queued = queuedPacket {
                av_packet_move_ref(pkt, queued)
                var freeing: UnsafeMutablePointer<AVPacket>? = queued
                av_packet_free(&freeing)
                queuedPacket = nil
                ret = 0
            } else {
                ret = av_read_frame(input, pkt)
            }
            let readTook = Date().timeIntervalSince(readStarted)
            readSecondsInSegment += readTook
            stateLock.lock()
            pulledReadSeconds += readTook
            stateLock.unlock()
            if ret == SWIFT_AVERROR_EOF && config.isLive {
                // The http layer reconnects on its own (reconnect_streamed). An EOF that reaches
                // the demuxer means the server closed the live stream; only a new open restores it.
                fail("live input ended")
                break
            }
            if ret == SWIFT_AVERROR_EOF {
                // Flush the transcoders first so their queued tail frames land
                // in the final segment instead of being dropped with it.
                for rendition in builtRenditions {
                    guard let ctx = rendition.ctx else { continue }
                    func writeFlushed(_ timeBase: AVRational, _ outIndex: Int32) -> (UnsafeMutablePointer<AVPacket>) -> Void {
                        return { encoded in
                            guard let outStream = ctx.pointee.streams[Int(outIndex)] else { return }
                            av_packet_rescale_ts(encoded, timeBase, outStream.pointee.time_base)
                            encoded.pointee.stream_index = outIndex
                            encoded.pointee.pos = -1
                            rendition.repairTimestamps(encoded, streamIndex: outIndex)
                            rendition.noteBaseDts(streamIndex: outIndex, dts: encoded.pointee.dts)
                            _ = av_write_frame(ctx, encoded)
                        }
                    }
                    if let videoTranscoder = rendition.videoTranscoder, let outIndex = rendition.streamMap[videoIn] {
                        videoTranscoder.process(packet: nil, emit: writeFlushed(videoTranscoder.encoderTimeBase, outIndex))
                    }
                    if let transcoder = rendition.transcoder,
                       let audioIn = rendition.inputStreams.first(where: {
                           input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO
                       }),
                       let outIndex = rendition.streamMap[audioIn] {
                        transcoder.process(packet: nil, emit: writeFlushed(transcoder.encoderTimeBase, outIndex))
                    }
                }

                // Close whatever subtitle is still on screen at EOF, so the last
                // cue of the file has a real end rather than an open one.
                for decoder in imageSubtitles.values { decoder.finish(at: config.durationSeconds) }
                for decoder in textSubtitles.values { decoder.finish() }

                finishSegment(currentSegment)
                for rendition in builtRenditions {
                    guard let ctx = rendition.ctx, let avio = rendition.avio else { continue }
                    av_write_trailer(ctx)
                    avio_flush(avio)
                    _ = rendition.takePending() // trailer bytes (mfra) are not a segment
                }

                // Reaching the end must NOT end the session: the viewer can
                // still seek backwards, and this thread is the only producer.
                // Park until a seek arrives (or the session is torn down)
                // instead of returning, and record how far the real stream
                // actually got so requests past it fail fast rather than
                // waiting out the full segment timeout.
                stateLock.lock()
                reachedEnd = true
                lastProducedSegment = currentSegment
                stateLock.unlock()

                var resume = false
                while !resume {
                    stateLock.lock()
                    let stop = cancelled || failed
                    let pending = pendingSeekSegment
                    stateLock.unlock()
                    if stop { break readLoop }
                    if pending != nil {
                        // Leave it queued; the control block at the top of the
                        // loop performs the restart.
                        resume = true
                        break
                    }
                    usleep(200_000)
                }
                continue
            }
            if ret == SWIFT_AVERROR_EXIT { break }
            if ret < 0 {
                // A seek reopens FFmpeg's http connection, so restarting at the current segment is a
                // full reconnect. Three tries; after them a VOD source retries in session, live fails.
                var recovered = false
                stateLock.lock()
                // Recovery seeks the input; a live source has nowhere to seek to.
                let allowRecovery = !cancelled && !failed && !config.isLive
                if allowRecovery { recovering = true }
                stateLock.unlock()
                if allowRecovery {
                    for attempt in 1...3 {
                        stateLock.lock()
                        let aborted = cancelled || failed
                        stateLock.unlock()
                        if aborted { break }
                        NSLog("[LocalRemuxer] Input read error (%@), recovery attempt %d/3 at segment %d", averr(ret), attempt, producingSegment)
                        if restart(at: producingSegment, failOnSeekError: false) {
                            recovered = true
                            break
                        }
                        Thread.sleep(forTimeInterval: 2)
                    }
                    stateLock.lock()
                    recovering = false
                    stateLock.unlock()
                }
                if recovered {
                    NSLog("[LocalRemuxer] Input recovered at segment %d", producingSegment)
                    continue
                }
                if allowRecovery {
                    retrySource(because: "read_frame: \(averr(ret))")
                } else {
                    fail("read_frame: \(averr(ret))")
                }
                break
            }
            defer { av_packet_unref(pkt) }
            inputBytesSinceLog += Int64(pkt.pointee.size)
            bytesInSegment += Int64(pkt.pointee.size)
            noteSourceRead(bytes: Int64(pkt.pointee.size), seconds: readTook)
            stateLock.lock()
            pulledBytes += Int64(pkt.pointee.size)
            stateLock.unlock()

            // How far the source has actually been read: the subtitle decoders'
            // "we stopped knowing here" marker on the next seek, and what the
            // app polls to decide it has enough manifest to stop asking.
            //
            // Under the lock because the HTTP queue reads it now
            // (subtitleCueManifest, and the WebVTT segment writer's wait), and
            // only for files carrying subtitles this engine decodes, which is
            // the only reason it is tracked at all.
            if !imageSubtitles.isEmpty || !textSubtitles.isEmpty, pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE,
               let packetStream = input.pointee.streams[Int(pkt.pointee.stream_index)] {
                let seconds = Double(pkt.pointee.pts) * av_q2d(packetStream.pointee.time_base)
                stateLock.lock()
                if seconds > demuxedUpTo { demuxedUpTo = seconds }
                readSpanFrom = min(readSpanFrom ?? seconds, seconds)
                if seconds > readSpanUpTo { readSpanUpTo = seconds }
                if config.isLive, !awaitingKeyframe {
                    let output = seconds - Double(timelineAnchorUs) / Double(SWIFT_AV_TIME_BASE)
                    if output > demuxedUpToOutput { demuxedUpToOutput = output }
                }
                stateLock.unlock()
            }

            // Harvested where the image ones are: the guard below drops every
            // subtitle packet, and a cue's time is its own PTS.
            let subtitleIndex = subtitleIdentity[pkt.pointee.stream_index]
            if let textDecoder = subtitleIndex.flatMap({ textSubtitles[$0] }) {
                textDecoder.handle(packet: pkt)
                continue
            }

            // Image subtitles are harvested here, before the routing guard
            // below drops them. They never enter a rendition — AVPlayer cannot
            // decode a bitmap subtitle — so they are decoded to PNGs and a
            // display-set manifest the app draws itself. This runs regardless of
            // the keyframe gate: an event's time comes from its own PTS in
            // source time, so it does not care which generation of the output
            // timeline is being produced.
            if let subtitleDecoder = subtitleIndex.flatMap({ imageSubtitles[$0] }) {
                // Live: cues before the first keyframe belong to frames never output, and the
                // rest land on the output timeline through the generation's anchor.
                if config.isLive {
                    if awaitingKeyframe { continue }
                    subtitleDecoder.sourceOffsetSeconds = Double(timelineAnchorUs) / Double(SWIFT_AV_TIME_BASE)
                }
                subtitleDecoder.handle(packet: pkt)
                continue
            }

            // Route to the rendition carrying this input stream. A stream no
            // rendition wants (an unselected audio track, subtitles) is simply
            // dropped.
            guard let rendition = builtRenditions.first(where: { $0.streamMap[pkt.pointee.stream_index] != nil }),
                  var outIndex = rendition.streamMap[pkt.pointee.stream_index],
                  var ctx = rendition.ctx,
                  let inStream = input.pointee.streams[Int(pkt.pointee.stream_index)],
                  var outStream = ctx.pointee.streams[Int(outIndex)] else { continue }

            let isVideo = hasVideo && pkt.pointee.stream_index == videoIn
            let isKey = pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0
            // Which stream drives the timeline: video where there is one, the
            // carried audio track otherwise. Anchoring and segment boundaries
            // both key off it, so an audio-only session cuts on its own packets
            // instead of waiting forever for a video keyframe that never comes.
            let isTimingStream = hasVideo ? isVideo : pkt.pointee.stream_index == audioIndices.first

            // Drop everything until the packet that opens this generation, then
            // place it on the session timeline. The anchor is whatever
            // generation 0 established and never moves, so the opening packet
            // keeps its true source time instead of being relabelled onto the
            // requested segment's boundary.
            // Live splice: the timing stream's PTS stepping back, or jumping past three
            // segments, closes the segment and rolls a generation on this very packet.
            if config.isLive && isTimingStream && !awaitingKeyframe, pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let ptsUs = av_rescale_q(pkt.pointee.pts, inStream.pointee.time_base, microTb)
                if let last = lastTimingPtsUs {
                    let delta = ptsUs - last
                    let gapLimit = Int64(3 * config.liveSegmentSeconds * Double(SWIFT_AV_TIME_BASE))
                    if delta < -1_000_000 || delta > gapLimit {
                        NSLog("[LocalRemuxer] Live splice: timing PTS stepped %.3fs at segment %d", Double(delta) / 1e6, currentSegment)
                        guard rollGeneration() else { break }
                        // The roll rebuilt every muxer: this packet may open the new generation
                        // and must reach the fresh one, never the freed context bound above.
                        guard let freshIndex = rendition.streamMap[pkt.pointee.stream_index],
                              let freshCtx = rendition.ctx,
                              let freshOut = freshCtx.pointee.streams[Int(freshIndex)] else { continue }
                        outIndex = freshIndex
                        ctx = freshCtx
                        outStream = freshOut
                    }
                }
                if isKey {
                    if let lastKey = lastKeyframeUs, ptsUs > lastKey {
                        let gap = Double(ptsUs - lastKey) / Double(SWIFT_AV_TIME_BASE)
                        stateLock.lock()
                        if gap > maxKeyframeGapSeconds { maxKeyframeGapSeconds = gap }
                        stateLock.unlock()
                    }
                    lastKeyframeUs = ptsUs
                }
                lastTimingPtsUs = ptsUs
            }

            if awaitingKeyframe {
                // Every audio frame is independently decodable, so any packet of
                // the timing stream opens an audio-only generation.
                if !(isTimingStream && (isKey || !hasVideo)) { continue }
                let anchorSource = pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE ? pkt.pointee.pts : pkt.pointee.dts
                guard anchorSource != SWIFT_AV_NOPTS_VALUE else { continue }
                let keyframeUs = av_rescale_q(anchorSource, inStream.pointee.time_base, microTb)
                if config.isLive {
                    // Generation 0 opens the timeline at 0; a rolled generation continues where
                    // the spliced segment ended, so tfdt stays monotonic across the MAP change.
                    let anchor = keyframeUs - liveResumeUs
                    sessionAnchorUs = sessionAnchorUs ?? anchor
                    timelineAnchorUs = anchor
                    stateLock.lock()
                    sessionAnchorSeconds = Double(anchor) / Double(SWIFT_AV_TIME_BASE)
                    liveGenerationStarts[currentSegment] = generation
                    liveDates[currentSegment] = Date()
                    stateLock.unlock()
                    segmentOpenSeconds = Double(liveResumeUs) / Double(SWIFT_AV_TIME_BASE)
                    partialOpenSegment = -1
                    lastTimingPtsUs = keyframeUs
                    lastKeyframeUs = keyframeUs
                    awaitingKeyframe = false
                } else {
                // The session's FIRST generation sets this anchor, so it has to open at
                // position 0: seek before it and every later segment is labelled by the offset.
                let anchor = sessionAnchorUs ?? keyframeUs
                sessionAnchorUs = anchor
                timelineAnchorUs = anchor
                // The segment writer holds cues in source time, owes output time.
                stateLock.lock()
                sessionAnchorSeconds = Double(anchor) / Double(SWIFT_AV_TIME_BASE)
                stateLock.unlock()

                // The generation opens where the keyframe actually is, not
                // where the request was. avformat_seek_file ran BACKWARD
                // bounded by the requested segment's start, so this is at or
                // before it and that segment still ends up fully covered.
                let openSeconds = Double(keyframeUs - anchor) / Double(SWIFT_AV_TIME_BASE)
                let openSegment = segmentIndex(atSeconds: openSeconds)
                if openSegment > generationRequestSegment {
                    // Only reachable through a defective index that seeks past
                    // the target. Producing from here would stamp the wrong
                    // content with the requested segment's timestamps, so die
                    // fast and let the app fall back to the server transcode,
                    // exactly as a failed seek does.
                    fail("seek for segment \(generationRequestSegment) landed in segment \(openSegment)")
                    break
                }
                currentSegment = openSegment
                partialOpenSegment = openSeconds > segmentStartSeconds(openSegment) ? openSegment : -1
                awaitingKeyframe = false
                }
            }

            // Rebase onto the output timeline.
            let offsetInTb = av_rescale_q(timelineAnchorUs, microTb, inStream.pointee.time_base)
            if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.pts -= offsetInTb }
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.dts -= offsetInTb }

            // Live: where the timing stream's output time ends, so a splice resumes there.
            if config.isLive && isTimingStream, pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let outUs = av_rescale_q(pkt.pointee.pts, inStream.pointee.time_base, microTb)
                var durationUs = pkt.pointee.duration > 0 ? av_rescale_q(pkt.pointee.duration, inStream.pointee.time_base, microTb) : 0
                if durationUs <= 0 {
                    let fps = av_q2d(inStream.pointee.avg_frame_rate)
                    durationUs = fps > 0 ? Int64(1_000_000 / fps) : 40_000
                }
                lastOutputEndUs = max(lastOutputEndUs, outUs + durationUs)
            }

            // Video through the transcoder: decode → VideoToolbox H.264.
            // Segment boundaries are cut on ENCODED packets — the encoder
            // runs a few frames behind the input, so cutting on input PTS
            // would put the wrong frames in the fragment — while the IDR
            // request rides the INPUT frame that crosses the boundary, so the
            // keyframe lands on the segment's first frame. Input packets are
            // never dropped for negative DTS here: the decoder needs them,
            // and VideoTranscoder drops pre-anchor frames itself.
            if isVideo, let videoTranscoder = rendition.videoTranscoder {
                if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE, keyframeForcedAtSegment != currentSegment {
                    let seconds = Double(pkt.pointee.pts) * av_q2d(inStream.pointee.time_base)
                    if seconds >= nextBoundarySeconds() {
                        videoTranscoder.forceKeyframeNext()
                        keyframeForcedAtSegment = currentSegment
                    }
                }

                var writeError: Int32 = 0
                videoTranscoder.process(packet: pkt) { encoded in
                    guard writeError == 0 else { return }
                    if encoded.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                        let seconds = Double(encoded.pointee.pts) * av_q2d(videoTranscoder.encoderTimeBase)
                        let boundary = nextBoundarySeconds()
                        if seconds >= boundary && seconds > 0 && currentSegment + 1 < segmentCount {
                            if config.isLive { noteLiveCut(atOutputSeconds: seconds) }
                            finishSegment(currentSegment)
                            currentSegment += 1
                            stateLock.lock()
                            // Floored at the requested segment: a generation
                            // that opened on an earlier keyframe must not
                            // advertise a position behind what it was asked
                            // for, or the waiter on that segment would keep
                            // re-asserting its seek and restart the pipeline
                            // onto the same keyframe forever.
                            producingSegment = max(currentSegment, generationRequestSegment)
                            stateLock.unlock()
                        }
                    }
                    av_packet_rescale_ts(encoded, videoTranscoder.encoderTimeBase, outStream.pointee.time_base)
                    encoded.pointee.stream_index = outIndex
                    encoded.pointee.pos = -1
                    rendition.repairTimestamps(encoded, streamIndex: outIndex)
                    rendition.noteBaseDts(streamIndex: outIndex, dts: encoded.pointee.dts)
                    let w = av_write_frame(ctx, encoded)
                    if w < 0 { writeError = w }
                }
                if videoTranscoder.failed {
                    fail("video transcode failed (pixel format or encoder rejection)")
                    break
                }
                if writeError < 0 {
                    fail("write_frame (video): \(averr(writeError))")
                    break
                }
                continue
            }

            // Drop anything landing before the output timeline's zero. Video:
            // a leading B-frame can carry a DTS just behind the anchor — it
            // belongs to the previous GOP and would break the muxer's
            // monotonic-DTS requirement. Copied audio: the first packet of an
            // AAC-in-MKV stream is the encoder's priming frame at a NEGATIVE
            // timestamp; fed raw to the mp4 muxer, its per-track shift
            // desyncs the track and stamps a bogus first-sample duration that
            // CoreMedia's HLS validator rejects wholesale (-12927 on HEVC
            // files, found by the HDR10 harness run — ffmpeg's CLI avoids it
            // by globally shifting all input timestamps instead).
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE, pkt.pointee.dts < 0 { continue }

            // Segment boundary: close the fragment on the first video packet
            // at or past the next segment's start time.
            //
            // Deliberately NOT keyframe-gated. Files whose keyframes are
            // sparser than the segment length (a 10s GOP against 6s segments)
            // would otherwise skip whole segment indices, and every skipped
            // index is a hard 404 for a segment the playlist promises. Closing
            // on the boundary and advancing exactly one segment guarantees
            // every declared index gets written. Seeks still land on a
            // keyframe, because a seek-restart re-anchors there.
            //
            // Live is the exception: this block sees only copied video and audio (transcoded
            // video cuts on its own encoded stream above and never falls through). A copied
            // segment MUST open on a keyframe (Apple authoring spec 7.4), so a live cut waits
            // for the next keyframe past the target: a source keyframe interval longer than the
            // target yields a longer segment, never a mid-GOP cut that leaves the next segment
            // undecodable. TARGETDURATION is frozen from the first real segment (livePlaylist)
            // with a keyframe interval of headroom, so it accommodates them. Audio-only carries
            // no video, so every packet is a keyframe and the cut lands on the target.
            if isTimingStream && pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let seconds = Double(pkt.pointee.pts) * av_q2d(inStream.pointee.time_base)
                let boundary = nextBoundarySeconds()
                let cutAllowed = config.isLive ? isKey : currentSegment + 1 < segmentCount
                if seconds >= boundary && seconds > 0 && cutAllowed {
                    if config.isLive { noteLiveCut(atOutputSeconds: seconds) }
                    finishSegment(currentSegment)
                    currentSegment += 1
                    stateLock.lock()
                    // Floored at the requested segment, same reason as the
                    // transcode path above.
                    producingSegment = max(currentSegment, generationRequestSegment)
                    stateLock.unlock()
                }
            }

            // Transcoded audio: the encoder emits its own packets on its own
            // clock, so the input packet is consumed rather than written.
            if !isVideo, let transcoder = rendition.transcoder {
                var writeError: Int32 = 0
                transcoder.process(packet: pkt) { encoded in
                    guard writeError == 0 else { return }
                    av_packet_rescale_ts(encoded, transcoder.encoderTimeBase, outStream.pointee.time_base)
                    encoded.pointee.stream_index = outIndex
                    encoded.pointee.pos = -1
                    rendition.repairTimestamps(encoded, streamIndex: outIndex)
                    rendition.noteBaseDts(streamIndex: outIndex, dts: encoded.pointee.dts)
                    let w = av_write_frame(ctx, encoded)
                    if w < 0 { writeError = w }
                }
                if writeError < 0 {
                    fail("write_frame (audio): \(averr(writeError))")
                    break
                }
                continue
            }

            // Profile 7 to 8.1: the RPU is rewritten and the enhancement layer dropped, before
            // any timestamp work, so the packet the muxer sees is the one it will write.
            if isVideo, let converter = rendition.dolbyVision, !converter.rewrite(packet: pkt) {
                fail("Dolby Vision rewrite rejected a malformed video packet")
                break
            }

            // The ADTS header (9 bytes with its CRC) is not part of an MP4 sample.
            if rendition.adtsStreams.contains(outIndex), pkt.pointee.size > 9, let data = pkt.pointee.data,
               data[0] == 0xFF, data[1] & 0xF0 == 0xF0 {
                let header = data[1] & 0x01 == 0 ? 9 : 7
                pkt.pointee.data = data + header
                pkt.pointee.size -= Int32(header)
            }

            av_packet_rescale_ts(pkt, inStream.pointee.time_base, outStream.pointee.time_base)
            pkt.pointee.stream_index = outIndex
            pkt.pointee.pos = -1
            rendition.repairTimestamps(pkt, streamIndex: outIndex)
            rendition.noteBaseDts(streamIndex: outIndex, dts: pkt.pointee.dts)

            ret = av_write_frame(ctx, pkt)
            if ret < 0 {
                fail("write_frame: \(averr(ret))")
                break
            }
        }
    }

    /// Drop segments that sit outside the window around the playhead, across
    /// every rendition.
    func pruneSegments(outside keep: ClosedRange<Int>) {
        stateLock.lock()
        var doomed: [(Rendition, [Int])] = []
        for rendition in renditions {
            let prunable = rendition.completed.filter { !keep.contains($0) }
            guard !prunable.isEmpty else { continue }
            rendition.completed.subtract(prunable)
            doomed.append((rendition, Array(prunable)))
        }
        stateLock.unlock()

        for (rendition, indices) in doomed {
            for n in indices {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(rendition.segmentName(n)))
            }
        }

        if config.isLive {
            // A generation whose every segment left the window takes its init file and
            // its bookkeeping with it; generation 0's entry anchors the lookup and stays.
            stateLock.lock()
            let first = keep.lowerBound
            let current = liveGenerationStarts.filter { $0.key <= first }.values.max() ?? 0
            let stale = liveGenerationStarts.filter { $0.value > 0 && $0.value < current }
            liveDiscontinuitiesRemoved += stale.count
            for segment in stale.keys { liveGenerationStarts.removeValue(forKey: segment) }
            for n in liveDurations.keys where n < first { liveDurations.removeValue(forKey: n) }
            for n in liveDates.keys where n < first { liveDates.removeValue(forKey: n) }
            let staleInits = stale.values.flatMap { generation in
                renditions.map { Self.liveInitName(prefix: $0.prefix, generation: generation) }
            }
            stateLock.unlock()
            for name in staleInits {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
            }
            return
        }

        // Tier segments follow the same window on every rung; init files are never pruned.
        stateLock.lock()
        var prunablePerRung: [Int: Set<Int>] = [:]
        for (rung, materialized) in tierMaterialized {
            let prunable = materialized.filter { !keep.contains($0) }
            if !prunable.isEmpty {
                prunablePerRung[rung] = prunable
                tierMaterialized[rung] = materialized.subtracting(prunable)
            }
        }
        stateLock.unlock()
        for (rung, prunable) in prunablePerRung {
            for n in prunable {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("t\(rung)-seg\(n).m4s"))
            }
        }

        // Audio-lo renditions live on their own grid; keep the same TIME
        // window the video range spans (translated through both grids).
        let lowerTime = segmentStartSeconds(keep.lowerBound)
        let upperTime = segmentStartSeconds(keep.upperBound) + segmentDurationSeconds(keep.upperBound)
        stateLock.lock()
        var audioDoomed: [(Int, [Int])] = []
        for (key, materialized) in audioLoMaterialized {
            guard let segments = audioLoSegments[key], !segments.isEmpty else { continue }
            var starts: [Double] = []
            var acc = 0.0
            for seg in segments {
                starts.append(acc)
                acc += seg.duration
            }
            let prunable = materialized.filter { n in
                n < starts.count && (starts[n] + segments[n].duration < lowerTime || starts[n] > upperTime)
            }
            guard !prunable.isEmpty else { continue }
            audioLoMaterialized[key]?.subtract(prunable)
            audioDoomed.append((key, Array(prunable)))
        }
        stateLock.unlock()
        for (key, indices) in audioDoomed {
            for n in indices {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(serverAudioPrefix(key))-seg\(n).m4s"))
            }
        }
    }
}
