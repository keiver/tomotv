import Foundation
import XCTest

/// Tests/Fixtures/books, read by path. See Tests/Fixtures/README.md for provenance.
enum BookFixtures {
    static func url(_ name: String) -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/books/\(name)")
    }

    /// A fresh scratch directory per test, removed by the caller's teardown.
    static func scratch(_ test: XCTestCase) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tomobooks-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        test.addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir
    }
}
