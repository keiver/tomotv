import XCTest

@testable import TomoLyrics

final class LyricsTimelineTests: XCTestCase {
    private func lyrics(synced: Bool = true, _ lines: [[String: Any]]) -> Lyrics? {
        Lyrics(dictionary: ["synced": synced, "lines": lines])
    }

    private let song: [[String: Any]] = [
        ["text": "one two", "start": 2.0, "cues": [["position": 0, "endPosition": 3, "start": 2.0], ["position": 4, "endPosition": 7, "start": 3.5]]],
        ["text": "three", "start": 6.0, "cues": []],
        ["text": "four", "start": 9.0],
    ]

    func testNoLinesIsNoLyrics() {
        XCTAssertNil(lyrics([]))
        XCTAssertNil(Lyrics(dictionary: [:]))
    }

    func testLineIsTheLastOneStarted() throws {
        let timeline = try XCTUnwrap(lyrics(song))
        XCTAssertNil(timeline.lineIndex(at: 1.9))
        XCTAssertEqual(timeline.lineIndex(at: 2.0), 0)
        XCTAssertEqual(timeline.lineIndex(at: 5.99), 0)
        XCTAssertEqual(timeline.lineIndex(at: 6.0), 1)
        XCTAssertEqual(timeline.lineIndex(at: 500), 2)
    }

    func testUnsyncedLyricsFollowNoLine() throws {
        let plain = try XCTUnwrap(lyrics(synced: false, [["text": "one"], ["text": "two"]]))
        XCTAssertFalse(plain.synced)
        XCTAssertNil(plain.lineIndex(at: 10))
        XCTAssertTrue(plain.boundaryTimes.isEmpty)
    }

    func testSyncedNeedsATimedLine() throws {
        let claimed = try XCTUnwrap(lyrics(synced: true, [["text": "one"]]))
        XCTAssertFalse(claimed.synced)
    }

    func testSungLengthFollowsTheCues() throws {
        let timeline = try XCTUnwrap(lyrics(song))
        XCTAssertEqual(timeline.sungLength(inLine: 0, at: 2.0), 3)
        XCTAssertEqual(timeline.sungLength(inLine: 0, at: 3.4), 3)
        XCTAssertEqual(timeline.sungLength(inLine: 0, at: 3.5), 7)
        // A line without cues is sung whole from its start.
        XCTAssertEqual(timeline.sungLength(inLine: 1, at: 6.0), 5)
    }

    func testCueOutsideItsLineIsDropped() throws {
        let timeline = try XCTUnwrap(lyrics([["text": "abc", "start": 1.0, "cues": [["position": 0, "endPosition": 9, "start": 1.0], ["position": 2, "endPosition": 2, "start": 1.0]]]]))
        XCTAssertTrue(timeline.lines[0].cues.isEmpty)
    }

    func testCueRangesAreUtf16() throws {
        // "😀 ok": the emoji is two UTF-16 units, so "ok" starts at 3.
        let timeline = try XCTUnwrap(lyrics([["text": "😀 ok", "start": 1.0, "cues": [["position": 3, "endPosition": 5, "start": 1.5]]]]))
        XCTAssertEqual(timeline.lines[0].cues.count, 1)
        XCTAssertEqual(timeline.sungLength(inLine: 0, at: 2), 5)
    }

    func testBoundariesAreEveryLineAndWordStartOnce() throws {
        let timeline = try XCTUnwrap(lyrics(song))
        XCTAssertEqual(timeline.boundaryTimes, [2.0, 3.5, 6.0, 9.0])
    }

    func testCaptionIsCarried() throws {
        let captioned = try XCTUnwrap(Lyrics(dictionary: ["synced": true, "caption": "Generated", "lines": [["text": "a", "start": 1.0]]]))
        XCTAssertEqual(captioned.caption, "Generated")
    }
}
