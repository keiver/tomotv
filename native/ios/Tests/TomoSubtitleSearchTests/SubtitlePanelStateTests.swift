import XCTest

@testable import TomoSubtitleSearch

final class SubtitlePanelStateTests: XCTestCase {
    private func result(_ id: String, applied: Bool = false) -> [String: Any] {
        ["id": id, "name": "Rel \(id)", "meta": "Podnapisi", "badges": ["SDH"], "monogram": "P", "hashMatch": false, "applying": false, "applied": applied]
    }

    private func dictionary(results: [[String: Any]], selected: String = "en") -> [String: Any] {
        [
            "title": "Subtitles",
            "query": "Some Film",
            "queryPlaceholder": "Title",
            "searchLabel": "Search",
            "languages": [["code": "en", "name": "English"], ["code": "es", "name": "Español"]],
            "selectedLanguage": selected,
            "stateLine": "2 results",
            "note": "",
            "busy": false,
            "results": results,
        ]
    }

    func testDecodesTheDictionaryJavaScriptSends() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(results: [result("a"), result("b")], selected: "es")))
        XCTAssertEqual(state.title, "Subtitles")
        XCTAssertEqual(state.languages.map(\.code), ["en", "es"])
        XCTAssertEqual(state.selectedLanguageIndex, 1)
        XCTAssertEqual(state.results.map(\.id), ["a", "b"])
        XCTAssertEqual(state.results[0].badges, ["SDH"])
    }

    func testTheCurrentSubtitleIsOptionalAndDecodesWhenSent() throws {
        let without = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(results: [])))
        XCTAssertNil(without.current)
        var with = dictionary(results: [])
        with["current"] = ["name": "Rel a", "meta": "Podnapisi", "monogram": "P", "offsetLabel": "1.5 s late", "earlierLabel": "Back 0.5 s", "laterLabel": "Forward 0.5 s", "resetLabel": "Reset"]
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: with))
        XCTAssertEqual(state.current?.name, "Rel a")
        XCTAssertEqual(state.current?.monogram, "P")
        XCTAssertEqual(state.current?.offsetLabel, "1.5 s late")
    }

    func testAMissingFieldDecodesToNothing() {
        var broken = dictionary(results: [])
        broken.removeValue(forKey: "stateLine")
        XCTAssertNil(SubtitlePanelState.from(dictionary: broken))
    }

    func testAnUnknownSelectedLanguageFallsToTheFirstChip() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(results: [], selected: "zz")))
        XCTAssertEqual(state.selectedLanguageIndex, 0)
    }

    func testOnlyTheChangedRowsAreReported() throws {
        let before = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(results: [result("a"), result("b")])))
        let after = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(results: [result("a"), result("b", applied: true)])))
        XCTAssertEqual(after.changedResultRows(from: before), [1])
        XCTAssertEqual(before.changedResultRows(from: before), [])
        let grown = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(results: [result("a")])))
        XCTAssertNil(grown.changedResultRows(from: before))
    }
}
