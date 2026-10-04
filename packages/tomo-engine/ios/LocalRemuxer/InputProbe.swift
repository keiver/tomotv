//
//  InputProbe.swift
//
//  Opens an input the way a session would and reports what the demuxer found: the container,
//  its duration and every stream's codec and shape. For sources with no metadata of their own.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

enum InputProbe {
    struct ProbeError: LocalizedError {
        let step: String
        let code: Int32
        var errorDescription: String? {
            var buffer = [CChar](repeating: 0, count: 256)
            av_strerror(code, &buffer, buffer.count)
            return "\(step): \(String(cString: buffer))"
        }
    }

    /// The same open terms as a session (reconnects, a bounded wait per I/O call, the origin's headers).
    static func probe(url: String, headers: [String: String]) throws -> [String: Any] {
        EngineLog.configure()
        var ctx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard ctx != nil else { throw ProbeError(step: "alloc", code: -12) }
        var opts: OpaquePointer? = nil
        av_dict_set(&opts, "reconnect", "1", 0)
        av_dict_set(&opts, "reconnect_streamed", "1", 0)
        av_dict_set(&opts, "reconnect_delay_max", "5", 0)
        av_dict_set(&opts, "rw_timeout", "15000000", 0)
        av_dict_set(&opts, "tls_verify", "0", 0)
        for (name, value) in headers {
            if name.caseInsensitiveCompare("User-Agent") == .orderedSame {
                av_dict_set(&opts, "user_agent", value, 0)
            } else {
                av_dict_set(&opts, "headers", "\(name): \(value)\r\n", AV_DICT_APPEND)
            }
        }
        let opened = avformat_open_input(&ctx, url, nil, &opts)
        av_dict_free(&opts)
        guard opened >= 0, let input = ctx else { throw ProbeError(step: "open", code: opened) }
        defer { avformat_close_input(&ctx) }
        let probed = probeStreamInfo(input)
        guard probed >= 0 else { throw ProbeError(step: "find_stream_info", code: probed) }

        let duration = input.pointee.duration
        let streams = (0 ..< Int(input.pointee.nb_streams)).compactMap { index -> [String: Any]? in
            guard let stream = input.pointee.streams[index], let params = stream.pointee.codecpar else { return nil }
            return describe(stream: stream.pointee, params: params.pointee, index: index)
        }
        return [
            "formatName": input.pointee.iformat.map { String(cString: $0.pointee.name) } ?? "",
            "durationSeconds": duration > 0 && duration != Int64(bitPattern: UInt64(0x8000_0000_0000_0000)) ? Double(duration) / Double(AV_TIME_BASE) : 0,
            "streams": streams,
        ]
    }

    private static func describe(stream: AVStream, params: AVCodecParameters, index: Int) -> [String: Any] {
        var info: [String: Any] = [
            "index": index,
            "type": av_get_media_type_string(params.codec_type).map { String(cString: $0) } ?? "unknown",
            "codec": String(cString: avcodec_get_name(params.codec_id)),
            "isDefault": stream.disposition & AV_DISPOSITION_DEFAULT != 0,
            "isForced": stream.disposition & AV_DISPOSITION_FORCED != 0,
        ]
        if let profile = avcodec_profile_name(params.codec_id, params.profile) { info["profile"] = String(cString: profile) }
        if params.bit_rate > 0 { info["bitRate"] = Int(params.bit_rate) }
        if let language = av_dict_get(stream.metadata, "language", nil, 0) { info["language"] = String(cString: language.pointee.value) }
        if let title = av_dict_get(stream.metadata, "title", nil, 0) { info["title"] = String(cString: title.pointee.value) }
        switch params.codec_type {
        case AVMEDIA_TYPE_VIDEO:
            if params.width > 0 { info["width"] = Int(params.width) }
            if params.height > 0 { info["height"] = Int(params.height) }
            let rate = stream.avg_frame_rate
            if rate.num > 0, rate.den > 0 { info["frameRate"] = Double(rate.num) / Double(rate.den) }
            // The pixel format's depth, with the stream's declared depth standing in for an opaque format.
            let descriptorDepth = av_pix_fmt_desc_get(AVPixelFormat(rawValue: params.format))?.pointee.comp.0.depth ?? 0
            let depth = descriptorDepth > 0 ? Int(descriptorDepth) : Int(params.bits_per_raw_sample)
            if depth > 0 { info["bitDepth"] = depth }
            if let transfer = av_color_transfer_name(params.color_trc) { info["colorTransfer"] = String(cString: transfer) }
        case AVMEDIA_TYPE_AUDIO:
            if params.ch_layout.nb_channels > 0 { info["channels"] = Int(params.ch_layout.nb_channels) }
            if params.sample_rate > 0 { info["sampleRate"] = Int(params.sample_rate) }
            if params.bits_per_raw_sample > 0 { info["bitDepth"] = Int(params.bits_per_raw_sample) }
        default:
            break
        }
        return info
    }
}
