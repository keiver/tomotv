import Foundation
import XCTest

@testable import TomoEngine

/// A real session over a real Dolby Vision source, on the host.
///
/// The engine stream-copies the HEVC base layer, so the Dolby Vision configuration record has
/// to survive into the fMP4 it serves. The mp4 muxer drops that box at the default compliance
/// level, which turns a DV source into plain HDR10 with nothing in the logs to say so.
final class DolbyVisionTests: XCTestCase {
    /// Profile 8.1, single layer, PQ. See Tests/Fixtures/README.md for provenance.
    private var fixture: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dolbyvision-p81.mkv")
    }

    /// The session's own cache directory, rebuilt the way RemuxSession.init does.
    private func sessionDirectory(_ session: RemuxSession) -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux", isDirectory: true)
            .appendingPathComponent(session.token, isDirectory: true)
    }

    /// Box types appear verbatim in the fMP4 box headers, so a byte scan is the whole test.
    private func containsBox(_ data: Data, _ type: String) -> Bool {
        guard let needle = type.data(using: .ascii) else { return false }
        return data.range(of: needle) != nil
    }

    private func waitForFile(matching predicate: (String) -> Bool, in directory: URL, seconds: Double = 15) -> URL? {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
            if let hit = names.first(where: predicate) { return directory.appendingPathComponent(hit) }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return nil
    }

    func testDolbyVisionConfigurationRecordSurvivesTheStreamCopy() throws {
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.path), "fixture missing")

        let session = try RemuxSession(
            config: makeConfig(
                durationSeconds: 10.8,
                inputUrl: fixture.path,
                videoRange: "PQ",
                codecs: "hvc1.2.4.L30.B0",
                supplementalCodecs: "dvh1.08.01/db1p",
                width: 256,
                height: 144,
                frameRate: 24
            ))
        defer { session.stop() }
        session.start()

        let directory = sessionDirectory(session)
        guard let initSegment = waitForFile(matching: { $0.hasSuffix("init.mp4") }, in: directory) else {
            return XCTFail("engine produced no init segment in \(directory.path)")
        }
        let data = try Data(contentsOf: initSegment)

        XCTAssertTrue(
            containsBox(data, "dvcC") || containsBox(data, "dvvC"),
            "init segment carries no Dolby Vision configuration record, so the player sees plain HDR10")
        // The base layer is still ordinary HEVC: DV rides beside hvc1, it does not replace it.
        XCTAssertTrue(containsBox(data, "hvc1"), "sample entry is not hvc1")
    }

    /// The plan is what a device run prints and what reaches JS. If the engine cannot say a
    /// source is Dolby Vision, nobody debugging a device can tell HDR10 from DV.
    func testEngineReportsTheDolbyVisionSourceInItsPlan() throws {
        let session = try RemuxSession(
            config: makeConfig(durationSeconds: 10.8, inputUrl: fixture.path, videoRange: "PQ", codecs: "hvc1.2.4.L30.B0", width: 256, height: 144, frameRate: 24))
        defer { session.stop() }

        let reported = XCTestExpectation(description: "engine publishes a plan")
        var plan: [String: Any] = [:]
        session.onPlan = { published in
            plan = published
            reported.fulfill()
        }
        session.start()
        wait(for: [reported], timeout: 15)

        let video = plan["video"] as? [String: Any]
        let dovi = video?["dolbyVision"] as? [String: Any]
        XCTAssertNotNil(dovi, "plan does not mention Dolby Vision for a DV source")
        XCTAssertEqual(dovi?["profile"] as? Int, 8)
        XCTAssertEqual(dovi?["blCompatibilityId"] as? Int, 1)
        XCTAssertEqual(dovi?["elPresent"] as? Bool, false)
        XCTAssertEqual(dovi?["rpuPresent"] as? Bool, true)
        // A copy is what preserves the RPU; an encode would strip it.
        XCTAssertEqual(video?["action"] as? String, "copy")
        XCTAssertEqual(EnginePlan.dolbyVisionSummary(dovi), "profile 8.1, RPU, single layer")
    }
}
