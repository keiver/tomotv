import Foundation
import XCTest
@testable import TomoEngine

/// A live grab measured against a real origin: `TOMO_LIVE_GRAB_URL` names it (an HLS playlist or a
/// raw TS stream), `TOMO_LIVE_GRAB_UA` its User-Agent. Skipped without the URL. Prints wall time and bytes.
final class LiveFrameOriginTests: XCTestCase {
    func testGrabsAFrameOffTheOriginAndReportsItsCost() throws {
        guard let url = ProcessInfo.processInfo.environment["TOMO_LIVE_GRAB_URL"], !url.isEmpty else {
            throw XCTSkip("set TOMO_LIVE_GRAB_URL to measure a live origin")
        }
        let headers = ProcessInfo.processInfo.environment["TOMO_LIVE_GRAB_UA"].map { ["User-Agent": $0] } ?? [:]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("liveorigin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        let runs = Int(ProcessInfo.processInfo.environment["TOMO_LIVE_GRAB_RUNS"] ?? "") ?? 3
        for run in 1 ... runs {
            let done = XCTestExpectation(description: "grab \(run)")
            let started = Date()
            var outcome: LiveFrameQueue.Outcome?
            queue.request(channelId: "origin", inputUrl: url, headers: headers, deadline: 20) {
                outcome = $0
                done.fulfill()
            }
            wait(for: [done], timeout: 30)
            let elapsed = Date().timeIntervalSince(started)
            switch outcome {
            case .frames(let files, _)?:
                let size = (try? FileManager.default.attributesOfItem(atPath: files[0].path))?[.size] as? Int ?? 0
                print("[LiveFrameOrigin] run \(run): \(String(format: "%.2f", elapsed))s, \(files.count) frames, first jpeg \(size) bytes")
            case .none(let opened)?:
                XCTFail("run \(run): no frame after \(String(format: "%.2f", elapsed))s, opened=\(opened)")
            default:
                XCTFail("run \(run): cancelled")
            }
        }
    }
}
