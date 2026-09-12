import XCTest

@testable import TomoEngine

/// Live mode: an unbounded grid and a sliding-window playlist. The tags here are the
/// ones Apple's authoring spec makes mandatory for live (8.4, 8.13, 8.17) and the
/// ones a VOD playlist must never carry into it (ENDLIST, PLAYLIST-TYPE).
final class LivePlaylistTests: XCTestCase {
    private func render(
        prefix: String = "",
        target: Int = 7,
        firstRetained: Int = 0,
        segments: [Int],
        durations: [Int: Double] = [:],
        generationStarts: [Int: Int] = [0: 0],
        dates: [Int: Date] = [:]
    ) -> String {
        RemuxSession.renderLivePlaylist(
            prefix: prefix, target: target, firstRetained: firstRetained, segments: segments,
            durations: durations, generationStarts: generationStarts, dates: dates, fallbackDuration: 6.0)
    }

    func testLiveGridIsUnboundedAndFixedPitch() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 0, isLive: true, liveSegmentSeconds: 6))
        defer { s.stop() }
        XCTAssertEqual(s.segmentCount, Int.max)
        XCTAssertEqual(s.segmentStartSeconds(0), 0, accuracy: 0.0001)
        XCTAssertEqual(s.segmentStartSeconds(7), 42, accuracy: 0.0001)
        XCTAssertEqual(s.segmentIndex(atSeconds: 41.9), 6)
        XCTAssertEqual(s.segmentIndex(atSeconds: -3), 0)
        // Unmeasured segments report the target; a live session never declares a remainder.
        XCTAssertEqual(s.segmentDurationSeconds(3), 6, accuracy: 0.0001)
    }

    func testVodGridIsUntouchedByTheLiveFields() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 32))
        defer { s.stop() }
        XCTAssertEqual(s.segmentCount, 5)
        XCTAssertEqual(s.segmentDurationSeconds(4), 8, accuracy: 0.0001)
    }

    func testLivePlaylistCarriesNoVodTags() {
        let out = render(segments: [0, 1, 2])
        XCTAssertFalse(out.contains("#EXT-X-ENDLIST"))
        XCTAssertFalse(out.contains("#EXT-X-PLAYLIST-TYPE"))
        XCTAssertFalse(out.contains("#EXT-X-START"))
        XCTAssertTrue(out.contains("#EXT-X-TARGETDURATION:7\n"))
        XCTAssertTrue(out.contains("#EXT-X-MAP:URI=\"init.mp4\"\n"))
    }

    func testWindowSetsMediaSequenceAndListsOnlyRetainedSegments() {
        let out = render(firstRetained: 40, segments: [40, 41, 42])
        XCTAssertTrue(out.contains("#EXT-X-MEDIA-SEQUENCE:40\n"))
        XCTAssertTrue(out.contains("seg40.m4s\n"))
        XCTAssertFalse(out.contains("seg39.m4s"))
        XCTAssertEqual(out.components(separatedBy: "#EXTINF").count - 1, 3)
    }

    func testExtinfIsTheMeasuredLength() {
        let out = render(segments: [0, 1], durations: [0: 6.4, 1: 7.25])
        XCTAssertTrue(out.contains("#EXTINF:6.400000,\nseg0.m4s\n"))
        XCTAssertTrue(out.contains("#EXTINF:7.250000,\nseg1.m4s\n"))
    }

    func testSpliceEmitsDiscontinuityAndANewMap() {
        let out = render(segments: [0, 1, 2, 3], generationStarts: [0: 0, 2: 1])
        let lines = out.split(separator: "\n").map(String.init)
        let disc = lines.firstIndex(of: "#EXT-X-DISCONTINUITY")
        XCTAssertNotNil(disc)
        XCTAssertEqual(lines[disc! + 1], "#EXT-X-MAP:URI=\"init-g1.mp4\"")
        // Exactly one splice, placed before seg2 and after seg1.
        XCTAssertEqual(out.components(separatedBy: "#EXT-X-DISCONTINUITY\n").count - 1, 1)
        XCTAssertLessThan(lines.firstIndex(of: "seg1.m4s")!, disc!)
        XCTAssertGreaterThan(lines.firstIndex(of: "seg2.m4s")!, disc!)
        XCTAssertTrue(out.contains("#EXT-X-DISCONTINUITY-SEQUENCE:0\n"))
    }

    func testDiscontinuitySequenceCountsSplicesThatLeftTheWindow() {
        // Splices at 2 and 10; the window opens at 10, so the one at 2 is gone and the
        // one at 10 opens the listing without a DISCONTINUITY line of its own.
        let out = render(firstRetained: 10, segments: [10, 11], generationStarts: [0: 0, 2: 1, 10: 2])
        XCTAssertTrue(out.contains("#EXT-X-DISCONTINUITY-SEQUENCE:2\n"))
        XCTAssertFalse(out.contains("#EXT-X-DISCONTINUITY\n"))
        XCTAssertTrue(out.contains("#EXT-X-MAP:URI=\"init-g2.mp4\"\n"))
    }

    func testProgramDateTimeIsEmittedWithEveryMap() {
        let t0 = Date(timeIntervalSince1970: 1_757_600_000)
        let out = render(segments: [0, 1, 2], generationStarts: [0: 0, 2: 1], dates: [0: t0, 2: t0.addingTimeInterval(12.5)])
        XCTAssertEqual(out.components(separatedBy: "#EXT-X-PROGRAM-DATE-TIME:").count - 1, 2)
        XCTAssertTrue(out.contains("#EXT-X-PROGRAM-DATE-TIME:2025-09-11T14:13:20.000Z\n"))
    }

    func testAlternateAudioRenditionNamesItsOwnFiles() {
        let out = render(prefix: "a1", segments: [5], generationStarts: [0: 0, 5: 3])
        XCTAssertTrue(out.contains("#EXT-X-MAP:URI=\"a1-init-g3.mp4\"\n"))
        XCTAssertTrue(out.contains("a1-seg5.m4s\n"))
    }

    func testInitNamesRoundTripThroughTheRoutes() {
        XCTAssertEqual(RemuxSession.liveInitName(prefix: "", generation: 0), "init.mp4")
        XCTAssertEqual(RemuxSession.liveInitName(prefix: "", generation: 4), "init-g4.mp4")
        XCTAssertEqual(RemuxSession.liveInitName(prefix: "a2", generation: 0), "a2-init.mp4")
        XCTAssertEqual(RemuxSession.liveInitName(prefix: "a2", generation: 1), "a2-init-g1.mp4")
    }
}
