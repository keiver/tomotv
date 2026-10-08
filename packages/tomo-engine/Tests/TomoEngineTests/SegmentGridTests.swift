import XCTest

@testable import TomoEngine

/// The fixed 6s grid. A segment the producer can never fill turns into a hard
/// AVPlayer -1100 in the final second, so the grid must tile the duration exactly.
final class SegmentGridTests: XCTestCase {
    private func session(duration: Double) throws -> RemuxSession {
        try RemuxSession(config: makeConfig(durationSeconds: duration))
    }

    func testGridTilesDurationExactly() throws {
        // 32s is the remainder case: 5 segments on a 6s grid cover 30s, and the
        // final one absorbs the extra 2s rather than leaving a hole.
        for duration in [30.0, 32.0, 35.9, 6.0, 4.0, 0.5, 121.7] {
            let s = try session(duration: duration)
            let total = (0..<s.segmentCount).reduce(0.0) { $0 + s.segmentDurationSeconds($1) }
            XCTAssertEqual(total, duration, accuracy: 0.0005, "grid does not tile \(duration)s")
        }
    }

    func testFinalSegmentAbsorbsTheRemainder() throws {
        let s = try session(duration: 32.0)
        XCTAssertEqual(s.segmentCount, 5)
        XCTAssertEqual(s.segmentDurationSeconds(3), 6.0, accuracy: 0.0001)
        XCTAssertEqual(s.segmentDurationSeconds(4), 8.0, accuracy: 0.0001)
    }

    func testShortAndZeroDurationsStillProduceOneSegment() throws {
        XCTAssertEqual(try session(duration: 4.0).segmentCount, 1)
        XCTAssertEqual(try session(duration: 4.0).segmentDurationSeconds(0), 4.0, accuracy: 0.0001)

        // Floored, never zero: a zero-length segment is not a playable segment.
        let empty = try session(duration: 0.0)
        XCTAssertEqual(empty.segmentCount, 1)
        XCTAssertEqual(empty.segmentDurationSeconds(0), 0.001, accuracy: 0.00001)
    }

    func testStartSecondsAreContiguousAndEndAtDuration() throws {
        let s = try session(duration: 32.0)
        XCTAssertEqual(s.segmentStartSeconds(0), 0.0, accuracy: 0.0001)
        XCTAssertEqual(s.segmentStartSeconds(1), 6.0, accuracy: 0.0001)
        XCTAssertEqual(s.segmentStartSeconds(4), 24.0, accuracy: 0.0001)
        // n == segmentCount is the stream end, the boundary the final cut checks.
        XCTAssertEqual(s.segmentStartSeconds(s.segmentCount), 30.0, accuracy: 0.0001)
    }

    func testSegmentIndexPicksTheContainingSegment() throws {
        let s = try session(duration: 32.0)
        XCTAssertEqual(s.segmentIndex(atSeconds: 0.0), 0)
        XCTAssertEqual(s.segmentIndex(atSeconds: 5.999), 0)
        XCTAssertEqual(s.segmentIndex(atSeconds: 6.0), 1)
        XCTAssertEqual(s.segmentIndex(atSeconds: 29.9), 4)
    }

    func testSegmentIndexFloorsANegativeSeek() throws {
        let s = try session(duration: 32.0)
        XCTAssertEqual(s.segmentIndex(atSeconds: -5.0), 0)
    }
}
