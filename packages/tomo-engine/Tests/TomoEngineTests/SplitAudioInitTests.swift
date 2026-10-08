import Foundation
import XCTest

@testable import TomoEngine

/// Proves what breaks the on-device copy on a fast link: a single AC3 track is
/// muxed into the primary and its init materializes, but the SAME AC3 track put
/// into its own audio-only rendition (what `splitAudio` does, whether triggered
/// by a second track or by `tierActive`) must also produce a valid init or
/// AVPlayer loops on "aN-init.mp4" forever and never fetches a segment.
///
/// Runs the real RemuxSession pipeline on the host against generated fixtures.
final class SplitAudioInitTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/split-audio-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// Video + one or two audio tracks. `audioEncoders` in map order become
    /// stream indices 1, 2, ...; the video is stream 0.
    /// `subtitleTexts` follow the audio as SubRip tracks, one cue each naming itself.
    private func fixture(name: String, audioEncoders: [String], subtitleTexts: [String] = []) -> URL? {
        let out = Self.fixtureDir.appendingPathComponent("\(name).mkv")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        var args = ["-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=3"]
        for (i, _) in audioEncoders.enumerated() {
            args += ["-f", "lavfi", "-i", "sine=frequency=\(440 + i * 220):duration=3:sample_rate=48000"]
        }
        for (i, text) in subtitleTexts.enumerated() {
            let srt = Self.fixtureDir.appendingPathComponent("\(name)-\(i).srt")
            try? "1\n00:00:00,500 --> 00:00:02,500\n\(text)\n".write(to: srt, atomically: true, encoding: .utf8)
            args += ["-i", srt.path]
        }
        args += ["-map", "0:v"]
        for i in audioEncoders.indices { args += ["-map", "\(i + 1):a"] }
        for i in subtitleTexts.indices { args += ["-map", "\(audioEncoders.count + i + 1):s"] }
        args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25"]
        for (i, enc) in audioEncoders.enumerated() {
            args += ["-c:a:\(i)", enc]
            if enc == "ac3" { args += ["-ac:a:\(i)", "6"] }
        }
        if !subtitleTexts.isEmpty { args += ["-c:s", "subrip"] }
        args += [out.path]

        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = args
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

    private func track(_ index: Int, _ name: String) -> RemuxAudioTrack {
        RemuxAudioTrack(index: index, name: name, language: "eng", serverAudioUrl: "")
    }

    /// A file that AVFoundation would accept as an fMP4 init segment: non-empty
    /// with both an ftyp and a moov box.
    private func isValidInit(_ url: URL) -> (ok: Bool, detail: String) {
        guard let data = try? Data(contentsOf: url) else { return (false, "missing") }
        guard !data.isEmpty else { return (false, "empty (0 bytes)") }
        let bytes = [UInt8](data)
        func hasBox(_ tag: String) -> Bool {
            let t = Array(tag.utf8)
            guard bytes.count >= 8, t.count == 4 else { return false }
            for i in 0...(bytes.count - 4) where Array(bytes[i..<i + 4]) == t { return true }
            return false
        }
        let ftyp = hasBox("ftyp"), moov = hasBox("moov")
        return (ftyp && moov, "\(data.count) bytes ftyp=\(ftyp) moov=\(moov)")
    }

    /// Run the pipeline to completion (or a deadline) and return the session so
    /// its `dir` can be inspected. The producer runs a 3s file to EOF with no
    /// request, which writes every rendition's init and segment 0.
    private func run(_ config: RemuxConfig, expecting prefixes: [String]) throws -> RemuxSession {
        let session = try RemuxSession(config: config)
        session.start()
        let deadline = Date().addingTimeInterval(40)
        // Drive it exactly as AVPlayer does: ask for each rendition's segment 0.
        // segmentURL blocks (bounded) and drives production; a nil return is a
        // segment the pipeline could not deliver.
        while Date() < deadline {
            let allInits = prefixes.allSatisfy {
                let name = $0.isEmpty ? "init.mp4" : "\($0)-init.mp4"
                return FileManager.default.fileExists(atPath: session.dir.appendingPathComponent(name).path)
            }
            if allInits || session.hasFailed { break }
            usleep(200_000)
        }
        return session
    }

    private func cleanup(_ session: RemuxSession) {
        try? FileManager.default.removeItem(at: session.dir)
    }

    // Control: a single AC3 track, no second track and no tier, is muxed into
    // the primary. This is the path that played before splitAudio was forced on.
    func testSingleAc3IsMuxedAndPrimaryInitIsValid() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg)")
        }
        guard let url = fixture(name: "v-ac3", audioEncoders: ["ac3"]) else {
            throw XCTSkip("could not generate the AC3 fixture")
        }
        let config = makeConfig(
            durationSeconds: 3.0, inputUrl: url.path,
            audioTracks: [track(1, "AC3 5.1")],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        let session = try run(config, expecting: [""])
        defer { cleanup(session) }

        let primary = isValidInit(session.dir.appendingPathComponent("init.mp4"))
        XCTAssertTrue(primary.ok, "muxed single-AC3 primary init should be valid: \(primary.detail)")
    }

    func testServerBackedDefaultAudioPreservesTheLocalAlternatePosition() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "server-default-local-alternate", audioEncoders: ["aac", "aac"]) else {
            throw XCTSkip("could not generate the two-audio fixture")
        }
        var serverTrack = RemuxAudioTrack(index: 1, name: "Server audio", language: "eng", serverAudioUrl: "https://audio.invalid/default.m3u8")
        serverTrack.usesServerAudio = true
        serverTrack.codecs = "mp4a.40.2"
        serverTrack.bandwidth = 96_000
        let config = makeConfig(
            durationSeconds: 3, inputUrl: source.path,
            audioTracks: [serverTrack, track(2, "Local alternate")],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        let session = try run(config, expecting: ["", "a1"])
        defer { session.stop() }

        XCTAssertFalse(session.hasFailed)
        XCTAssertNil(session.rendition(withPrefix: "a0"))
        XCTAssertEqual(session.rendition(withPrefix: "a1")?.inputStreams, [2])
        XCTAssertTrue(isValidInit(session.dir.appendingPathComponent("a1-init.mp4")).ok)
        XCTAssertTrue(session.masterPlaylist().contains("URI=\"a0s.m3u8\""))
        XCTAssertTrue(session.masterPlaylist().contains("URI=\"a1.m3u8\""))
        XCTAssertTrue(session.hasServerAudio(0))
        XCTAssertFalse(session.tierActive)
    }

    func testSingleServerBackedAudioLeavesThePrimaryVideoOnly() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "server-only-audio", audioEncoders: ["aac"]) else {
            throw XCTSkip("could not generate the audio fixture")
        }
        var serverTrack = RemuxAudioTrack(index: 1, name: "Server audio", language: "eng", serverAudioUrl: "https://audio.invalid/default.m3u8")
        serverTrack.usesServerAudio = true
        let config = makeConfig(
            durationSeconds: 3, inputUrl: source.path,
            audioTracks: [serverTrack],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        let session = try run(config, expecting: [""])
        defer { session.stop() }

        XCTAssertEqual(session.rendition(withPrefix: "")?.inputStreams, [0])
        XCTAssertNil(session.rendition(withPrefix: "a0"))
        XCTAssertTrue(session.audioLoActive)
        XCTAssertFalse(session.tierActive)
        XCTAssertTrue(session.masterPlaylist().contains("URI=\"a0s.m3u8\""))
    }

    /// A track as services/localRemux.ts sends it: Jellyfin's Index, and where the stream sits in the file.
    private func sourcedTrack(_ index: Int, _ name: String, ordinal: Int, count: Int, codec: String) -> RemuxAudioTrack {
        var sourced = track(index, name)
        sourced.source = SourcePosition(ordinal: ordinal, count: count, codec: codec)
        return sourced
    }

    private func sourcedText(_ index: Int, ordinal: Int, count: Int) -> RemuxSubtitle {
        var sourced = RemuxSubtitle(index: index, name: "Track \(index)", language: "eng", vttUrl: "", localVtt: "",
                                    isDefault: false, isForced: false, isImage: false, isEngineText: true)
        sourced.source = SourcePosition(ordinal: ordinal, count: count, codec: "subrip")
        return sourced
    }

    /// video 0, ac3 1, aac 2, srt 3 ("ONE"), srt 4 ("TWO"). `shift` is how many sidecars Jellyfin lists first.
    private func assertTracksReadTheirOwnStreams(shift: Int) throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "two-audio-two-text", audioEncoders: ["ac3", "aac"], subtitleTexts: ["ONE", "TWO"]) else {
            throw XCTSkip("could not generate the two-audio two-text fixture")
        }
        let config = makeConfig(
            durationSeconds: 3, inputUrl: source.path,
            audioTracks: [sourcedTrack(1 + shift, "AC3", ordinal: 0, count: 2, codec: "ac3"),
                          sourcedTrack(2 + shift, "AAC", ordinal: 1, count: 2, codec: "aac")],
            subtitles: [sourcedText(3 + shift, ordinal: 0, count: 2), sourcedText(4 + shift, ordinal: 1, count: 2)],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        let session = try run(config, expecting: ["", "a0", "a1"])
        defer { session.stop() }

        XCTAssertFalse(session.hasFailed)
        XCTAssertEqual(session.rendition(withPrefix: "a0")?.inputStreams, [1])
        XCTAssertEqual(session.rendition(withPrefix: "a1")?.inputStreams, [2])
        XCTAssertTrue(session.subtitleSegment(streamIndex: 3 + shift, segment: 0)?.contains("ONE") ?? false)
        XCTAssertTrue(session.subtitleSegment(streamIndex: 4 + shift, segment: 0)?.contains("TWO") ?? false)
    }

    /// Jellyfin 12 lists a sidecar first and renumbers, so every Index is one past the file's.
    func testJellyfin12IndexesReadTheirOwnStreams() throws {
        try assertTracksReadTheirOwnStreams(shift: 1)
    }

    func testPreTwelveIndexesReadTheirOwnStreams() throws {
        try assertTracksReadTheirOwnStreams(shift: 0)
    }

    /// A probe that disagrees with the file is refused: the engine never reads a neighbour in its place.
    private func assertRefused(_ tracks: [RemuxAudioTrack]) throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "two-audio-two-text", audioEncoders: ["ac3", "aac"], subtitleTexts: ["ONE", "TWO"]) else {
            throw XCTSkip("could not generate the two-audio two-text fixture")
        }
        let config = makeConfig(
            durationSeconds: 3, inputUrl: source.path, audioTracks: tracks,
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        let session = try run(config, expecting: ["", "a0", "a1"])
        defer { session.stop() }

        XCTAssertTrue(session.hasFailed)
        XCTAssertNil(session.rendition(withPrefix: "a0"))
    }

    func testASourceCodecTheFileDoesNotHoldIsRefused() throws {
        try assertRefused([sourcedTrack(2, "AC3", ordinal: 0, count: 2, codec: "dts"), sourcedTrack(3, "AAC", ordinal: 1, count: 2, codec: "aac")])
    }

    func testASourceCountTheFileDoesNotHoldIsRefused() throws {
        try assertRefused([sourcedTrack(2, "AC3", ordinal: 0, count: 3, codec: "ac3"), sourcedTrack(3, "AAC", ordinal: 1, count: 3, codec: "aac")])
    }

    func testSplitAc3AudioOnlyRenditionInitIsValid() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg)")
        }
        guard let url = fixture(name: "v-ac3-aac", audioEncoders: ["ac3", "aac"]) else {
            throw XCTSkip("could not generate the AC3+AAC fixture")
        }
        let config = makeConfig(
            durationSeconds: 3.0, inputUrl: url.path,
            audioTracks: [track(1, "AC3 5.1"), track(2, "AAC")],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        let session = try run(config, expecting: ["", "a0", "a1"])
        defer { cleanup(session) }

        let video = isValidInit(session.dir.appendingPathComponent("init.mp4"))
        let ac3 = isValidInit(session.dir.appendingPathComponent("a0-init.mp4"))
        let aac = isValidInit(session.dir.appendingPathComponent("a1-init.mp4"))
        print("── split-audio init proof ─────────────")
        print("   video primary init : \(video.detail)")
        print("   a0 AC3 audio init  : \(ac3.detail)")
        print("   a1 AAC audio init  : \(aac.detail)")

        XCTAssertTrue(video.ok, "video-only primary init should be valid: \(video.detail)")
        XCTAssertTrue(aac.ok, "AAC audio-only init should be valid: \(aac.detail)")
        XCTAssertTrue(ac3.ok, "AC3 audio-only (split) init should be valid: \(ac3.detail)")
    }
}
