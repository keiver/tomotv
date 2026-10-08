import XCTest
@testable import TomoEngine

/// The live probe bound applies to a tuner's raw MPEG-TS and nothing else: an HLS or DASH origin
/// passes its probe limits down to every rendition context, and a VOD file reads its 7 s at disk speed.
final class LiveProbeBoundTests: XCTestCase {

    func testALiveTransportStreamIsBoundedToTwoSeconds() {
        XCTAssertEqual(liveProbeBound(format: "mpegts", isLive: true), 2_000_000)
    }

    func testManifestOriginsAndFilesKeepTheDefaultProbe() {
        XCTAssertNil(liveProbeBound(format: "hls", isLive: true))
        XCTAssertNil(liveProbeBound(format: "dash", isLive: true))
        XCTAssertNil(liveProbeBound(format: "mpegts", isLive: false))
        XCTAssertNil(liveProbeBound(format: "mov,mp4,m4a,3gp,3g2,mj2", isLive: false))
    }
}
