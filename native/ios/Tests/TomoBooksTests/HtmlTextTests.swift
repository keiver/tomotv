import CoreGraphics
import CoreText
import XCTest

@testable import TomoBooks

/// The markup subset that becomes attributed text: blocks, inline styles, entities, pictures.
final class HtmlTextTests: XCTestCase {
    private let options = HtmlTextOptions(fontSize: 20, columnWidth: 600, maxImageHeight: 800)

    private func build(_ html: String, base: URL = URL(fileURLWithPath: "/tmp")) -> NSAttributedString {
        HtmlTextBuilder.build(html: html, base: base, options: options)
    }

    func testParagraphsBecomeLinesAndWhitespaceCollapses() {
        let text = build("<html><head><title>skip me</title></head><body><p>Hello,\n   world</p>\n<p>Second   paragraph</p></body></html>")
        XCTAssertEqual(text.string, "Hello, world\nSecond paragraph\n")
    }

    func testEntitiesDecode() {
        XCTAssertEqual(HtmlTextBuilder.decodeEntities("Tom &amp; Jerry &lt;3 &#8212; &#x2019;caf&eacute;&rsquo; &nbsp;x"), "Tom & Jerry <3 \u{2014} \u{2019}café\u{2019} \u{A0}x")
        XCTAssertEqual(HtmlTextBuilder.decodeEntities("&unknownthing; stays"), "&unknownthing; stays")
    }

    func testEmphasisChangesTheFontTraits() {
        let text = build("<p>plain <em>slanted</em> <strong>heavy</strong></p>")
        func traits(at location: Int) -> CTFontSymbolicTraits {
            let font = text.attribute(kCTFontAttributeName as NSAttributedString.Key, at: location, effectiveRange: nil) as! CTFont
            return CTFontGetSymbolicTraits(font)
        }
        XCTAssertFalse(traits(at: 0).contains(.traitItalic))
        XCTAssertTrue(traits(at: 7).contains(.traitItalic), "inside <em>")
        XCTAssertTrue(traits(at: 15).contains(.traitBold), "inside <strong>")
    }

    func testHeadingsAreLargerAndBold() {
        let text = build("<h1>Title</h1><p>body</p>")
        let heading = text.attribute(kCTFontAttributeName as NSAttributedString.Key, at: 0, effectiveRange: nil) as! CTFont
        let body = text.attribute(kCTFontAttributeName as NSAttributedString.Key, at: 7, effectiveRange: nil) as! CTFont
        XCTAssertGreaterThan(CTFontGetSize(heading), CTFontGetSize(body))
        XCTAssertTrue(CTFontGetSymbolicTraits(heading).contains(.traitBold))
    }

    func testUnclosedTagsAndBreaksStillFlow() {
        let text = build("<p>one<br>two<p>three<div>four")
        XCTAssertEqual(text.string, "one\u{2028}two\nthree\nfour\n")
    }

    func testListItemsGetBullets() {
        let text = build("<ul><li>first</li><li>second</li></ul>")
        XCTAssertEqual(text.string, "\u{2022} first\n\u{2022} second\n")
    }

    func testScriptStyleAndCommentsAreDropped() {
        let text = build("<p>keep</p><script>var x = '<p>no</p>';</script><style>p{}</style><!-- <p>no</p> --><p>also</p>")
        XCTAssertEqual(text.string, "keep\nalso\n")
    }

    func testPictureBecomesARunDelegateSizedToTheColumn() throws {
        let dir = BookFixtures.scratch(self)
        // 1200x1600 page 1 out of the fixture archive, wider than the 600pt column.
        try BookArchive(url: BookFixtures.url("fixture-comic.cbz")).extract("page-01.png", to: dir.appendingPathComponent("p.png"))
        let text = build("<p>before</p><p><img src=\"p.png\" alt=\"x\"/></p><p>after</p>", base: dir)
        XCTAssertEqual(text.string, "before\n\u{FFFC}\nafter\n")
        let ref = try XCTUnwrap(text.attribute(BookTextAttribute.image, at: 7, effectiveRange: nil) as? BookImageRef)
        XCTAssertEqual(ref.size.width, 600)
        XCTAssertEqual(ref.size.height, 800)
        XCTAssertNotNil(text.attribute(kCTRunDelegateAttributeName as NSAttributedString.Key, at: 7, effectiveRange: nil))
    }

    func testMissingOrRemotePicturesAreSkipped() {
        let text = build("<p>a</p><img src=\"nope.png\"/><img src=\"http://x/y.png\"/><p>b</p>")
        XCTAssertEqual(text.string, "a\nb\n")
    }

    func testMobiStyleMarkupReads() {
        let text = build("<html><body><p height=\"1em\" width=\"0pt\" align=\"center\"><font size=\"5\">Chapter I</font></p><mbp:pagebreak/><p>Text &amp; more.</p></body></html>")
        XCTAssertEqual(text.string, "Chapter I\nText & more.\n")
    }
}
