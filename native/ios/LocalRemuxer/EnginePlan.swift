//
//  EnginePlan.swift
//  TomoTV
//
//  Turns the engine's per-stream decisions into JS-bridgeable dictionaries, so
//  the app can report what the remuxer actually did instead of anyone inferring
//  it from the output.
//
//  This exists because the engine's choices used to reach NSLog and nowhere
//  else, which makes them invisible on a physical Apple TV: macOS dropped CLI
//  device log access and `devicectl` has no console for the unified log. The
//  only way to see whether a soundtrack was copied or re-encoded on real
//  hardware was to pull the output stream and probe it, which is slow, indirect
//  and twice produced a false alarm that was really a shallow ffprobe.
//
//  Source streams and encoder outputs are described by the same function on
//  purpose: a copy and an encode then read as the same shape, and a caller can
//  diff `source` against `output` field by field.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

enum EnginePlan {

    /// Describes one stream's codec parameters. Works for an input stream's
    /// `codecpar` and for a transcoder's `encoderParameters` alike.
    ///
    /// Fields the parameters do not carry are omitted rather than sent as a
    /// zero or an empty string: an absent `profile` means FFmpeg had none for
    /// this stream, which is different from a profile of "unknown".
    static func describe(_ params: UnsafePointer<AVCodecParameters>) -> [String: Any] {
        var plan: [String: Any] = [
            "codec": String(cString: avcodec_get_name(params.pointee.codec_id))
        ]
        // Carries "Dolby Digital Plus + Dolby Atmos" for a JOC stream, which is
        // the single field that says whether Atmos survived the pipeline.
        if let profile = avcodec_profile_name(params.pointee.codec_id, params.pointee.profile) {
            plan["profile"] = String(cString: profile)
        }
        if params.pointee.bit_rate > 0 {
            plan["bitRate"] = Int(params.pointee.bit_rate)
        }

        switch params.pointee.codec_type {
        case AVMEDIA_TYPE_AUDIO:
            var layout = params.pointee.ch_layout
            var name = [CChar](repeating: 0, count: 64)
            av_channel_layout_describe(&layout, &name, name.count)
            plan["channels"] = Int(layout.nb_channels)
            plan["layout"] = String(cString: name)
            plan["sampleRate"] = Int(params.pointee.sample_rate)
            if params.pointee.bits_per_raw_sample > 0 {
                plan["bitDepth"] = Int(params.pointee.bits_per_raw_sample)
            }
            // AV_SAMPLE_FMT_NONE on a stream nothing decoded; the name lookup
            // returns nil and the key stays out.
            if let fmt = av_get_sample_fmt_name(AVSampleFormat(params.pointee.format)) {
                plan["sampleFormat"] = String(cString: fmt)
            }
        case AVMEDIA_TYPE_VIDEO:
            plan["width"] = Int(params.pointee.width)
            plan["height"] = Int(params.pointee.height)
        default:
            break
        }
        return plan
    }

    /// One line per stream for the device console, matching what the JS side
    /// logs. Kept next to `describe` so the two never drift.
    static func summary(_ entry: [String: Any]) -> String {
        let action = entry["action"] as? String ?? "?"
        let source = entry["source"] as? [String: Any] ?? [:]
        var line = "\(describeShort(source)) -> \(action)"
        if let output = entry["output"] as? [String: Any] {
            line += " \(describeShort(output))"
        }
        return line
    }

    private static func describeShort(_ plan: [String: Any]) -> String {
        var parts = [plan["codec"] as? String ?? "?"]
        if let layout = plan["layout"] as? String { parts.append(layout) }
        if let depth = plan["bitDepth"] as? Int { parts.append("\(depth)-bit") }
        if let profile = plan["profile"] as? String { parts.append("(\(profile))") }
        return parts.joined(separator: " ")
    }

    /// The Dolby Vision configuration record the source carries, if any. Read from the stream
    /// rather than from Jellyfin: this is what the muxer will or will not copy through.
    static func dolbyVision(_ codecpar: UnsafeMutablePointer<AVCodecParameters>?) -> [String: Any]? {
        guard let par = codecpar else { return nil }
        for index in 0..<Int(par.pointee.nb_coded_side_data) {
            let side = par.pointee.coded_side_data[index]
            guard side.type == AV_PKT_DATA_DOVI_CONF,
                  side.size >= MemoryLayout<AVDOVIDecoderConfigurationRecord>.size,
                  let raw = side.data
            else { continue }
            let record = raw.withMemoryRebound(to: AVDOVIDecoderConfigurationRecord.self, capacity: 1) { $0.pointee }
            return [
                "profile": Int(record.dv_profile),
                "level": Int(record.dv_level),
                "blCompatibilityId": Int(record.dv_bl_signal_compatibility_id),
                "rpuPresent": record.rpu_present_flag == 1,
                "elPresent": record.el_present_flag == 1,
            ]
        }
        return nil
    }

    /// "profile 8.1, RPU, single layer" or nil. The shape the log line wants.
    static func dolbyVisionSummary(_ plan: [String: Any]?) -> String? {
        guard let plan,
              let profile = plan["profile"] as? Int,
              let compat = plan["blCompatibilityId"] as? Int
        else { return nil }
        let layers = (plan["elPresent"] as? Bool) == true ? "dual layer" : "single layer"
        let rpu = (plan["rpuPresent"] as? Bool) == true ? "RPU" : "no RPU"
        return "profile \(profile).\(compat), \(rpu), \(layers)"
    }
}
