//
//  DownloadRepackager.swift
//  TomoTV
//
//  Rewraps a completed download into MP4 once, so playback opens the file
//  directly through AVPlayer instead of standing up a remux session for it.
//
//  Nothing is re-encoded: video and audio are stream-copied and text subtitles
//  are converted to tx3g, the only subtitle form MP4 carries and AVFoundation
//  renders from a local file. Anything this cannot carry losslessly is declined,
//  and a declined item keeps playing through the engine exactly as before.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg macros are invisible to Swift; same literals the sibling files define.
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE: Int32 = 1_000_000

private func repackErr(_ code: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buf, buf.count)
    return String(cString: buf)
}

/// Wraps the cancellation closure so it can cross into an FFmpeg C callback.
private final class CancelBox {
    let isCancelled: () -> Bool
    init(_ isCancelled: @escaping () -> Bool) { self.isCancelled = isCancelled }
}

final class DownloadRepackager {

    /// Video AVPlayer decodes from an MP4 as it stands. Everything else would need a
    /// full re-encode of the file, which is a different feature from a rewrap.
    private static let copyableVideo: Set<AVCodecID> = [AV_CODEC_ID_H264, AV_CODEC_ID_HEVC]

    /// Audio MP4 carries and AVFoundation plays. AC-3 and E-AC-3 are in because
    /// a device probe confirmed a copied 5.1 AC-3 track plays from a local MP4.
    private static let copyableAudio: Set<AVCodecID> = [
        AV_CODEC_ID_AAC, AV_CODEC_ID_ALAC, AV_CODEC_ID_AC3, AV_CODEC_ID_EAC3, AV_CODEC_ID_MP3,
    ]

    struct Report {
        /// Source stream indices of the subtitle tracks written, in output order, so the
        /// player can map an AVFoundation ordinal back to a Jellyfin stream index.
        let subtitleStreamIndices: [Int]
        /// Audio the container could not carry; logged rather than silently lost.
        let droppedAudioIndices: [Int]
        let durationSeconds: Double
    }

    enum Failure: LocalizedError {
        /// The file stays as it is and keeps its engine session. Not an error state.
        /// `permanent` separates what this file will never allow from what this build
        /// happens not to support yet, so only the second kind is ever retried.
        case declined(String, permanent: Bool)
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .declined(let reason, _): return reason
            case .failed(let reason): return reason
            }
        }
    }

    private static let interruptCallback: @convention(c) (UnsafeMutableRawPointer?) -> Int32 = { opaque in
        guard let opaque else { return 0 }
        return Unmanaged<CancelBox>.fromOpaque(opaque).takeUnretainedValue().isCancelled() ? 1 : 0
    }

    /// Whether the build can write tx3g. Without it a file carrying text subtitles is
    /// declined rather than repackaged into one that has lost them.
    static var canWriteTextSubtitles: Bool {
        avcodec_find_encoder_by_name("mov_text") != nil
    }

    // MARK: - Entry

    static func run(
        inputPath: String,
        outputPath: String,
        isCancelled: @escaping () -> Bool,
        progress: @escaping (Double) -> Void
    ) throws -> Report {
        let cancelBox = CancelBox(isCancelled)
        let opaque = Unmanaged.passUnretained(cancelBox).toOpaque()

        // ---- Input ----
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard inputCtx != nil else { throw Failure.failed("avformat_alloc_context") }
        inputCtx!.pointee.interrupt_callback = AVIOInterruptCB(callback: interruptCallback, opaque: opaque)

        var ret = avformat_open_input(&inputCtx, inputPath, nil, nil)
        guard ret >= 0, let input = inputCtx else { throw Failure.failed("open_input: \(repackErr(ret))") }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }

        ret = avformat_find_stream_info(input, nil)
        guard ret >= 0 else { throw Failure.failed("find_stream_info: \(repackErr(ret))") }

        let durationSeconds = input.pointee.duration != SWIFT_AV_NOPTS_VALUE
            ? Double(input.pointee.duration) / Double(SWIFT_AV_TIME_BASE)
            : 0

        // ---- Decide what can be carried ----
        let plan = try makePlan(input: input)

        // ---- Output ----
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        ret = avformat_alloc_output_context2(&outputCtx, nil, "mp4", outputPath)
        guard ret >= 0, let output = outputCtx else { throw Failure.failed("alloc_output: \(repackErr(ret))") }
        // The Dolby Vision configuration record rides the copied HEVC stream, and the mp4
        // muxer refuses to write dvcC/dvvC at the default compliance level.
        output.pointee.strict_std_compliance = FF_COMPLIANCE_UNOFFICIAL

        var subtitleCoders: [SubtitleCoder] = []
        var committed = false
        defer {
            subtitleCoders.forEach { $0.close() }
            if !committed {
                if output.pointee.pb != nil { avio_closep(&output.pointee.pb) }
                avformat_free_context(output)
            }
        }

        var streamMap = [Int32: Int32]()

        for index in plan.copyStreams {
            guard let inStream = input.pointee.streams[Int(index)],
                  let outStream = avformat_new_stream(output, nil) else {
                throw Failure.failed("avformat_new_stream")
            }
            ret = avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar)
            guard ret >= 0 else { throw Failure.failed("parameters_copy: \(repackErr(ret))") }
            outStream.pointee.time_base = inStream.pointee.time_base
            // The muxer defaults HEVC to the 'hev1' sample entry, which AVFoundation
            // refuses; Apple requires 'hvc1', valid here because a demuxed source
            // always carries hvcC extradata.
            outStream.pointee.codecpar.pointee.codec_tag =
                outStream.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_HEVC ? tag("hvc1") : 0
            copyLanguage(from: inStream, to: outStream)
            outStream.pointee.disposition = inStream.pointee.disposition
            streamMap[index] = Int32(output.pointee.nb_streams - 1)
        }

        for index in plan.textSubtitleStreams {
            guard let inStream = input.pointee.streams[Int(index)] else {
                throw Failure.failed("missing subtitle stream \(index)")
            }
            let coder = try SubtitleCoder(source: inStream)
            guard let outStream = avformat_new_stream(output, nil) else {
                coder.close()
                throw Failure.failed("avformat_new_stream (subtitle)")
            }
            ret = avcodec_parameters_from_context(outStream.pointee.codecpar, coder.encoder)
            guard ret >= 0 else {
                coder.close()
                throw Failure.failed("parameters_from_context: \(repackErr(ret))")
            }
            outStream.pointee.time_base = coder.encoder.pointee.time_base
            copyLanguage(from: inStream, to: outStream)
            outStream.pointee.disposition = inStream.pointee.disposition
            coder.outputIndex = Int32(output.pointee.nb_streams - 1)
            subtitleCoders.append(coder)
            streamMap[index] = coder.outputIndex
        }

        ret = avio_open(&output.pointee.pb, outputPath, AVIO_FLAG_WRITE)
        guard ret >= 0 else { throw Failure.failed("avio_open: \(repackErr(ret))") }

        // faststart relocates the moov to the front on write_trailer, which is what lets
        // AVPlayer open without seeking to the tail. It also means the moov is written
        // after the muxer has seen packets, so AC-3 needs no special ordering here.
        var muxOpts: OpaquePointer? = nil
        av_dict_set(&muxOpts, "movflags", "faststart", 0)
        ret = avformat_write_header(output, &muxOpts)
        av_dict_free(&muxOpts)
        guard ret >= 0 else { throw Failure.failed("write_header: \(repackErr(ret))") }

        try pump(
            input: input,
            output: output,
            streamMap: streamMap,
            subtitleCoders: subtitleCoders,
            durationSeconds: durationSeconds,
            isCancelled: isCancelled,
            progress: progress
        )

        ret = av_write_trailer(output)
        guard ret >= 0 else { throw Failure.failed("write_trailer: \(repackErr(ret))") }

        avio_closep(&output.pointee.pb)
        avformat_free_context(output)
        committed = true

        return Report(
            subtitleStreamIndices: plan.textSubtitleStreams.map { Int($0) },
            droppedAudioIndices: plan.droppedAudio.map { Int($0) },
            durationSeconds: durationSeconds
        )
    }

    // MARK: - Planning

    private struct Plan {
        let copyStreams: [Int32]
        let textSubtitleStreams: [Int32]
        let droppedAudio: [Int32]
    }

    private static func makePlan(input: UnsafeMutablePointer<AVFormatContext>) throws -> Plan {
        let count = Int32(input.pointee.nb_streams)
        var copyStreams: [Int32] = []
        var textSubtitles: [Int32] = []
        var droppedAudio: [Int32] = []
        var sawAudio = false
        var carriedAudio = false

        let videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        if videoIn >= 0 {
            guard let stream = input.pointee.streams[Int(videoIn)] else {
                throw Failure.failed("missing video stream")
            }
            let id = stream.pointee.codecpar.pointee.codec_id
            guard copyableVideo.contains(id) else {
                throw Failure.declined("video codec \(codecName(id)) cannot be copied into MP4", permanent: true)
            }
            copyStreams.append(videoIn)
        }

        for index in 0..<count where index != videoIn {
            guard let stream = input.pointee.streams[Int(index)] else { continue }
            let params = stream.pointee.codecpar.pointee
            switch params.codec_type {
            case AVMEDIA_TYPE_AUDIO:
                sawAudio = true
                if copyableAudio.contains(params.codec_id) {
                    copyStreams.append(index)
                    carriedAudio = true
                } else {
                    droppedAudio.append(index)
                }
            case AVMEDIA_TYPE_SUBTITLE:
                // Image subtitles are bitmaps; MP4 has no track for them and AVPlayer has
                // no renderer. The engine decodes and draws those, so the file keeps it.
                if isImageSubtitle(params.codec_id) {
                    throw Failure.declined("image subtitles need the engine's overlay", permanent: true)
                }
                guard canWriteTextSubtitles else {
                    throw Failure.declined("this build has no mov_text encoder", permanent: false)
                }
                textSubtitles.append(index)
            default:
                continue
            }
        }

        if sawAudio && !carriedAudio {
            throw Failure.declined("no audio track can be copied into MP4", permanent: true)
        }
        if copyStreams.isEmpty {
            throw Failure.declined("nothing to carry", permanent: true)
        }
        return Plan(copyStreams: copyStreams, textSubtitleStreams: textSubtitles, droppedAudio: droppedAudio)
    }

    private static func isImageSubtitle(_ id: AVCodecID) -> Bool {
        switch id {
        case AV_CODEC_ID_HDMV_PGS_SUBTITLE, AV_CODEC_ID_DVD_SUBTITLE,
             AV_CODEC_ID_DVB_SUBTITLE, AV_CODEC_ID_XSUB, AV_CODEC_ID_HDMV_TEXT_SUBTITLE:
            return true
        default:
            return false
        }
    }

    // MARK: - Packet loop

    private static func pump(
        input: UnsafeMutablePointer<AVFormatContext>,
        output: UnsafeMutablePointer<AVFormatContext>,
        streamMap: [Int32: Int32],
        subtitleCoders: [SubtitleCoder],
        durationSeconds: Double,
        isCancelled: @escaping () -> Bool,
        progress: @escaping (Double) -> Void
    ) throws {
        var packet = av_packet_alloc()
        guard packet != nil else { throw Failure.failed("av_packet_alloc") }
        defer { av_packet_free(&packet) }

        let coderByInput = Dictionary(uniqueKeysWithValues: subtitleCoders.map { ($0.inputIndex, $0) })
        var lastReported = -1.0

        while true {
            if isCancelled() { throw Failure.failed("cancelled") }

            let read = av_read_frame(input, packet)
            if read == SWIFT_AVERROR_EOF { break }
            guard read >= 0 else { throw Failure.failed("read_frame: \(repackErr(read))") }
            defer { av_packet_unref(packet) }

            let inIndex = packet!.pointee.stream_index
            guard let outIndex = streamMap[inIndex],
                  let inStream = input.pointee.streams[Int(inIndex)],
                  let outStream = output.pointee.streams[Int(outIndex)] else { continue }

            if let coder = coderByInput[inIndex] {
                try coder.convert(packet: packet!, inStream: inStream, outStream: outStream, output: output)
            } else {
                av_packet_rescale_ts(packet, inStream.pointee.time_base, outStream.pointee.time_base)
                // Matroska leaves dts unset on the opening packets and the muxer says so.
                // It is passed through: deriving dts from pts reorders B-frame streams,
                // measured as a non-monotonic dts the muxer then rejects outright.
                packet!.pointee.stream_index = outIndex
                packet!.pointee.pos = -1
                let wrote = av_interleaved_write_frame(output, packet)
                guard wrote >= 0 else { throw Failure.failed("write_frame: \(repackErr(wrote))") }
            }

            // Progress off the primary clock, reported at whole percents.
            if durationSeconds > 0, packet!.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let seconds = Double(packet!.pointee.pts) * av_q2d(inStream.pointee.time_base)
                let fraction = min(max(seconds / durationSeconds, 0), 1)
                if fraction - lastReported >= 0.01 {
                    lastReported = fraction
                    progress(fraction)
                }
            }
        }
    }

    // MARK: - Helpers

    private static func tag(_ value: String) -> UInt32 {
        let bytes = Array(value.utf8)
        guard bytes.count == 4 else { return 0 }
        return UInt32(bytes[0]) | UInt32(bytes[1]) << 8 | UInt32(bytes[2]) << 16 | UInt32(bytes[3]) << 24
    }

    private static func codecName(_ id: AVCodecID) -> String {
        guard let name = avcodec_get_name(id) else { return "unknown" }
        return String(cString: name)
    }

    /// The picker labels tracks by language, so a copied stream that lost its tag would
    /// come through the native menu unnamed.
    private static func copyLanguage(from inStream: UnsafeMutablePointer<AVStream>, to outStream: UnsafeMutablePointer<AVStream>) {
        guard let entry = av_dict_get(inStream.pointee.metadata, "language", nil, 0) else { return }
        av_dict_set(&outStream.pointee.metadata, "language", entry.pointee.value, 0)
    }
}

// MARK: - Subtitle conversion

/// One text subtitle track on its way to tx3g: the source decodes to ASS, which is what
/// the movtext encoder takes. Subtitles never moved to the send/receive API, so this is
/// the decode_subtitle2 / encode_subtitle pair rather than a packet loop.
private final class SubtitleCoder {
    let inputIndex: Int32
    var outputIndex: Int32 = -1
    private(set) var decoder: UnsafeMutablePointer<AVCodecContext>
    private(set) var encoder: UnsafeMutablePointer<AVCodecContext>
    private var buffer: UnsafeMutablePointer<UInt8>
    private let bufferSize = 1 << 20

    init(source: UnsafeMutablePointer<AVStream>) throws {
        inputIndex = source.pointee.index

        let codecId = source.pointee.codecpar.pointee.codec_id
        guard let decoderCodec = avcodec_find_decoder(codecId),
              let decoderCtx = avcodec_alloc_context3(decoderCodec) else {
            throw DownloadRepackager.Failure.declined("no decoder for subtitle stream \(inputIndex)", permanent: true)
        }
        var ret = avcodec_parameters_to_context(decoderCtx, source.pointee.codecpar)
        guard ret >= 0 else {
            var freeing: UnsafeMutablePointer<AVCodecContext>? = decoderCtx
            avcodec_free_context(&freeing)
            throw DownloadRepackager.Failure.failed("subtitle parameters_to_context: \(repackErr(ret))")
        }
        decoderCtx.pointee.pkt_timebase = source.pointee.time_base
        ret = avcodec_open2(decoderCtx, decoderCodec, nil)
        guard ret >= 0 else {
            var freeing: UnsafeMutablePointer<AVCodecContext>? = decoderCtx
            avcodec_free_context(&freeing)
            throw DownloadRepackager.Failure.failed("subtitle decoder open: \(repackErr(ret))")
        }

        guard let encoderCodec = avcodec_find_encoder_by_name("mov_text"),
              let encoderCtx = avcodec_alloc_context3(encoderCodec) else {
            var freeing: UnsafeMutablePointer<AVCodecContext>? = decoderCtx
            avcodec_free_context(&freeing)
            throw DownloadRepackager.Failure.declined("this build has no mov_text encoder", permanent: false)
        }
        // movtext parses ASS dialogue, so it needs the decoder's ASS header to know the
        // field order. Without it the encoder opens and then writes empty cues.
        if let header = decoderCtx.pointee.subtitle_header, decoderCtx.pointee.subtitle_header_size > 0 {
            let size = Int(decoderCtx.pointee.subtitle_header_size)
            if let copy = av_mallocz(size + Int(AV_INPUT_BUFFER_PADDING_SIZE)) {
                memcpy(copy, header, size)
                encoderCtx.pointee.subtitle_header = copy.assumingMemoryBound(to: UInt8.self)
                encoderCtx.pointee.subtitle_header_size = Int32(size)
            }
        }
        encoderCtx.pointee.time_base = AVRational(num: 1, den: 1000)
        ret = avcodec_open2(encoderCtx, encoderCodec, nil)
        guard ret >= 0 else {
            var freeingDec: UnsafeMutablePointer<AVCodecContext>? = decoderCtx
            var freeingEnc: UnsafeMutablePointer<AVCodecContext>? = encoderCtx
            avcodec_free_context(&freeingDec)
            avcodec_free_context(&freeingEnc)
            throw DownloadRepackager.Failure.failed("mov_text open: \(repackErr(ret))")
        }

        guard let scratch = av_malloc(bufferSize) else {
            var freeingDec: UnsafeMutablePointer<AVCodecContext>? = decoderCtx
            var freeingEnc: UnsafeMutablePointer<AVCodecContext>? = encoderCtx
            avcodec_free_context(&freeingDec)
            avcodec_free_context(&freeingEnc)
            throw DownloadRepackager.Failure.failed("subtitle buffer")
        }

        decoder = decoderCtx
        encoder = encoderCtx
        buffer = scratch.assumingMemoryBound(to: UInt8.self)
    }

    func convert(
        packet: UnsafeMutablePointer<AVPacket>,
        inStream: UnsafeMutablePointer<AVStream>,
        outStream: UnsafeMutablePointer<AVStream>,
        output: UnsafeMutablePointer<AVFormatContext>
    ) throws {
        var subtitle = AVSubtitle()
        var got: Int32 = 0
        let decoded = avcodec_decode_subtitle2(decoder, &subtitle, &got, packet)
        guard decoded >= 0 else { throw DownloadRepackager.Failure.failed("decode_subtitle: \(repackErr(decoded))") }
        guard got != 0 else { return }
        defer { avsubtitle_free(&subtitle) }

        let size = avcodec_encode_subtitle(encoder, buffer, Int32(bufferSize), &subtitle)
        guard size >= 0 else { throw DownloadRepackager.Failure.failed("encode_subtitle: \(repackErr(size))") }
        guard size > 0 else { return }

        var out = av_packet_alloc()
        guard out != nil else { throw DownloadRepackager.Failure.failed("av_packet_alloc (subtitle)") }
        defer { av_packet_free(&out) }
        let alloc = av_new_packet(out, size)
        guard alloc >= 0 else { throw DownloadRepackager.Failure.failed("av_new_packet: \(repackErr(alloc))") }
        memcpy(out!.pointee.data, buffer, Int(size))

        // Display times are milliseconds from the packet's own pts, which is what carries
        // a cue's start and how long it stays up.
        let base = packet.pointee.pts != SWIFT_AV_NOPTS_VALUE ? packet.pointee.pts : 0
        let startMs = Int64(subtitle.start_display_time)
        let endMs = Int64(subtitle.end_display_time)
        let msTb = AVRational(num: 1, den: 1000)
        let pts = av_rescale_q(base, inStream.pointee.time_base, outStream.pointee.time_base)
            + av_rescale_q(startMs, msTb, outStream.pointee.time_base)

        out!.pointee.stream_index = outputIndex
        out!.pointee.pts = pts
        out!.pointee.dts = pts
        out!.pointee.duration = av_rescale_q(max(endMs - startMs, 0), msTb, outStream.pointee.time_base)
        out!.pointee.pos = -1

        let wrote = av_interleaved_write_frame(output, out)
        guard wrote >= 0 else { throw DownloadRepackager.Failure.failed("write_frame (subtitle): \(repackErr(wrote))") }
    }

    func close() {
        av_free(buffer)
        var freeingDec: UnsafeMutablePointer<AVCodecContext>? = decoder
        var freeingEnc: UnsafeMutablePointer<AVCodecContext>? = encoder
        avcodec_free_context(&freeingDec)
        avcodec_free_context(&freeingEnc)
    }
}
