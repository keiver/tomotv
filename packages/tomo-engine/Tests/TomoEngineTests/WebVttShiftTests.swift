import XCTest

@testable import TomoEngine

/// Moving a WebVTT body's cues by the viewer's time offset.
final class WebVttShiftTests: XCTestCase {
    private let body = """
    WEBVTT
    X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000

    NOTE a note that holds --> inside text

    1
    00:00:01.000 --> 00:00:02.500 line:90% align:start
    First

    00:01.000 --> 00:03.000
    Second, minutes only

    STYLE
    ::cue { color: yellow }

    01:02:03.250 --> 01:02:04.000
    Past the hour

    """

    func testZeroLeavesTheBodyAlone() {
        XCTAssertEqual(shiftWebVtt(body, byMs: 0), body)
    }

    func testADelayMovesEveryCueAndKeepsItsSettings() {
        let shifted = shiftWebVtt(body, byMs: 1500)
        XCTAssertTrue(shifted.contains("00:00:02.500 --> 00:00:04.000 line:90% align:start\nFirst"))
        XCTAssertTrue(shifted.contains("00:00:02.500 --> 00:00:04.500\nSecond, minutes only"))
        XCTAssertTrue(shifted.contains("01:02:04.750 --> 01:02:05.500\nPast the hour"))
        XCTAssertTrue(shifted.hasPrefix("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\nNOTE a note that holds --> inside text\n"))
        XCTAssertTrue(shifted.contains("STYLE\n::cue { color: yellow }"))
        XCTAssertTrue(shifted.contains("\n1\n00:00:02.500"))
    }

    func testBringingCuesForwardClampsAtZeroAndDropsWhatEndsBeforeIt() {
        let shifted = shiftWebVtt(body, byMs: -2000)
        XCTAssertTrue(shifted.contains("00:00:00.000 --> 00:00:00.500 line:90% align:start\nFirst"))
        XCTAssertTrue(shifted.contains("00:00:00.000 --> 00:00:01.000\nSecond, minutes only"))
        let gone = shiftWebVtt(body, byMs: -3000)
        XCTAssertFalse(gone.contains("First"))
        XCTAssertFalse(gone.contains("Second, minutes only"))
        XCTAssertTrue(gone.contains("01:02:00.250 --> 01:02:01.000\nPast the hour"))
    }

    func testTimestampsRead() {
        XCTAssertEqual(webVTTSeconds("00:00:01.000"), 1)
        XCTAssertEqual(webVTTSeconds("01:02:03.250"), 3723.25)
        XCTAssertEqual(webVTTSeconds("02:03.500"), 123.5)
        XCTAssertNil(webVTTSeconds("1:2:3"))
        XCTAssertNil(webVTTSeconds("abc"))
        XCTAssertNil(webVTTSeconds("00:61:00.000"))
    }
}
