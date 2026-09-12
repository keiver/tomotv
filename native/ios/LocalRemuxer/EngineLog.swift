//
//  EngineLog.swift
//  TomoTV
//
//  libav's log floor, and names for the VideoToolbox statuses the decode probes
//  collect. FFmpeg writes its warnings straight to stderr with ANSI colour
//  escapes, so a container quirk this engine has already handled ("track 1: codec
//  frame size is not set" on every eac3 copy) prints raw terminal codes into the
//  app console. ERROR keeps the lines that mean a failure.
//

import Foundation
import Libavutil
import VideoToolbox

enum EngineLog {

    /// AV_LOG_ERROR. The plain-integer log.h macros do not import into Swift
    /// (same reason FrameGrabber declares SWIFT_AVSEEK_FLAG_BACKWARD), so the
    /// number is hand-carried and EngineLogTests pins it.
    static let errorLevel: Int32 = 16

    /// What the H.264 decoder says for every packet before a stream's first IDR, which every
    /// probe of a stream joined mid-GOP (a tuner, a tuner recording) produces by the hundred.
    /// Nothing is lost: a stream that never delivers its parameter sets fails at the call site.
    private static let benignPrefixes = ["non-existing PPS", "no frame!"]

    private static let filtered: @convention(c) (UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>?, CVaListPointer) -> Void = { context, level, format, arguments in
        guard level <= errorLevel, let format else { return }
        let text = String(cString: format)
        if benignPrefixes.contains(where: { text.hasPrefix($0) }) { return }
        var line = [CChar](repeating: 0, count: 1024)
        var printPrefix: Int32 = 1
        av_log_format_line2(context, level, format, arguments, &line, Int32(line.count), &printPrefix)
        fputs(String(cString: line), stderr)
    }

    private static let applied: Void = {
        av_log_set_level(errorLevel)
        av_log_set_callback(filtered)
    }()

    /// Called at every entry point that opens a libav context; runs once.
    static func configure() { _ = applied }

    /// The VTErrors.h name for a status, so a probe result reads as an answer
    /// rather than a bare number. Only the codes the decode probes return.
    static func vtStatus(_ status: OSStatus) -> String {
        switch status {
        case noErr: return "ok"
        case kVTCouldNotFindVideoDecoderErr: return "no decoder (-12906)"
        case kVTVideoDecoderBadDataErr: return "bad data (-12909)"
        case kVTVideoDecoderUnsupportedDataFormatErr: return "unsupported format (-12910)"
        case kVTVideoDecoderMalfunctionErr: return "decoder refused (-12911)"
        case kVTCouldNotCreateInstanceErr: return "no instance (-12907)"
        case kVTVideoDecoderNotAvailableNowErr: return "decoder busy (-12913)"
        case kVTParameterErr: return "bad parameter (-12902)"
        default: return "status \(status)"
        }
    }
}
