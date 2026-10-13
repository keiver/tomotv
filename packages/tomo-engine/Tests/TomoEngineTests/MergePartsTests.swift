import Foundation
import XCTest

@testable import TomoEngine

/// mergeParts joins ranged part files into the one file the repackager then reads.
final class MergePartsTests: XCTestCase {
    private func tempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("merge-parts-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir
    }

    private func write(_ bytes: [UInt8], as name: String, in dir: URL) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try Data(bytes).write(to: url)
        return url
    }

    func testMergesInOrderAndRemovesParts() throws {
        let dir = try tempDir()
        let parts = [
            try write([1, 2, 3], as: "a.part0", in: dir),
            try write([4, 5], as: "a.part1", in: dir),
            try write([6], as: "a.part2", in: dir),
        ]
        let destination = dir.appendingPathComponent("a.bin")
        try DownloadRepackager.mergeParts(parts, into: destination)
        XCTAssertEqual(try Data(contentsOf: destination), Data([1, 2, 3, 4, 5, 6]))
        for part in parts { XCTAssertFalse(FileManager.default.fileExists(atPath: part.path)) }
    }

    func testSinglePartBecomesTheDestination() throws {
        let dir = try tempDir()
        let part = try write([9, 9], as: "b.part0", in: dir)
        let destination = dir.appendingPathComponent("b.bin")
        try DownloadRepackager.mergeParts([part], into: destination)
        XCTAssertEqual(try Data(contentsOf: destination), Data([9, 9]))
        XCTAssertFalse(FileManager.default.fileExists(atPath: part.path))
    }

    func testReplacesAnExistingDestination() throws {
        let dir = try tempDir()
        let part = try write([7], as: "c.part0", in: dir)
        let destination = try write([1, 1, 1], as: "c.bin", in: dir)
        try DownloadRepackager.mergeParts([part], into: destination)
        XCTAssertEqual(try Data(contentsOf: destination), Data([7]))
    }

    func testMissingPartThrowsAndNoPartsThrows() throws {
        let dir = try tempDir()
        let part = try write([1], as: "d.part0", in: dir)
        let missing = dir.appendingPathComponent("d.part1")
        XCTAssertThrowsError(try DownloadRepackager.mergeParts([part, missing], into: dir.appendingPathComponent("d.bin")))
        XCTAssertThrowsError(try DownloadRepackager.mergeParts([], into: dir.appendingPathComponent("e.bin")))
    }
}
