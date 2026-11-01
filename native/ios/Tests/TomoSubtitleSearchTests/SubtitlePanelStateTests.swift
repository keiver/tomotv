import XCTest

@testable import TomoSubtitleSearch

final class SubtitlePanelStateTests: XCTestCase {
    private func result(_ id: String, applied: Bool = false) -> [String: Any] {
        ["id": id, "name": "Rel \(id)", "meta": "Podnapisi", "badges": ["SDH"], "monogram": "P", "hashMatch": false, "applying": false, "applied": applied]
    }

    private func job(_ id: String, results: [[String: Any]], heading: String = "") -> [String: Any] {
        ["id": id, "label": "", "heading": heading, "query": "Some Film", "stateLine": "2 results", "note": "", "busy": false, "results": results]
    }

    private func dictionary(jobs: [[String: Any]], selected: String = "en") -> [String: Any] {
        [
            "title": "Subtitles",
            "tracks": [],
            "languages": [["code": "en", "name": "English"], ["code": "es", "name": "Español"]],
            "selectedLanguage": selected,
            "skippedLine": "",
            "emptyLine": "",
            "queryPlaceholder": "Title",
            "searchLabel": "Search",
            "jobs": jobs,
        ]
    }

    func testDecodesTheDictionaryJavaScriptSends() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(jobs: [job("v1", results: [result("a"), result("b")])], selected: "es")))
        XCTAssertEqual(state.title, "Subtitles")
        XCTAssertEqual(state.languages.map(\.code), ["en", "es"])
        XCTAssertEqual(state.selectedLanguageIndex, 1)
        XCTAssertNil(state.takeAll)
        XCTAssertEqual(state.jobs.map(\.id), ["v1"])
        XCTAssertEqual(state.jobs[0].results.map(\.id), ["a", "b"])
        XCTAssertEqual(state.jobs[0].results[0].badges, ["SDH"])
    }

    func testTracksAndTheTakeAllButtonDecodeWhenSent() throws {
        var with = dictionary(jobs: [])
        with["tracks"] = [
            [
                "id": 100_000, "name": "Kept", "meta": "Podnapisi · English", "monogram": "P", "offsetLabel": "1.5 s late", "earlierLabel": "Back 0.5 s",
                "laterLabel": "Forward 0.5 s", "resetLabel": "Reset", "syncLabel": "Match the audio", "replaceLabel": "Replace", "canSync": true, "canReplace": true,
                "replacing": true, "syncing": false, "note": "",
            ]
        ]
        with["takeAll"] = ["label": "Take 3 matches", "busy": false]
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: with))
        XCTAssertEqual(state.tracks.map(\.id), [100_000])
        XCTAssertEqual(state.tracks[0].offsetLabel, "1.5 s late")
        XCTAssertTrue(state.tracks[0].replacing)
        XCTAssertEqual(state.takeAll?.label, "Take 3 matches")
    }

    func testAMissingFieldDecodesToNothing() {
        var broken = dictionary(jobs: [])
        broken.removeValue(forKey: "searchLabel")
        XCTAssertNil(SubtitlePanelState.from(dictionary: broken))
    }

    func testAnUnknownSelectedLanguageFallsToTheFirstChip() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(jobs: [], selected: "zz")))
        XCTAssertEqual(state.selectedLanguageIndex, 0)
    }
}
