import Foundation
import XCTest
@testable import TomoEngine

/// A live grab measured against a real input: `TOMO_LIVE_GRAB_URL` names it (an HLS playlist or a raw TS stream).
/// Optional: `TOMO_LIVE_GRAB_HEADERS` (JSON object) or `TOMO_LIVE_GRAB_UA`, `TOMO_LIVE_GRAB_PROFILE` cold|warm (the
/// app's two liveFrames.ts profiles), `TOMO_LIVE_GRAB_EXPECT` frames|fail, `TOMO_LIVE_GRAB_RUNS`. One JSON line per run.
final class LiveFrameOriginTests: XCTestCase {
    private struct Profile {
        let deadline: TimeInterval, span: TimeInterval, interval: TimeInterval, count: Int, clipSpan: TimeInterval
    }

    // liveFrames.ts: LIVE_FRAME_COLD_* for a card with no picture, LIVE_FRAME_* plus LIVE_FRAME_CLIP_S for a refresh.
    private static let profiles: [String: Profile] = [
        "cold": Profile(deadline: 6, span: 9, interval: 3, count: 4, clipSpan: 0),
        "warm": Profile(deadline: 12, span: 36, interval: 3, count: 12, clipSpan: 5),
    ]

    func testGrabsAFrameOffTheOriginAndReportsItsCost() throws {
        let env = ProcessInfo.processInfo.environment
        guard let url = env["TOMO_LIVE_GRAB_URL"], !url.isEmpty else {
            throw XCTSkip("set TOMO_LIVE_GRAB_URL to measure a live origin")
        }
        let headers = try env["TOMO_LIVE_GRAB_HEADERS"].map { try JSONDecoder().decode([String: String].self, from: Data($0.utf8)) }
            ?? env["TOMO_LIVE_GRAB_UA"].map { ["User-Agent": $0] } ?? [:]
        let profileName = env["TOMO_LIVE_GRAB_PROFILE"] ?? "cold"
        let profile = try XCTUnwrap(Self.profiles[profileName], "unknown profile \(profileName)")
        let expectFail = env["TOMO_LIVE_GRAB_EXPECT"] == "fail"
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("liveorigin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        let runs = Int(env["TOMO_LIVE_GRAB_RUNS"] ?? "") ?? 3
        for run in 1 ... runs {
            let done = XCTestExpectation(description: "grab \(run)")
            let started = Date()
            var firstFrame: TimeInterval?
            var outcome: LiveFrameQueue.Outcome?
            queue.request(channelId: "origin-\(run)", inputUrl: url, headers: headers, deadline: profile.deadline, span: profile.span,
                          interval: profile.interval, count: profile.count, clipSpan: profile.clipSpan,
                          frame: { _, _ in if firstFrame == nil { firstFrame = Date().timeIntervalSince(started) } }) {
                outcome = $0
                done.fulfill()
            }
            wait(for: [done], timeout: profile.deadline + 30)
            var line: [String: Any] = ["run": run, "profile": profileName, "elapsed": Date().timeIntervalSince(started)]
            if let firstFrame { line["firstFrame"] = firstFrame }
            switch outcome {
            case .frames(let files, let clip, _)?:
                line["outcome"] = "frames"
                line["frames"] = files.count
                line["clipBytes"] = clip.flatMap { (try? FileManager.default.attributesOfItem(atPath: $0.path))?[.size] as? Int } ?? 0
                XCTAssertFalse(expectFail, "run \(run): expected a failure, got \(files.count) frames")
            case .none(let opened, let failure)?:
                line["outcome"] = opened ? "frame" : "open"
                line["failure"] = failure ?? ""
                if !expectFail { XCTFail("run \(run): no frame, opened=\(opened), \(failure ?? "")") }
            default:
                line["outcome"] = "cancelled"
                XCTFail("run \(run): cancelled")
            }
            let json = try JSONSerialization.data(withJSONObject: line, options: [.sortedKeys])
            print("[LiveFrameLane] " + String(decoding: json, as: UTF8.self))
        }
    }
}
