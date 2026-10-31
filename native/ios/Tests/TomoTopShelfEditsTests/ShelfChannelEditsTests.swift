import XCTest

@testable import TomoTopShelfEdits

final class ShelfChannelEditsTests: XCTestCase {
    private func write(_ json: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("edits-\(UUID().uuidString).json")
        try json.data(using: .utf8)!.write(to: url)
        return url
    }

    func testMissingOrMalformedFileHidesNothing() throws {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("missing-\(UUID().uuidString).json")
        XCTAssertFalse(ShelfChannelEdits.load(from: missing).isHidden(id: "a", number: nil, name: "A"))
        let broken = try write("{not json")
        XCTAssertFalse(ShelfChannelEdits.load(from: broken).isHidden(id: "a", number: nil, name: "A"))
        XCTAssertNil(ShelfChannelEdits.load(from: broken).displayName(id: "a", number: nil, name: "A"))
    }

    func testHidesByIdThenByNumberAndName() throws {
        let edits = ShelfChannelEdits.load(from: try write("""
        {"hidden":[{"id":"abc","number":"9.1","name":"KQED"},{"name":"Al Jazeera English"}],"renames":[]}
        """))
        XCTAssertTrue(edits.isHidden(id: "abc", number: nil, name: "Renamed Elsewhere"))
        XCTAssertTrue(edits.isHidden(id: "other-server", number: "9.1", name: "KQED"))
        XCTAssertTrue(edits.isHidden(id: "x", number: nil, name: "Al Jazeera English"))
        XCTAssertFalse(edits.isHidden(id: "x", number: "9.2", name: "KQED"))
        XCTAssertFalse(edits.isHidden(id: "x", number: "12", name: "Al Jazeera English"))
        XCTAssertFalse(edits.isHidden(id: "x", number: nil, name: "KQED"))
    }

    func testRenamesByTheSameMatch() throws {
        let edits = ShelfChannelEdits.load(from: try write("""
        {"hidden":[],"renames":[{"id":"abc","number":"9.1","name":"KQED","displayName":"PBS"}]}
        """))
        XCTAssertEqual(edits.displayName(id: "abc", number: nil, name: "KQED"), "PBS")
        XCTAssertEqual(edits.displayName(id: "x", number: "9.1 ", name: "KQED"), "PBS")
        XCTAssertNil(edits.displayName(id: "x", number: nil, name: "KQED"))
    }
}
