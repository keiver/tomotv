import Foundation
import XCTest

@testable import TomoEngine

/// A live grab read off the engine's own LL-HLS session over the loopback, the way the app shows a picture of the channel
/// it plays without a second read of the origin: frames and a clip come back, and the origin sees no second reader.
final class LiveFrameFromSessionTests: XCTestCase {
    func testGrabsFramesAndAClipOffAPlayingLowLatencySession() throws {
        let (feed, path) = try startContinuousFeed(fps: "25", keyframeSeconds: 1)
        defer {
            feed.terminate()
            try? FileManager.default.removeItem(atPath: path)
        }
        var config = makeConfig(durationSeconds: 0, inputUrl: path, videoRange: "", codecs: "", width: 0, height: 0, frameRate: 0, bandwidth: 0,
                                isLive: true, liveSegmentSeconds: 1)
        config.describesInput = true
        config.liveBufferSeconds = 2
        config.liveCopyCutSeconds = 0.4
        config.liveTargetNearest = true
        config.liveLowLatency = true
        config.liveLowLatencyTargetSeconds = 0
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let (server, url) = try serveOverLoopback(session)
        defer { server.stop() }
        XCTAssertTrue(spinMainRunLoop(seconds: 20) { session.servesParts && (session.progress()["bufferedSeconds"] as? Double ?? 0) >= 2 }, "the session never served")

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("session-grab-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        let done = XCTestExpectation(description: "grab")
        let started = Date()
        var outcome: LiveFrameQueue.Outcome?
        // liveFrames.ts's cold profile: LIVE_FRAME_DEADLINE_S, LIVE_FRAME_COLD_SPAN_S, LIVE_FRAME_BURST_INTERVAL_S, LIVE_FRAME_COLD_COUNT, LIVE_FRAME_CLIP_S.
        queue.request(channelId: "session", inputUrl: url.absoluteString, headers: [:], deadline: 15, span: 9, interval: 3, count: 4, clipSpan: 5,
                      frame: { _, _ in }) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 60)
        let elapsed = Date().timeIntervalSince(started)
        guard case .frames(let files, let clip, _)? = outcome else {
            return XCTFail("no frames off the session: \(String(describing: outcome))")
        }
        let clipBytes = clip.flatMap { (try? FileManager.default.attributesOfItem(atPath: $0.path))?[.size] as? Int } ?? 0
        NSLog("[LiveFrameFromSessionTests] %d frames, clip %d bytes, %.2fs", files.count, clipBytes, elapsed)
        XCTAssertGreaterThan(files.count, 0)
        XCTAssertGreaterThan(clipBytes, 0, "the grab brought no clip")
    }
}
