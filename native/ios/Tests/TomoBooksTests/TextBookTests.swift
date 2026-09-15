import CoreGraphics
import XCTest

@testable import TomoBooks

/// EPUB, MOBI and KF8 through the same text pipeline: chapters, pagination, renders, relayout.
final class TextBookTests: XCTestCase {
    private let tv = CGSize(width: 1920, height: 1080)
    private let phone = CGSize(width: 390, height: 844)

    func testEpubSpineOrderAndTitle() throws {
        let epub = try EpubBook(url: BookFixtures.url("fixture-novel.epub"), directory: BookFixtures.scratch(self))
        XCTAssertEqual(epub.chapterCount, 3)
        XCTAssertEqual(epub.title, "Tomo Fixture Novel")
        let (html, base) = try epub.chapterHTML(1)
        XCTAssertTrue(html.contains("<h1>Chapter 2</h1>"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: base.appendingPathComponent("images/figure.jpg").path))
    }

    func testEpubPaginatesAndPlacesThePicture() throws {
        let book = TextBook(source: try EpubBook(url: BookFixtures.url("fixture-novel.epub"), directory: BookFixtures.scratch(self)), directory: BookFixtures.scratch(self), pageSize: tv, fontSize: 36)
        book.paginateAll()
        XCTAssertTrue(book.isPaginated)
        XCTAssertGreaterThan(book.pageCount, 6, "three chapters of forty paragraphs at 36pt fill more than two pages each")
        // Chapter 2 opens with its heading and one paragraph; the 600x800 picture does not fit under
        // them, so it opens the next page. That page is the darkest of the chapter.
        let chapterTwoStart = book.pages.firstIndex { $0.chapter == 1 }!
        let heading = try book.renderPage(chapterTwoStart, zoom: 1, scale: 1, pageSize: tv)
        XCTAssertEqual(heading.width, 1920)
        XCTAssertEqual(heading.height, 1080)
        let picture = try book.renderPage(chapterTwoStart + 1, zoom: 1, scale: 1, pageSize: tv)
        let headingLuma = FixedBookTests.meanLuma(try XCTUnwrap(BookRender.loadImage(at: heading.url)))
        let pictureLuma = FixedBookTests.meanLuma(try XCTUnwrap(BookRender.loadImage(at: picture.url)))
        XCTAssertLessThan(headingLuma, 255, "the heading page carries text")
        XCTAssertLessThan(pictureLuma, headingLuma, "the picture page carries the 600x800 figure")
    }

    func testRelayoutKeepsThePlace() throws {
        let book = TextBook(source: try EpubBook(url: BookFixtures.url("fixture-novel.epub"), directory: BookFixtures.scratch(self)), directory: BookFixtures.scratch(self), pageSize: phone, fontSize: 16)
        book.paginateAll()
        let small = book.pageCount
        let chapterThree = book.pages.firstIndex { $0.chapter == 2 }!
        let anchor = book.anchor(forPage: chapterThree + 1)
        let landed = book.relayout(pageSize: phone, fontSize: 26, anchor: anchor)
        XCTAssertGreaterThan(book.pageCount, small, "bigger text means more pages")
        XCTAssertEqual(book.pages[landed].chapter, 2)
        XCTAssertLessThanOrEqual(book.pages[landed].range.location, anchor.offset)
        if landed + 1 < book.pageCount, book.pages[landed + 1].chapter == 2 {
            XCTAssertGreaterThan(book.pages[landed + 1].range.location, anchor.offset)
        }
    }

    func testMobiSectionsAndText() throws {
        let mobi = try MobiBook(url: BookFixtures.url("frankenstein.mobi"), directory: BookFixtures.scratch(self))
        XCTAssertEqual(mobi.chapterCount, 35, "foliate-js reads the same file as 35 sections")
        XCTAssertEqual(mobi.title, "Frankenstein; or, the modern prometheus")
        let (html, _) = try mobi.chapterHTML(1)
        XCTAssertTrue(html.contains("Frankenstein"))
        XCTAssertFalse(html.lowercased().contains("<mbp:pagebreak"))
    }

    func testKF8SectionsAndText() throws {
        let azw3 = try MobiBook(url: BookFixtures.url("frankenstein.azw3"), directory: BookFixtures.scratch(self))
        XCTAssertEqual(azw3.chapterCount, 34, "foliate-js reads the same file as 34 sections")
        XCTAssertEqual(azw3.title, "Frankenstein; or, the modern prometheus")
        let (html, _) = try azw3.chapterHTML(1)
        let text = HtmlTextBuilder.build(html: html, base: URL(fileURLWithPath: "/tmp"), options: HtmlTextOptions(fontSize: 20, columnWidth: 600, maxImageHeight: 800)).string
        XCTAssertTrue(text.contains("The Project Gutenberg eBook of Frankenstein"), text.prefix(200).description)
        XCTAssertFalse(html.contains("kindle:embed:"), "embedded resources are rewritten to files")
    }

    func testMobiAndKF8PaginateToNovelLength() throws {
        for name in ["frankenstein.mobi", "frankenstein.azw3"] {
            let book = TextBook(source: try MobiBook(url: BookFixtures.url(name), directory: BookFixtures.scratch(self)), directory: BookFixtures.scratch(self), pageSize: tv, fontSize: 36)
            book.paginateAll()
            XCTAssertGreaterThan(book.pageCount, 150, name)
            XCTAssertLessThan(book.pageCount, 700, name)
            let page = try book.renderPage(40, zoom: 1, scale: 1, pageSize: tv)
            XCTAssertEqual(page.width, 1920, name)
        }
    }

    func testPageLookupByAnchor() throws {
        let book = TextBook(source: try EpubBook(url: BookFixtures.url("fixture-novel.epub"), directory: BookFixtures.scratch(self)), directory: BookFixtures.scratch(self), pageSize: tv, fontSize: 36)
        book.paginateAll()
        for index in 0..<book.pageCount {
            let anchor = book.anchor(forPage: index)
            XCTAssertEqual(book.page(forChapter: anchor.chapter, offset: anchor.offset), index)
        }
    }
}
