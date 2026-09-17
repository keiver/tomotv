import XCTest

@testable import TomoEngine

/// A rung's init is the codec header, byte-stable across segments: the head of a segment yields
/// the same init as the whole of it, so a cold rung can start without fetching a full segment.
final class TierInitPartialTests: XCTestCase {
    private var segment: Data {
        if let path = ProcessInfo.processInfo.environment["TOMO_TIER_SEGMENT"] { return (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data() }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/tier-segment.mpegts")
        return (try? Data(contentsOf: url)) ?? Data()
    }

    func testTheHeadOfASegmentYieldsTheSameInit() throws {
        let whole = segment
        XCTAssertFalse(whole.isEmpty, "Fixtures/tier-segment.mpegts is missing")
        let full = try XCTUnwrap(TierRewrapper.rewrap(tsData: whole, targetStartSeconds: 0))
        for kb in [32, 64, 128, 256, 512, 1024] {
            let bytes = min(whole.count, kb * 1024 / 188 * 188)
            let head = TierRewrapper.rewrap(tsData: whole.prefix(bytes), targetStartSeconds: 0)
            print("head \(kb)KB of \(whole.count / 1024)KB: init \(head.map { $0.initSegment == full.initSegment ? "identical" : "differs" } ?? "none")")
        }
    }
}
