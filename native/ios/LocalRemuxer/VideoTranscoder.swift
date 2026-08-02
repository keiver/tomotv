//
//  VideoTranscoder.swift
//  TomoTV
//
//  Decodes video AVPlayer cannot play (VP8, VP9, MPEG-2, MPEG-4/DivX) and
//  re-encodes it to H.264 with VideoToolbox, so it can ride the same local HLS
//  pipeline and keep AVPlayer's native transport controls.
//
//  Every other client solves exotic codecs by decoding in software and drawing
//  the frames itself, which forfeits the native player. The extra cost here is
//  only the encode, which runs on dedicated silicon; the software decode is
//  identical and is the dominant cost either way.
//
//  Pixel formats line up without a scaler: the VideoToolbox encoder accepts
//  yuv420p, which is what these decoders emit, so libswscale is not linked.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

private let SWIFT_AVERROR_EAGAIN_VT: Int32 = -35
private let SWIFT_AVERROR_EOF_VT: Int32 = -541_478_725
private let SWIFT_AV_NOPTS_VALUE_VT = Int64(bitPattern: 0x8000_0000_0000_0000)

/// Result of a throughput measurement.
struct VideoTranscodeBenchmark {
    let framesEncoded: Int
    let seconds: Double
    let sourceFrameRate: Double
    let width: Int32
    let height: Int32
    /// Encoded frames per second achieved.
    var fps: Double { seconds > 0 ? Double(framesEncoded) / seconds : 0 }
    /// How much faster than real time. Below 1.0 means playback would stall.
    var realtimeFactor: Double { sourceFrameRate > 0 ? fps / sourceFrameRate : 0 }
}

final class VideoTranscoder {
    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    private var encoder: UnsafeMutablePointer<AVCodecContext>?
    private var frame: UnsafeMutablePointer<AVFrame>?

    private(set) var encoderParameters: UnsafeMutablePointer<AVCodecParameters>?
    private(set) var framesEncoded = 0
    var encoderTimeBase: AVRational { encoder?.pointee.time_base ?? AVRational(num: 1, den: 90000) }

    /// Video codecs AVPlayer can already decode, which must be stream-copied
    /// rather than sent through here.
    static func needsTranscode(codecId: AVCodecID) -> Bool {
        switch codecId {
        case AV_CODEC_ID_H264, AV_CODEC_ID_HEVC:
            return false
        default:
            return true
        }
    }

    /// - Parameter keyframeInterval: seconds between forced IDRs. Matching the
    ///   HLS segment length means every segment can open on a keyframe, which
    ///   the copy path cannot guarantee.
    init?(inputStream: UnsafeMutablePointer<AVStream>, keyframeInterval: Double = 6.0, maxBitrate: Int64 = 12_000_000) {
        let params = inputStream.pointee.codecpar!

        guard let decoderCodec = avcodec_find_decoder(params.pointee.codec_id),
              let decCtx = avcodec_alloc_context3(decoderCodec) else {
            NSLog("[VideoTranscoder] No decoder for codec id %d", params.pointee.codec_id.rawValue)
            return nil
        }
        decoder = decCtx
        guard avcodec_parameters_to_context(decCtx, params) >= 0 else { return nil }
        // Software decode of VP9/MPEG-2 is the expensive half; let it use every
        // core rather than running single-threaded.
        decCtx.pointee.thread_count = 0
        guard avcodec_open2(decCtx, decoderCodec, nil) >= 0 else {
            NSLog("[VideoTranscoder] Failed to open decoder")
            return nil
        }

        guard let encCodec = avcodec_find_encoder_by_name("h264_videotoolbox"),
              let encCtx = avcodec_alloc_context3(encCodec) else {
            NSLog("[VideoTranscoder] h264_videotoolbox unavailable")
            return nil
        }
        encoder = encCtx

        encCtx.pointee.width = params.pointee.width
        encCtx.pointee.height = params.pointee.height
        encCtx.pointee.pix_fmt = AV_PIX_FMT_YUV420P
        encCtx.pointee.sample_aspect_ratio = params.pointee.sample_aspect_ratio

        // Frame rate: prefer the stream's average, fall back to 30.
        let guessed = av_guess_frame_rate(nil, inputStream, nil)
        let fps = guessed.den > 0 ? Double(guessed.num) / Double(guessed.den) : 30.0
        encCtx.pointee.time_base = AVRational(num: guessed.den > 0 ? guessed.den : 1, den: guessed.num > 0 ? guessed.num : 30)
        encCtx.pointee.framerate = guessed.num > 0 ? guessed : AVRational(num: 30, den: 1)
        encCtx.pointee.gop_size = Int32(max(1, (fps * keyframeInterval).rounded()))
        // B-frames complicate DTS across fragment boundaries for no real gain
        // at these bitrates.
        encCtx.pointee.max_b_frames = 0
        encCtx.pointee.bit_rate = min(params.pointee.bit_rate > 0 ? params.pointee.bit_rate : maxBitrate, maxBitrate)
        encCtx.pointee.flags |= AV_CODEC_FLAG_GLOBAL_HEADER
        // Favour throughput over compression: this races playback.
        av_opt_set(encCtx.pointee.priv_data, "realtime", "1", 0)

        guard avcodec_open2(encCtx, encCodec, nil) >= 0 else {
            NSLog("[VideoTranscoder] Failed to open h264_videotoolbox encoder")
            return nil
        }

        frame = av_frame_alloc()

        let outParams = avcodec_parameters_alloc()
        guard let outParams, avcodec_parameters_from_context(outParams, encCtx) >= 0 else { return nil }
        encoderParameters = outParams
    }

    deinit {
        avcodec_free_context(&decoder)
        avcodec_free_context(&encoder)
        av_frame_free(&frame)
        avcodec_parameters_free(&encoderParameters)
    }

    /// Feed one packet; `emit` receives each encoded H.264 packet. Pass nil to
    /// flush at end of stream.
    func process(packet: UnsafeMutablePointer<AVPacket>?, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let decoder, let encoder, let frame else { return }
        guard avcodec_send_packet(decoder, packet) >= 0 else { return }

        while avcodec_receive_frame(decoder, frame) >= 0 {
            defer { av_frame_unref(frame) }
            // The encoder runs on the frame's own presentation time.
            frame.pointee.pts = frame.pointee.best_effort_timestamp
            drainEncoder(sending: frame, emit: emit)
        }

        if packet == nil {
            drainEncoder(sending: nil, emit: emit)
        }
        _ = encoder // silence unused warning in release builds
    }

    private func drainEncoder(sending frame: UnsafeMutablePointer<AVFrame>?, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let encoder else { return }
        guard avcodec_send_frame(encoder, frame) >= 0 else { return }

        guard let out = av_packet_alloc() else { return }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = out
            av_packet_free(&freeing)
        }

        while true {
            let ret = avcodec_receive_packet(encoder, out)
            if ret == SWIFT_AVERROR_EAGAIN_VT || ret == SWIFT_AVERROR_EOF_VT || ret < 0 { break }
            framesEncoded += 1
            emit(out)
            av_packet_unref(out)
        }
    }

    // MARK: - Throughput measurement

    /// Decode + hardware-encode `frameBudget` frames of `inputUrl` and report
    /// the rate achieved. Used to decide whether exotic codecs can go through
    /// the transcode path (native controls) or need direct rendering.
    static func benchmark(inputUrl: String, frameBudget: Int = 600) -> VideoTranscodeBenchmark? {
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        guard avformat_open_input(&inputCtx, inputUrl, nil, nil) >= 0, let input = inputCtx else {
            NSLog("[VideoTranscoder] benchmark: cannot open input")
            return nil
        }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }
        guard avformat_find_stream_info(input, nil) >= 0 else { return nil }

        let videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard videoIn >= 0, let stream = input.pointee.streams[Int(videoIn)] else { return nil }
        guard let transcoder = VideoTranscoder(inputStream: stream) else { return nil }

        let guessed = av_guess_frame_rate(nil, stream, nil)
        let sourceFps = guessed.den > 0 ? Double(guessed.num) / Double(guessed.den) : 0

        guard let pkt = av_packet_alloc() else { return nil }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = pkt
            av_packet_free(&freeing)
        }

        let started = Date()
        while transcoder.framesEncoded < frameBudget {
            if av_read_frame(input, pkt) < 0 { break }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIn else { continue }
            transcoder.process(packet: pkt) { _ in }
        }
        transcoder.process(packet: nil) { _ in }

        return VideoTranscodeBenchmark(
            framesEncoded: transcoder.framesEncoded,
            seconds: Date().timeIntervalSince(started),
            sourceFrameRate: sourceFps,
            width: stream.pointee.codecpar.pointee.width,
            height: stream.pointee.codecpar.pointee.height
        )
    }
}
