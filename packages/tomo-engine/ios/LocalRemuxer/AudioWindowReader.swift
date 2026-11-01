import Foundation
import Libavcodec
import Libavformat
import Libavutil
import Libswresample

private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)

/// One audio track between two times as 16-bit mono PCM: sample 0 is `startSeconds`.
struct AudioWindow {
    let samples: [Int16]
    let startSeconds: Double
    let sampleRate: Int
}

/// Opens the source on its own, over the session's connection options, and decodes the audio track
/// between `from` and `to`, resampled to mono at `sampleRate`. Audio the file lacks at the start of
/// the window is silence. Nil when the source does not open, has no audio track, or yields nothing.
func readAudioWindow(inputUrl: String, headers: [String: String], audioStreamIndex: Int?, from: Double, to: Double, sampleRate: Int = 16000) -> AudioWindow? {
    guard to > from else { return nil }
    EngineLog.configure()
    var format: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
    var opts = sourceHttpOptions(headers: headers, file: true)
    let opened = avformat_open_input(&format, inputUrl, nil, &opts)
    av_dict_free(&opts)
    guard opened >= 0, let ctx = format else { return nil }
    defer { avformat_close_input(&format) }
    guard avformat_find_stream_info(ctx, nil) >= 0 else { return nil }

    var streamIndex = Int32(-1)
    if let wanted = audioStreamIndex, wanted >= 0, wanted < Int(ctx.pointee.nb_streams),
       let candidate = ctx.pointee.streams[wanted], candidate.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO {
        streamIndex = Int32(wanted)
    } else {
        streamIndex = av_find_best_stream(ctx, AVMEDIA_TYPE_AUDIO, -1, -1, nil, 0)
    }
    guard streamIndex >= 0, let stream = ctx.pointee.streams[Int(streamIndex)], let params = stream.pointee.codecpar else { return nil }
    guard let codec = avcodec_find_decoder(params.pointee.codec_id) else { return nil }
    var decoder: UnsafeMutablePointer<AVCodecContext>? = avcodec_alloc_context3(codec)
    guard let decoderContext = decoder else { return nil }
    defer { avcodec_free_context(&decoder) }
    guard avcodec_parameters_to_context(decoderContext, params) >= 0, avcodec_open2(decoderContext, codec, nil) >= 0 else { return nil }
    if decoderContext.pointee.ch_layout.nb_channels <= 0 { av_channel_layout_default(&decoderContext.pointee.ch_layout, 2) }
    if decoderContext.pointee.sample_rate <= 0 { decoderContext.pointee.sample_rate = 48000 }

    var mono = AVChannelLayout()
    av_channel_layout_default(&mono, 1)
    var resampler: OpaquePointer? = nil
    guard swr_alloc_set_opts2(
        &resampler,
        &mono, AV_SAMPLE_FMT_S16, Int32(sampleRate),
        &decoderContext.pointee.ch_layout, decoderContext.pointee.sample_fmt, decoderContext.pointee.sample_rate,
        0, nil
    ) >= 0, let swr = resampler else { return nil }
    defer { swr_free(&resampler) }
    guard swr_init(swr) >= 0 else { return nil }

    let timeBase = av_q2d(stream.pointee.time_base)
    if av_seek_frame(ctx, streamIndex, Int64(from / timeBase), AVSEEK_FLAG_BACKWARD) < 0 {
        guard avformat_seek_file(ctx, -1, Int64.min, Int64(from * Double(AV_TIME_BASE)), Int64.max, 0) >= 0 else { return nil }
    }
    avcodec_flush_buffers(decoderContext)

    var samples: [Int16] = []
    samples.reserveCapacity(Int((to - from) * Double(sampleRate)))
    var firstSeconds: Double?
    var packet = av_packet_alloc()
    defer { av_packet_free(&packet) }
    var frame = av_frame_alloc()
    defer { av_frame_free(&frame) }
    guard let packetPointer = packet, let framePointer = frame else { return nil }
    var reachedEnd = false
    while !reachedEnd, av_read_frame(ctx, packetPointer) >= 0 {
        defer { av_packet_unref(packetPointer) }
        guard packetPointer.pointee.stream_index == streamIndex, avcodec_send_packet(decoderContext, packetPointer) >= 0 else { continue }
        while avcodec_receive_frame(decoderContext, framePointer) >= 0 {
            defer { av_frame_unref(framePointer) }
            let stamp = framePointer.pointee.best_effort_timestamp
            let seconds = stamp == SWIFT_AV_NOPTS_VALUE ? nil : Double(stamp) * timeBase
            if let seconds, seconds >= to {
                reachedEnd = true
                break
            }
            if firstSeconds == nil { firstSeconds = seconds ?? from }
            appendResampled(framePointer, swr: swr, into: &samples)
        }
    }
    guard let start = firstSeconds, !samples.isEmpty else { return nil }

    let lead = Int(((start - from) * Double(sampleRate)).rounded())
    if lead < 0 {
        samples.removeFirst(min(-lead, samples.count))
    } else if lead > 0 {
        samples.insert(contentsOf: [Int16](repeating: 0, count: lead), at: 0)
    }
    let wanted = Int((to - from) * Double(sampleRate))
    if samples.count > wanted { samples.removeLast(samples.count - wanted) }
    return AudioWindow(samples: samples, startSeconds: from, sampleRate: sampleRate)
}

private func appendResampled(_ frame: UnsafeMutablePointer<AVFrame>, swr: OpaquePointer, into samples: inout [Int16]) {
    let maxOut = swr_get_out_samples(swr, frame.pointee.nb_samples)
    guard maxOut > 0 else { return }
    var out = [Int16](repeating: 0, count: Int(maxOut))
    let produced = out.withUnsafeMutableBufferPointer { buffer -> Int32 in
        var outPointer: UnsafeMutablePointer<UInt8>? = UnsafeMutableRawPointer(buffer.baseAddress!).assumingMemoryBound(to: UInt8.self)
        return withUnsafePointer(to: &frame.pointee.data.0) { inData in
            swr_convert(swr, &outPointer, maxOut, UnsafeRawPointer(inData).assumingMemoryBound(to: UnsafePointer<UInt8>?.self), frame.pointee.nb_samples)
        }
    }
    if produced > 0 { samples.append(contentsOf: out[0..<Int(produced)]) }
}
