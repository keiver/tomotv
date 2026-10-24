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

    /// The shape of a Pluto channel master: every variant hangs audio and subtitles off groups.
    private let grouped = """
    #EXTM3U
    #EXT-X-VERSION:5
    #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=NO,FORCED=NO,URI="subs/en.m3u8",LANGUAGE="en"
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English [Original]",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="2",URI="audio/en.m3u8"
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",AUTOSELECT=YES,CHANNELS="2",URI="audio/ad.m3u8",CHARACTERISTICS="public.accessibility.describes-video"
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="es",NAME="Español",AUTOSELECT=YES,CHANNELS="2",URI="audio/es.m3u8"
    #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1042180,SUBTITLES="subs",AUDIO="audio"
    1042180/playlist.m3u8
    #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3321280,SUBTITLES="subs",AUDIO="audio"
    3321280/playlist.m3u8
    #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=640930,SUBTITLES="subs",AUDIO="audio"
    640930/playlist.m3u8
    """

    func testATrimmedMasterKeepsTheTopVariantEveryAudioAndTheSubtitles() {
        let trimmed = LiveVariantPicker.trimmedMaster(grouped, base: "https://stitcher.example/channel/master.m3u8?sid=1")
        XCTAssertEqual(trimmed, """
        #EXTM3U
        #EXT-X-VERSION:5
        #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=NO,FORCED=NO,LANGUAGE="en",URI="https://stitcher.example/channel/subs/en.m3u8"
        #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English [Original]",CHANNELS="2",URI="https://stitcher.example/channel/audio/en.m3u8",DEFAULT=YES,AUTOSELECT=YES
        #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",AUTOSELECT=YES,CHANNELS="2",CHARACTERISTICS="public.accessibility.describes-video",URI="https://stitcher.example/channel/audio/ad.m3u8",DEFAULT=NO
        #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="es",NAME="Español",AUTOSELECT=YES,CHANNELS="2",URI="https://stitcher.example/channel/audio/es.m3u8",DEFAULT=NO
        #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3321280,SUBTITLES="subs",AUDIO="audio"
        https://stitcher.example/channel/3321280/playlist.m3u8

        """)
    }

    func testATrimmedMasterMakesTheAskedLanguageTheDefaultAndKeepsTheRest() {
        let trimmed = LiveVariantPicker.trimmedMaster(grouped, base: "https://o/c/master.m3u8", audioLanguage: "spa")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/es.m3u8\",DEFAULT=YES") == true, trimmed ?? "nil")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/en.m3u8\",DEFAULT=NO") == true, trimmed ?? "nil")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/ad.m3u8\",DEFAULT=NO") == true, trimmed ?? "nil")
    }

    func testATrimmedMasterNeverMakesTheDescribedVideoTrackTheDefaultWhenAnotherMatches() {
        let trimmed = LiveVariantPicker.trimmedMaster(grouped, base: "https://o/c/master.m3u8", audioLanguage: "en")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/en.m3u8\",DEFAULT=YES") == true, trimmed ?? "nil")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/ad.m3u8\",DEFAULT=NO") == true, trimmed ?? "nil")
    }

    func testATrimmedMasterNeverMakesAHearingImpairedTrackTheDefaultWhenAnotherMatches() {
        let master = grouped.replacingOccurrences(of: "NAME=\"English [Original]\",AUTOSELECT=YES,DEFAULT=YES", with: "NAME=\"English SDH\",AUTOSELECT=YES,DEFAULT=YES,CHARACTERISTICS=\"public.accessibility.describes-music-and-sound\"")
        let trimmed = LiveVariantPicker.trimmedMaster(master, base: "https://o/c/master.m3u8", audioLanguage: "")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/es.m3u8\",DEFAULT=YES") == true, trimmed ?? "nil")
        XCTAssertTrue(trimmed?.contains("URI=\"https://o/c/audio/en.m3u8\",DEFAULT=NO") == true, trimmed ?? "nil")
    }

    func testAPlaylistKeyThatNoLaneDecodesIsReadAsDrm() {
        XCTAssertEqual(LiveVariantPicker.drmKeyFormat("#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://k\",KEYFORMAT=\"com.apple.streamingkeydelivery\"\n"), "com.apple.streamingkeydelivery")
        XCTAssertEqual(LiveVariantPicker.drmKeyFormat("#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI=\"k\"\n"), "SAMPLE-AES")
        XCTAssertNil(LiveVariantPicker.drmKeyFormat("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n"))
        XCTAssertNil(LiveVariantPicker.drmKeyFormat("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n"))
    }

    func testATrimmedMasterOfMuxedVariantsHasNoAudioRendition() {
        let trimmed = LiveVariantPicker.trimmedMaster(master, base: "https://origin.example/live/master.m3u8")
        XCTAssertEqual(trimmed, """
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
        https://origin.example/live/high/index.m3u8

        """)
    }

    func testAnAudioOnlyOrMediaPlaylistHasNoTrimmedMaster() {
        XCTAssertNil(LiveVariantPicker.trimmedMaster("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=96000,CODECS=\"mp4a.40.2\"\na.m3u8\n", base: "https://o/m.m3u8"))
        XCTAssertNil(LiveVariantPicker.trimmedMaster("#EXTM3U\n#EXTINF:6,\nseg1.ts\n", base: "https://o/live.m3u8"))
    }

    func testRemovingAnAttributeKeepsQuotedCommas() {
        XCTAssertEqual(LiveVariantPicker.removing("AUDIO", from: "BANDWIDTH=1,CODECS=\"avc1,mp4a\",AUDIO=\"a\",SUBTITLES=\"s\""), "BANDWIDTH=1,CODECS=\"avc1,mp4a\",SUBTITLES=\"s\"")
    }

    func testAttributesReadQuotedValuesWithCommas() {
        let attributes = "BANDWIDTH=1500000,CODECS=\"avc1.4d401f,mp4a.40.2\",RESOLUTION=854x480"
        XCTAssertEqual(LiveVariantPicker.attribute("CODECS", in: attributes), "avc1.4d401f,mp4a.40.2")
        XCTAssertEqual(LiveVariantPicker.attribute("RESOLUTION", in: attributes), "854x480")
        XCTAssertNil(LiveVariantPicker.attribute("FRAME-RATE", in: attributes))
    }
}
