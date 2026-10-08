import XCTest
@testable import TomoEngine

/// Which variant a live frame reads off a multivariant playlist.
final class LiveVariantPickerTests: XCTestCase {
    private let master = """
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
    high/index.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480,CODECS="avc1.4d401f,mp4a.40.2"
    mid/index.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=426x240,CODECS="avc1.42c01e,mp4a.40.2"
    low/index.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=96000,CODECS="mp4a.40.2"
    audio/index.m3u8
    """

    func testPicksTheCheapestVariantTallEnoughForACard() {
        XCTAssertEqual(LiveVariantPicker.pick(master, base: "https://origin.example/live/master.m3u8"), "https://origin.example/live/mid/index.m3u8")
    }

    func testFallsBackToTheTallestWhenNoneIsTallEnough() {
        let small = """
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180
        a.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=426x240
        b.m3u8
        """
        XCTAssertEqual(LiveVariantPicker.pick(small, base: "https://o/x/master.m3u8"), "https://o/x/b.m3u8")
    }

    func testAVariantWithoutAResolutionIsTakenOnBandwidthAlone() {
        let bare = """
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=2000000
        https://cdn.example/two.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=800000
        https://cdn.example/one.m3u8
        """
        XCTAssertEqual(LiveVariantPicker.pick(bare, base: "https://o/master.m3u8"), "https://cdn.example/one.m3u8")
    }

    func testAMediaPlaylistIsNotAMaster() {
        XCTAssertNil(LiveVariantPicker.pick("#EXTM3U\n#EXTINF:6,\nseg1.ts\n", base: "https://o/live.m3u8"))
    }

    func testAttributesReadQuotedValuesWithCommas() {
        let attributes = "BANDWIDTH=1500000,CODECS=\"avc1.4d401f,mp4a.40.2\",RESOLUTION=854x480"
        XCTAssertEqual(LiveVariantPicker.attribute("CODECS", in: attributes), "avc1.4d401f,mp4a.40.2")
        XCTAssertEqual(LiveVariantPicker.attribute("RESOLUTION", in: attributes), "854x480")
        XCTAssertNil(LiveVariantPicker.attribute("FRAME-RATE", in: attributes))
    }
}
