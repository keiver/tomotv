import Foundation
import XCTest

@testable import TomoEngine

/// The probe over the committed fixtures: what a source with no metadata of its own gets described as.
final class InputProbeTests: XCTestCase {
    private func fixture(_ name: String) -> String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/\(name)").path
    }

    private func streams(_ probe: [String: Any], type: String) -> [[String: Any]] {
        ((probe["streams"] as? [[String: Any]]) ?? []).filter { $0["type"] as? String == type }
    }

    func testReportsTheContainerDurationAndEveryStreamOfASubtitledMatroska() throws {
        let probe = try InputProbe.probe(url: fixture("text-subtitles.mkv"), headers: [:])
        XCTAssertEqual((probe["formatName"] as? String)?.hasPrefix("matroska"), true)
        XCTAssertEqual(probe["durationSeconds"] as? Double ?? 0, 30, accuracy: 0.5)

        let video = streams(probe, type: "video")
        XCTAssertEqual(video.count, 1)
        XCTAssertEqual(video.first?["codec"] as? String, "h264")
        XCTAssertEqual(video.first?["width"] as? Int, 128)
        XCTAssertEqual(video.first?["height"] as? Int, 96)
        XCTAssertEqual(video.first?["bitDepth"] as? Int, 8)
        XCTAssertEqual(video.first?["frameRate"] as? Double ?? 0, 4, accuracy: 0.01)

        let subtitles = streams(probe, type: "subtitle")
        XCTAssertEqual(subtitles.map { $0["language"] as? String }, ["eng", "spa", "fra"])
        XCTAssertEqual(subtitles.last?["codec"] as? String, "subrip")
        XCTAssertEqual(subtitles.map { $0["index"] as? Int }, [1, 2, 3])
    }

    func testReportsTheDepthAndTransferOfAnHdrSource() throws {
        let probe = try InputProbe.probe(url: fixture("dolbyvision-p81.mkv"), headers: [:])
        let video = try XCTUnwrap(streams(probe, type: "video").first)
        XCTAssertEqual(video["codec"] as? String, "hevc")
        XCTAssertEqual(video["bitDepth"] as? Int, 10)
        XCTAssertEqual(video["colorTransfer"] as? String, "smpte2084")
        XCTAssertEqual(video["profile"] as? String, "Main 10")
    }

    func testAnUnreadableInputThrowsTheOpenStep() {
        XCTAssertThrowsError(try InputProbe.probe(url: fixture("missing.mkv"), headers: [:])) { error in
            XCTAssertTrue(error.localizedDescription.hasPrefix("open:"), error.localizedDescription)
        }
    }
}
