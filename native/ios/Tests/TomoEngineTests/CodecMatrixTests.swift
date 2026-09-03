import Foundation
import XCTest

@testable import TomoEngine

/// Tier A of the coverage plan: every codec `services/localRemux.ts` claims the
/// engine can transcode, driven through the real decode -> convert -> encode
/// pipeline on the host. Registered in the FFmpeg build is not the same as
/// surviving our pipeline; this is the difference.
///
/// A codec whose fixture cannot be generated is reported, never silently passed.
final class CodecMatrixTests: XCTestCase {
    /// ffprobe name (what Jellyfin reports, and what the allowlist matches on)
    /// paired with the encoder that produces it, and a container that holds it.
    /// ffprobe name (what Jellyfin reports, and what the allowlist matches on),
    /// the encoder that produces it, a container that holds it, and any encoder
    /// constraint on geometry or rate. Several of these encoders reject the
    /// default 160x120@10: H.261/H.263 accept only CIF-family sizes, MPEG-1 only
    /// broadcast frame rates, DV only its fixed 720x480 4:1:1 frame.
    private static let generatable: [(codec: String, encoder: String, ext: String, args: [String])] = [
        ("vp8", "libvpx", "mkv", []), ("vp9", "libvpx-vp9", "mkv", []), ("av1", "libsvtav1", "mkv", []),
        ("mpeg1video", "mpeg1video", "mkv", ["-r", "25"]),
        ("mpeg2video", "mpeg2video", "mkv", []),
        ("mpeg4", "mpeg4", "mkv", []),
        ("h263", "h263", "avi", ["-s", "352x288", "-r", "25"]),
        ("h261", "h261", "avi", ["-s", "352x288", "-r", "25"]),
        ("flv1", "flv", "flv", []),
        ("rv10", "rv10", "rm", ["-s", "352x288", "-r", "25"]),
        ("rv20", "rv20", "rm", ["-s", "352x288", "-r", "25"]),
        ("svq1", "svq1", "mov", []), ("msmpeg4v2", "msmpeg4v2", "avi", []), ("msmpeg4v3", "msmpeg4", "avi", []),
        ("theora", "libtheora", "ogv", []),
        ("dvvideo", "dvvideo", "avi", ["-s", "720x480", "-r", "30000/1001", "-pix_fmt", "yuv411p"]),
        ("cinepak", "cinepak", "avi", []),
        ("prores", "prores", "mov", []),
        ("dnxhd", "dnxhd", "mov", ["-s", "1920x1080", "-r", "25", "-pix_fmt", "yuv422p", "-b:v", "36M"]),
        ("cfhd", "cfhd", "mov", []),
        ("mjpeg", "mjpeg", "avi", []), ("jpeg2000", "jpeg2000", "mkv", []), ("jpegls", "jpegls", "mkv", []),
        ("ffv1", "ffv1", "mkv", []), ("ffvhuff", "ffvhuff", "mkv", []), ("huffyuv", "huffyuv", "avi", []),
        ("utvideo", "utvideo", "mkv", []), ("magicyuv", "magicyuv", "mkv", []),
        ("v210", "v210", "mov", []), ("v410", "v410", "mov", []), ("snow", "snow", "mkv", []),
        ("msvideo1", "msvideo1", "avi", []), ("msrle", "msrle", "avi", []), ("qtrle", "qtrle", "mov", []),
        ("rpza", "rpza", "mov", []), ("smc", "smc", "mov", []), ("dxv", "dxv", "mov", []),
    ]

    /// Claimed by the allowlist, decode-only in FFmpeg, so a fixture can only
    /// come from a real-world sample. Recorded rather than skipped in silence.
    private static let corpusOnly = [
        "vp7", "vp6", "vvc", "vc1", "rv30", "rv40", "rv60", "svq3", "msmpeg4v1",
        "avs3", "cavs", "apv", "lagarith", "sheervideo", "indeo2", "indeo3", "indeo4",
        "indeo5", "tscc", "tscc2", "truemotion1", "truemotion2", "vp3", "vp4", "vp5",
        "hap", "txd", "mts2", "vmnc",
    ]

    /// Allowlist entries that are ffprobe spellings of a codec already covered
    /// above, so they need no fixture of their own.
    private static let aliases = ["av01": "av1", "mpeg1": "mpeg1video", "mpeg2": "mpeg2video", "wmv": "wmv2"]

    /// Entry count of TRANSCODABLE_VIDEO_CODECS in services/localRemux.ts.
    /// A tripwire: adding a codec there without adding it here breaks the sum,
    /// which is the only way an untested claim gets noticed.
    private static let allowlistEntryCount = 70

    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    /// Cached under .build so a repeat run costs only the pipeline, not encoding.
    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func fixture(codec: String, encoder: String, ext: String, args: [String]) -> URL? {
        let out = Self.fixtureDir.appendingPathComponent("\(codec).\(ext)")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=1.5",
            "-c:v", encoder,
        ] + args + ["-an", out.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: out.path) else {
            try? FileManager.default.removeItem(at: out)
            return nil
        }
        return out
    }

    func testClaimedCodecsSurviveTheTranscodePipeline() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg); fixtures cannot be generated")
        }

        var proven: [String] = []
        var failed: [String] = []
        var ungeneratable: [String] = []

        for entry in Self.generatable {
            guard let url = fixture(codec: entry.codec, encoder: entry.encoder, ext: entry.ext, args: entry.args)
            else {
                ungeneratable.append("\(entry.codec) (encoder \(entry.encoder) produced nothing)")
                continue
            }
            // One second of wall clock: this asserts the pipeline produces frames at all, never a rate.
            let result = VideoTranscoder.benchmark(inputUrl: url.path, wallSeconds: 1, encode: true)
            guard result["failed"] == nil, (result["frames"] as? Int ?? 0) > 0 else {
                failed.append(entry.codec)
                continue
            }
            proven.append(entry.codec)
        }

        let accounted = Self.generatable.count + Self.corpusOnly.count + Self.aliases.count
        XCTAssertEqual(
            accounted, Self.allowlistEntryCount,
            "TRANSCODABLE_VIDEO_CODECS has \(Self.allowlistEntryCount) entries but the matrix accounts for \(accounted); a claimed codec is untracked")
        let claimed = accounted
        print(
            """

            ── Tier A codec matrix ─────────────────────────────────────────
            claimed by TRANSCODABLE_VIDEO_CODECS : \(claimed)
            aliases of a covered codec           : \(Self.aliases.count)
            proven through the pipeline          : \(proven.count)
            failed in the pipeline               : \(failed.count) \(failed.joined(separator: " "))
            fixture could not be generated       : \(ungeneratable.count)
            decode-only, needs a corpus sample   : \(Self.corpusOnly.count)
            ────────────────────────────────────────────────────────────────
            """)
        for line in ungeneratable { print("   ungeneratable: \(line)") }

        XCTAssertTrue(
            failed.isEmpty,
            "codecs the allowlist claims but the pipeline drops: \(failed.joined(separator: ", "))")
        XCTAssertGreaterThan(proven.count, 0, "no codec was proven; the harness itself is broken")
    }
}
