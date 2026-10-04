import Foundation
import Libavcodec
import Libavformat
import Libavutil
import XCTest

@testable import TomoEngine

/// Tier A for audio: every codec `services/localRemux.ts` claims the engine can
/// carry, driven through the real path on the host. A track either copies
/// through untouched or is decoded and re-encoded; both are passes, and which
/// one applies is the engine's own decision, not this test's.
final class AudioCodecMatrixTests: XCTestCase {
    private static let generatable: [(codec: String, encoder: String, ext: String, args: [String])] = [
        ("aac", "aac", "m4a", []),
        ("alac", "alac", "m4a", []),
        ("ac3", "ac3", "ac3", []),
        ("eac3", "eac3", "eac3", []),
        ("mp3", "libmp3lame", "mp3", []),
        ("dts", "dca", "mka", ["-strict", "-2", "-ac", "2"]),
        ("truehd", "truehd", "mka", ["-strict", "-2", "-ac", "2"]),
        ("mlp", "mlp", "mka", ["-strict", "-2", "-ac", "2"]),
        ("opus", "opus", "mka", ["-strict", "-2"]),
        ("vorbis", "libvorbis", "ogg", []),
        ("flac", "flac", "flac", []),
        ("pcm", "pcm_s16le", "wav", []),
        ("mp2", "mp2", "mp2", []),
        ("wma", "wmav1", "asf", []),
        ("wavpack", "wavpack", "wv", []),
        ("nellymoser", "nellymoser", "flv", ["-ar", "22050", "-ac", "1"]),
        ("adpcm", "adpcm_ima_wav", "wav", []),
        ("tta", "tta", "tta", []),
    ]

    /// Claimed by the allowlist, decode-only in the FFmpeg on this machine, so a
    /// fixture can only come from a real-world sample.
    private static let corpusOnly = [
        "cook", "amr", "sipr", "ralf", "atrac", "qdm2", "qdmc", "tak", "shorten",
        "osq", "musepack", "mp4als", "speex", "gsm", "twinvq", "ape", "mp1", "dolby_e",
    ]

    /// ffprobe spellings of a codec already covered above.
    private static let aliases = ["mp4a": "aac", "ac-3": "ac3", "ec-3": "eac3", "dca": "dts"]

    /// Entry count of REMUXABLE_AUDIO_CODECS in services/localRemux.ts.
    private static let allowlistEntryCount = 40

    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func fixture(codec: String, encoder: String, ext: String, args: [String]) -> URL? {
        let out = Self.fixtureDir.appendingPathComponent("audio-\(codec).\(ext)")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments =
            ["-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=48000",
             "-c:a", encoder] + args + ["-vn", out.path]
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

    /// Open the fixture, take the engine's copy-or-transcode decision, and when
    /// it says transcode, run packets through AudioTranscoder for real.
    private func carries(_ url: URL) -> (ok: Bool, detail: String) {
        var ctx: UnsafeMutablePointer<AVFormatContext>? = nil
        guard avformat_open_input(&ctx, url.path, nil, nil) >= 0, let input = ctx else {
            return (false, "cannot open")
        }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }
        guard avformat_find_stream_info(input, nil) >= 0 else { return (false, "no stream info") }
        let idx = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, -1, nil, 0)
        guard idx >= 0, let stream = input.pointee.streams[Int(idx)] else { return (false, "no audio stream") }

        if !AudioTranscoder.needsTranscode(stream: stream) { return (true, "copy") }
        guard let transcoder = AudioTranscoder(inputStream: stream) else { return (false, "encoder would not open") }
        guard let pkt = av_packet_alloc() else { return (false, "no packet") }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = pkt
            av_packet_free(&freeing)
        }
        var emitted = 0
        while emitted < 4 {
            if av_read_frame(input, pkt) < 0 { break }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == idx else { continue }
            transcoder.process(packet: pkt) { _ in emitted += 1 }
        }
        transcoder.process(packet: nil) { _ in emitted += 1 }
        return (emitted > 0, "transcode via \(transcoder.encoderName), \(emitted) packets")
    }

    func testClaimedAudioCodecsAreCarried() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg); fixtures cannot be generated")
        }

        let accounted = Self.generatable.count + Self.corpusOnly.count + Self.aliases.count
        XCTAssertEqual(
            accounted, Self.allowlistEntryCount,
            "REMUXABLE_AUDIO_CODECS has \(Self.allowlistEntryCount) entries but the matrix accounts for \(accounted)")

        var proven: [String] = []
        var failed: [String] = []
        var ungeneratable: [String] = []

        for entry in Self.generatable {
            guard let url = fixture(codec: entry.codec, encoder: entry.encoder, ext: entry.ext, args: entry.args)
            else {
                ungeneratable.append("\(entry.codec) (encoder \(entry.encoder) produced nothing)")
                continue
            }
            let result = carries(url)
            if result.ok {
                proven.append("\(entry.codec) [\(result.detail)]")
            } else {
                failed.append("\(entry.codec) (\(result.detail))")
            }
        }

        print(
            """

            ── Tier A audio matrix ─────────────────────────────────────────
            claimed by REMUXABLE_AUDIO_CODECS : \(accounted)
            aliases of a covered codec        : \(Self.aliases.count)
            carried by the engine             : \(proven.count)
            dropped by the engine             : \(failed.count)
            fixture could not be generated    : \(ungeneratable.count)
            decode-only, needs a corpus sample: \(Self.corpusOnly.count)
            ────────────────────────────────────────────────────────────────
            """)
        for line in proven { print("   ok:            \(line)") }
        for line in failed { print("   DROPPED:       \(line)") }
        for line in ungeneratable { print("   ungeneratable: \(line)") }

        XCTAssertTrue(failed.isEmpty, "codecs the allowlist claims but the engine drops: \(failed.joined(separator: ", "))")
    }
}
