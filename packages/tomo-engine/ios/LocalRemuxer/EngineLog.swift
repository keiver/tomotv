//
//  EngineLog.swift
//  TomoTV
//
//  libav's log floor and writer, and names for the VideoToolbox statuses the
//  decode probes collect. libav's own writer colours stderr with ANSI escapes and,
//  on the Xcode console's tty, prints its repeat counter as a new line per repeat.
//

import Foundation
import Libavutil
import VideoToolbox

enum EngineLog {

    /// AV_LOG_ERROR. The plain-integer log.h macros do not import into Swift
    /// (same reason FrameGrabber declares SWIFT_AVSEEK_FLAG_BACKWARD), so the
    /// number is hand-carried and EngineLogTests pins it.
    static let errorLevel: Int32 = 16

    private static let applied: Void = {
        av_log_set_level(errorLevel)
        av_log_set_callback { ctx, level, fmt, args in forward(ctx, level, fmt, args) }
    }()

    /// Called at every entry point that opens a libav context; runs once.
    static func configure() { _ = applied }

    private static let lock = NSLock()
    private static var pending = ""
    private static var repeats = RepeatFilter()

    private static func forward(_ ctx: UnsafeMutableRawPointer?, _ level: Int32, _ fmt: UnsafePointer<CChar>?, _ args: CVaListPointer?) {
        guard level >= 0, level & 0xff <= av_log_get_level(), let fmt, let args else { return }
        var buffer = [CChar](repeating: 0, count: 1024)
        var printPrefix: Int32 = 1
        av_log_format_line2(nil, level, fmt, args, &buffer, Int32(buffer.count), &printPrefix)
        let text = String(cString: buffer)
        lock.lock()
        defer { lock.unlock() }
        // A line can arrive in parts; it is complete at its newline.
        pending += text
        guard pending.hasSuffix("\n") else { return }
        let line = "[\(itemName(ctx))] " + pending.trimmingCharacters(in: .whitespacesAndNewlines)
        pending = ""
        for out in repeats.admit(line) { NSLog("%@", out) }
    }

    /// The context's name without its address, so the same line from two decoders reads as a repeat.
    private static func itemName(_ ctx: UnsafeMutableRawPointer?) -> String {
        guard let ctx, let cls = ctx.assumingMemoryBound(to: UnsafePointer<AVClass>?.self).pointee else { return "libav" }
        if let name = cls.pointee.item_name?(ctx) { return String(cString: name) }
        return cls.pointee.class_name.map { String(cString: $0) } ?? "libav"
    }

    /// Prints a run of one line once, then its count when a different line arrives.
    struct RepeatFilter {
        private var last = ""
        private var count = 0

        mutating func admit(_ line: String) -> [String] {
            // mbedtls_ssl_read returns 0 at a clean close, which libav's TLS layer reports as an error.
            if line.hasSuffix("mbedtls_ssl_read returned -0x0") { return [] }
            if line == last { count += 1; return [] }
            var out = count > 0 ? ["\(last) (repeated \(count) more times)"] : []
            out.append(line)
            last = line
            count = 0
            return out
        }
    }

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
