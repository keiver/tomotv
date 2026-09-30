import Foundation
import XCTest
@testable import TomoEngine

/// An MPEG-TS seek returns the same keyframe for the same target, so a restart whose keyframe lands
/// past the segment's start has to seek earlier or it withholds that segment forever (Apple TV,
/// The Daily Dweebs resumed at 245s: segment 40 re-seeked every 2s until the app gave up).
final class PartialOpenRestartTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0

    /// Keyframes every 5s against the 6s grid: segment 7 (42 to 48s) has no keyframe before 45s.
    private static let fixture = makeFixture(named: "gop5s-60s.ts", gopFrames: 120)
    /// The Daily Dweebs recording's shape: keyframes every 2.08s, never on the 6s grid.
    private static let unalignedFixture = makeFixture(named: "gop2s-60s.ts", gopFrames: 50)

    private static func makeFixture(named name: String, gopFrames: Int) -> URL? {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", String(seconds),
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-g", String(gopFrames), "-keyint_min", String(gopFrames), "-sc_threshold", "0", "-an", "-f", "mpegts", out.path,
        ]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        return p.terminationStatus == 0 && FileManager.default.fileExists(atPath: out.path) ? out : nil
    }

    func testARestartOnAKeyframePastTheSegmentStartStillServesTheSegment() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.fixture, "libx264 produced no fixture"))
        // Four times realtime: the forward read needs 10s to reach segment 7, so the request seeks instead.
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds / 4)))
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/gop.ts",
                                                          codecs: "avc1.64000D", width: 320, height: 180, frameRate: 24))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(7), "segment 7 is served, not withheld on every restart")
    }

    /// An MPEG-TS seek lands on a packet, and the next keyframe is past the segment's start: one seek, not two.
    func testAnMPEGTSResumeSeeksOnce() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.unalignedFixture, "libx264 produced no fixture"))
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds / 4)))
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/gop.ts",
                                                          codecs: "avc1.64000D", width: 320, height: 180, frameRate: 24))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(7))
        session.stateLock.lock()
        let restarts = session.seekRestarts
        session.stateLock.unlock()
        XCTAssertEqual(restarts, 1, "the seek starts a segment early, so the requested one opens whole")
    }

    func testTheRestartSeeksEarlierPerLateOpeningAndStopsWithholdingAtTheCap() {
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 0), 40)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 1), 39)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 9), 40 - RemuxSession.partialOpenLookback)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 1, partialOpens: 3), 0)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 0, prerolls: true), 39)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 9, prerolls: true), 40 - RemuxSession.partialOpenLookback)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 0, partialOpens: 0, prerolls: true), 0)
        XCTAssertTrue(RemuxSession.withholdsPartialOpen(partialOpens: RemuxSession.partialOpenLookback))
        XCTAssertFalse(RemuxSession.withholdsPartialOpen(partialOpens: RemuxSession.partialOpenLookback + 1),
                       "past the lookback a short head is published: a gap plays, an endless restart does not")
    }
}
