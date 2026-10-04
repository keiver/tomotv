import XCTest
@testable import TomoEngine

/// Only a variant the master declares SDR, or leaves undeclared, gets its init retagged; a
/// PQ or HLG variant carries content that matches its declaration and plays as HDR.
final class PlaylistShimTests: XCTestCase {
    func testDeclaredRangeDecidesTheRetag() {
        XCTAssertFalse(PlaylistShim.declaresHdr(#"#EXT-X-STREAM-INF:BANDWIDTH=8192000,VIDEO-RANGE=SDR,CODECS="hvc1.1.4.L120.B0,mp4a.40.2",RESOLUTION=1920x1080"#))
        XCTAssertFalse(PlaylistShim.declaresHdr(#"#EXT-X-STREAM-INF:BANDWIDTH=20192000,CODECS="avc1.424029,mp4a.40.2""#))
        XCTAssertTrue(PlaylistShim.declaresHdr(#"#EXT-X-STREAM-INF:BANDWIDTH=91171290,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.B0,mp4a.40.2",RESOLUTION=3840x2160"#))
        XCTAssertTrue(PlaylistShim.declaresHdr("#EXT-X-STREAM-INF:BANDWIDTH=1,VIDEO-RANGE=HLG"))
    }
}
