import XCTest

@testable import TomoEngine

/// Rendering the ASS markup a sidecar's WebVTT still carries when the server passed the cue text through.
final class WebVttCueTextTests: XCTestCase {
    private func cue(_ text: String) -> String {
        "WEBVTT\n\n00:00:01.000 --> 00:00:04.000 region:subtitle line:90%\n\(text)\n"
    }

    func testAnOverrideBlockAtTheStartOfEveryLineIsDropped() {
        XCTAssertEqual(cleanWebVttCues(cue("{\\fad(120,120)}Some line")), cue("Some line"))
    }

    func testPositioningAndSeveralBlocksInOneCueAreDropped() {
        XCTAssertEqual(cleanWebVttCues(cue("{\\an8}{\\pos(960,200)}Sign {\\blur2}here")), cue("Sign here"))
    }

    func testBoldItalicAndUnderlineOverridesBecomeTags() {
        XCTAssertEqual(cleanWebVttCues(cue("{\\i1}Thought{\\i0} spoken {\\b1}loud{\\b0} {\\u1}under")), cue("<i>Thought</i> spoken <b>loud</b> <u>under</u>"))
    }

    func testAResetClosesTheOpenTags() {
        XCTAssertEqual(cleanWebVttCues(cue("{\\i1}Thought{\\r} spoken")), cue("<i>Thought</i> spoken"))
    }

    func testLineBreaksAndHardSpacesAreRendered() {
        XCTAssertEqual(cleanWebVttCues(cue("First\\NSecond\\nThird\\hword")), cue("First\nSecond\nThird\u{00A0}word"))
    }

    func testADrawingIsDropped() {
        XCTAssertEqual(cleanWebVttCues(cue("{\\p1}m 0 0 l 100 0 100 100{\\p0}")), cue(""))
    }

    func testMarkupTheBodyAlreadyHasIsKept() {
        let body = cue("{\\an8}<i>Already</i> &amp; kept")
        XCTAssertEqual(cleanWebVttCues(body), cue("<i>Already</i> &amp; kept"))
    }

    func testBracesWithoutABackslashArePlainText() {
        XCTAssertEqual(cleanWebVttCues(cue("{laughs} then {\\i1}words")), cue("{laughs} then <i>words</i>"))
    }

    func testABodyWithNoMarkupIsReturnedAsItIs() {
        let body = "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nPlain\r\n"
        XCTAssertEqual(cleanWebVttCues(body), body)
    }

    func testHeaderNoteStyleAndTimingLinesPassThrough() {
        let body = """
        WEBVTT
        X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000

        NOTE {\\i1} inside a note --> stays

        STYLE
        ::cue { color: yellow }

        1
        00:00:01.000 --> 00:00:02.500 line:90% align:start
        {\\fad(120,120)}First
        {\\an8}Second line

        """
        let expected = """
        WEBVTT
        X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000

        NOTE {\\i1} inside a note --> stays

        STYLE
        ::cue { color: yellow }

        1
        00:00:01.000 --> 00:00:02.500 line:90% align:start
        First
        Second line

        """
        XCTAssertEqual(cleanWebVttCues(body), expected)
    }
}
