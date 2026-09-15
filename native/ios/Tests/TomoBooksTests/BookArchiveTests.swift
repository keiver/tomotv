import XCTest

@testable import TomoBooks

/// The libarchive build behind every comic and EPUB: each container format the resolver admits.
final class BookArchiveTests: XCTestCase {
    func testZipListsTwelvePagesInArchiveOrder() throws {
        let entries = try BookArchive(url: BookFixtures.url("fixture-comic.cbz")).entries()
        XCTAssertEqual(entries.count, 12)
        XCTAssertEqual(entries.first?.path, "page-01.png")
        XCTAssertEqual(entries.map(\.size).reduce(0, +), 601_503)
    }

    func testTarAndSevenZipListTheSamePages() throws {
        let tar = try BookArchive(url: BookFixtures.url("fixture-comic.cbt")).entries().map(\.path)
        let seven = try BookArchive(url: BookFixtures.url("fixture-comic.cb7")).entries().map(\.path)
        XCTAssertEqual(tar.count, 12)
        XCTAssertEqual(Set(tar), Set(seven))
    }

    func testRar3AndRar5Read() throws {
        let rar3 = try BookArchive(url: BookFixtures.url("libarchive-rar3.rar")).entries()
        XCTAssertEqual(rar3.count, 2, "libarchive's own RAR test archive: five headers, two regular files")
        let rar5 = try BookArchive(url: BookFixtures.url("libarchive-rar5.rar")).entries()
        XCTAssertEqual(rar5.map(\.path), ["helloworld.txt"])
        let dir = BookFixtures.scratch(self)
        try BookArchive(url: BookFixtures.url("libarchive-rar5.rar")).extract("helloworld.txt", to: dir.appendingPathComponent("hello.txt"))
        XCTAssertEqual(try String(contentsOf: dir.appendingPathComponent("hello.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), "hello libarchive test suite!")
    }

    func testSevenZipLzma2NeedsTheVendoredLiblzma() throws {
        let dir = BookFixtures.scratch(self)
        let archive = BookArchive(url: BookFixtures.url("libarchive-lzma2.7z"))
        let written = try archive.extractAll(to: dir)
        XCTAssertEqual(written, ["file1"])
        XCTAssertEqual(try Data(contentsOf: dir.appendingPathComponent("file1")).count, 2844)
    }

    func testRealWorldComicRar() throws {
        let entries = try BookArchive(url: BookFixtures.url("if-an-a-bomb-falls-1951.cbr")).entries()
        XCTAssertEqual(entries.count, 8)
        XCTAssertEqual(entries.first?.path, "abmb01.gif")
    }

    func testExtractOneEntryYieldsTheOriginalBytes() throws {
        let dir = BookFixtures.scratch(self)
        let target = dir.appendingPathComponent("page.png")
        try BookArchive(url: BookFixtures.url("fixture-comic.cbz")).extract("page-07.png", to: target)
        let bytes = try Data(contentsOf: target)
        XCTAssertEqual([UInt8](bytes.prefix(4)), [0x89, 0x50, 0x4E, 0x47])
        XCTAssertEqual(BookRender.imagePixelSize(at: target), CGSize(width: 1200, height: 1600))
    }

    func testNotAnArchiveThrowsWithLibarchivesMessage() {
        XCTAssertThrowsError(try BookArchive(url: BookFixtures.url("fixture-book.pdf")).entries()) { error in
            guard case BookError.archive = error else { return XCTFail("\(error)") }
        }
    }
}
