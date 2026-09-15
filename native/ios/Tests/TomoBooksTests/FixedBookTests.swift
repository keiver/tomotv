import CoreGraphics
import XCTest

@testable import TomoBooks

/// Comics and PDFs: page counts, natural page order, rendered sizes.
final class FixedBookTests: XCTestCase {
    private let tv = CGSize(width: 1920, height: 1080)

    func testComicPagesComeOutInNaturalOrder() throws {
        let dir = BookFixtures.scratch(self)
        let book = try ImageBook(url: BookFixtures.url("fixture-comic.cbz"), directory: dir)
        XCTAssertEqual(book.pageCount, 12)
        let last = try book.renderPage(11, zoom: 1, scale: 1, pageSize: tv)
        XCTAssertEqual(last.width, 1200)
        XCTAssertEqual(last.height, 1600)
        XCTAssertTrue(FileManager.default.fileExists(atPath: last.url.path))
    }

    func testNaturalOrderPutsPageTenAfterPageNine() {
        let names = ["page-10.png", "page-9.png", "page-1.png", "page-100.png"]
        let sorted = names.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        XCTAssertEqual(sorted, ["page-1.png", "page-9.png", "page-10.png", "page-100.png"])
    }

    func testRarComicIsExtractedOnceAndServed() throws {
        let dir = BookFixtures.scratch(self)
        let book = try ImageBook(url: BookFixtures.url("if-an-a-bomb-falls-1951.cbr"), directory: dir)
        XCTAssertEqual(book.pageCount, 8)
        let first = try book.renderPage(0, zoom: 1, scale: 1, pageSize: tv)
        XCTAssertTrue(first.url.lastPathComponent.hasSuffix(".gif"))
        XCTAssertGreaterThan(first.width, 0)
    }

    func testSevenZipAndTarComicsMatchTheZip() throws {
        for name in ["fixture-comic.cb7", "fixture-comic.cbt"] {
            let book = try ImageBook(url: BookFixtures.url(name), directory: BookFixtures.scratch(self))
            XCTAssertEqual(book.pageCount, 12, name)
            let page = try book.renderPage(3, zoom: 1, scale: 1, pageSize: tv)
            XCTAssertEqual(page.width, 1200, name)
        }
    }

    func testPageFilterSkipsMetadataAndResourceForks() {
        XCTAssertTrue(ImageBook.isPage(ArchiveEntry(path: "vol1/Page 12.JPG", size: 10)))
        XCTAssertFalse(ImageBook.isPage(ArchiveEntry(path: "ComicInfo.xml", size: 10)))
        XCTAssertFalse(ImageBook.isPage(ArchiveEntry(path: "__MACOSX/._page-01.png", size: 10)))
        XCTAssertFalse(ImageBook.isPage(ArchiveEntry(path: "vol1/.hidden.png", size: 10)))
        XCTAssertFalse(ImageBook.isPage(ArchiveEntry(path: "page-01.png", size: 0)))
    }

    func testPdfRendersAtTheViewportFitTimesZoom() throws {
        let dir = BookFixtures.scratch(self)
        let book = try PdfBook(url: BookFixtures.url("fixture-book.pdf"), directory: dir)
        XCTAssertEqual(book.pageCount, 12)
        XCTAssertEqual(book.title, "Tomo Fixture Book")
        // 1200x1600 points into 1920x1080: height-bound, fit = 1080/1600.
        let one = try book.renderPage(4, zoom: 1, scale: 1, pageSize: tv)
        XCTAssertEqual(one.width, 810)
        XCTAssertEqual(one.height, 1080)
        let three = try book.renderPage(4, zoom: 3, scale: 1, pageSize: tv)
        XCTAssertEqual(three.width, 2430)
        XCTAssertEqual(three.height, 3240)
        XCTAssertEqual(BookRender.imagePixelSize(at: three.url), CGSize(width: 2430, height: 3240))
        // The rendered page is mostly white paper, not a black bitmap.
        let image = try XCTUnwrap(BookRender.loadImage(at: one.url))
        XCTAssertGreaterThan(Self.meanLuma(image), 200)
    }

    func testPdfRenderIsReusedFromDisk() throws {
        let dir = BookFixtures.scratch(self)
        let book = try PdfBook(url: BookFixtures.url("fixture-book.pdf"), directory: dir)
        let first = try book.renderPage(0, zoom: 1, scale: 2, pageSize: tv)
        let stamp = try FileManager.default.attributesOfItem(atPath: first.url.path)[.modificationDate] as? Date
        let again = try book.renderPage(0, zoom: 1, scale: 2, pageSize: tv)
        XCTAssertEqual(first.url, again.url)
        XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: again.url.path)[.modificationDate] as? Date, stamp)
    }

    func testBookOpenerRoutesByExtension() throws {
        XCTAssertEqual(BookOpener.kind(forExtension: "cbr"), .fixed)
        XCTAssertEqual(BookOpener.kind(forExtension: "azw3"), .text)
        XCTAssertNil(BookOpener.kind(forExtension: "txt"))
        XCTAssertThrowsError(try BookOpener.open(url: URL(fileURLWithPath: "/tmp/x.txt"), directory: BookFixtures.scratch(self), pageSize: tv, fontSize: 30)) { error in
            guard case BookError.unsupported("txt") = error else { return XCTFail("\(error)") }
        }
    }

    func testPurgeStaleKeepsOpenBooksOnly() throws {
        let root = BookFixtures.scratch(self)
        for token in ["open-1", "dead-1", "dead-2"] {
            try FileManager.default.createDirectory(at: root.appendingPathComponent(token), withIntermediateDirectories: true)
            try Data("x".utf8).write(to: root.appendingPathComponent(token).appendingPathComponent("0-1.jpg"))
        }
        BookOpener.purgeStale(root: root, keeping: ["open-1"])
        let left = try FileManager.default.contentsOfDirectory(atPath: root.path).sorted()
        XCTAssertEqual(left, ["open-1"])
        BookOpener.purgeStale(root: root.appendingPathComponent("missing"), keeping: [])
    }

    static func meanLuma(_ image: CGImage) -> Double {
        let width = 64, height = 64
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 0 }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let data = context.data else { return 0 }
        let bytes = data.bindMemory(to: UInt8.self, capacity: width * height)
        return (0..<(width * height)).reduce(0.0) { $0 + Double(bytes[$1]) } / Double(width * height)
    }
}
