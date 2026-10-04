import XCTest

@testable import TomoLiveSources

final class JellyfinChannelIdTests: XCTestCase {
    func testMd5GuidMatchesDotNet() {
        XCTAssertEqual(JellyfinChannelId.md5Guid(""), "d98c1dd4008f04b2e9800998ecf8427e")
        XCTAssertEqual(JellyfinChannelId.md5Guid("abc"), "cf7314cec680fdb3a8e3dfc006adc315")
        XCTAssertEqual(JellyfinChannelId.md5Guid("Tëst ☃"), "90726aa5886311febbfb8b2ebc803acc")
    }

    /// Ids a Jellyfin server reported for the public iptv-org tuner.
    func testMatchesServerIds() {
        let tuner = "https://iptv-org.github.io/iptv/index.m3u"
        let cases = [
            "https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8": "29760fcf9675901f16991386edf6a0e3",
            "http://37.238.136.61/hls/stream.m3u8": "fdb32ffa9a959ca70da9c789042bfaa0",
            "https://w2.manasat.com/cirkev-online/smil:cirkev-online.smil/playlist.m3u8": "928ed29b05769ffe603f58d36fa62d17",
            "https://live.artidijitalmedya.com/artidijital_astv/astv/playlist.m3u8": "397e5eef20d1938d04a5dbdf1a5c4281",
        ]
        for (stream, id) in cases {
            XCTAssertEqual(JellyfinChannelId.forM3u(tunerUrl: tuner, streamUrl: stream), id, stream)
        }
    }

    func testIdsDependOnTheTuner() {
        let stream = "http://example.com/a.m3u8"
        XCTAssertNotEqual(JellyfinChannelId.forM3u(tunerUrl: "http://example.com/a.m3u", streamUrl: stream),
                          JellyfinChannelId.forM3u(tunerUrl: "http://example.com/b.m3u", streamUrl: stream))
    }
}
