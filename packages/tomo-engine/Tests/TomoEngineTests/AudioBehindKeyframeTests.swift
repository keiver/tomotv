import Foundation
import XCTest
@testable import TomoEngine

/// A seek's keyframe arrives without a DTS and is written at its PTS; audio interleaved behind it
/// falls before the muxer's zero. Cut after one such sample, movenc aborted the app (Apple TV, 2.2.10).
final class AudioBehindKeyframeTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0

    /// B-frames, one keyframe 83ms before segment 7 (42s), 24 kHz AAC (copied): one audio frame sits
    /// between the keyframe and the first video packet past 42s.
    private static let fixture: URL? = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("bframes-key41.917-aac24k-60s.mkv")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000", "-t", String(seconds),
            "-c:v", "libx264", "-preset", "ultrafast", "-bf", "2", "-g", "2000", "-force_key_frames", "0,41.9167",
            "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", "-b:a", "32k", out.path,
        ]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        return p.terminationStatus == 0 && FileManager.default.fileExists(atPath: out.path) ? out : nil
    }()

    func testASeekOntoAKeyframeWithAudioBehindItServesTheSegment() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.fixture, "libx264 produced no fixture"))
        // Four times realtime: the forward read needs 10s to reach segment 7, so the request seeks instead.
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds / 4)))
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/key.mkv",
                                                          codecs: "avc1.64000D,mp4a.40.2", width: 320, height: 180, frameRate: 24))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(7), "segment 7 is served after the seek, not an abort in the muxer")
        session.stateLock.lock()
        let restarts = session.seekRestarts
        session.stateLock.unlock()
        XCTAssertGreaterThanOrEqual(restarts, 1, "the request reached segment 7 through a seek")
    }
}
