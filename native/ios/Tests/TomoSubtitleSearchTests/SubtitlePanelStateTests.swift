import XCTest

@testable import TomoSubtitleSearch

final class SubtitlePanelStateTests: XCTestCase {
    private func result(_ id: String, applied: Bool = false) -> [String: Any] {
        ["id": id, "name": "Rel \(id)", "meta": "Podnapisi", "byline": "Podnapisi", "badges": ["SDH"], "monogram": "P", "hashMatch": false, "applying": false, "applied": applied]
    }

    private func job(_ id: String, results: [[String: Any]], heading: String = "") -> [String: Any] {
        ["id": id, "label": "", "heading": heading, "query": "Some Film", "stateLine": "2 results", "note": "", "busy": false, "results": results]
    }

    private func dictionary(jobs: [[String: Any]], selected: String = "en") -> [String: Any] {
        [
            "title": "Subtitles",
            "credit": "Subtitles provided by OpenSubtitles.com",
            "accent": "#4F99FF",
            "languages": [["code": "en", "name": "English"], ["code": "es", "name": "Español"]],
            "selectedLanguage": selected,
            "skippedLine": "",
            "emptyLine": "",
            "queryPlaceholder": "Title",
            "searchLabel": "Search",
            "closeLabel": "Close",
            "jobs": jobs,
        ]
    }

    func testDecodesTheDictionaryJavaScriptSends() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(jobs: [job("v1", results: [result("a"), result("b")])], selected: "es")))
        XCTAssertEqual(state.title, "Subtitles")
        XCTAssertEqual(state.credit, "Subtitles provided by OpenSubtitles.com")
        XCTAssertEqual(state.closeLabel, "Close")
        XCTAssertEqual(state.languages.map(\.code), ["en", "es"])
        XCTAssertEqual(state.selectedLanguageIndex, 1)
        XCTAssertNil(state.takeAll)
        XCTAssertEqual(state.jobs.map(\.id), ["v1"])
        XCTAssertEqual(state.jobs[0].results.map(\.id), ["a", "b"])
        XCTAssertEqual(state.jobs[0].results[0].badges, ["SDH"])
        XCTAssertNil(state.jobs[0].results[0].downloads)
        XCTAssertNil(state.jobs[0].results[0].rating)
    }

    func testAResultsDownloadsRatingAndBylineDecodeWhenSent() throws {
        var rated = result("r")
        rated["downloads"] = 42786
        rated["rating"] = 9.5
        rated["byline"] = "devnul13"
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(jobs: [job("v1", results: [rated])])))
        XCTAssertEqual(state.jobs[0].results[0].downloads, 42786)
        XCTAssertEqual(state.jobs[0].results[0].rating, 9.5)
        XCTAssertEqual(state.jobs[0].results[0].byline, "devnul13")
    }

    func testTheKeptPicksTimingAndTheTakeAllButtonDecodeWhenSent() throws {
        var kept = result("k", applied: true)
        kept["timing"] = [
            "id": 100_000, "offsetLabel": "1.5 s late", "earlierLabel": "Back 0.5 s", "laterLabel": "Forward 0.5 s", "earlierTitle": "−0.5 s", "laterTitle": "+0.5 s",
            "resetLabel": "Reset", "syncLabel": "Sync to audio", "canSync": true, "syncing": false, "note": "",
        ]
        var with = dictionary(jobs: [job("v1", results: [result("a"), kept])])
        with["takeAll"] = ["label": "Take 3 matches", "busy": false]
        with["confirm"] = ["title": "Download this subtitle?", "remaining": "4 free downloads left today", "download": "Download", "cancel": "Cancel"]
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: with))
        XCTAssertEqual(state.confirm?.remaining, "4 free downloads left today")
        XCTAssertNil(try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(jobs: []))).confirm)
        XCTAssertNil(state.jobs[0].results[0].timing)
        let timing = try XCTUnwrap(state.jobs[0].results[1].timing)
        XCTAssertEqual(timing.id, 100_000)
        XCTAssertEqual(timing.offsetLabel, "1.5 s late")
        XCTAssertEqual(timing.earlierTitle, "−0.5 s")
        XCTAssertEqual(state.takeAll?.label, "Take 3 matches")
    }

    func testTheThemeColourReadsFromHexAndAnythingElseIsNil() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(jobs: [])))
        let rgb = try XCTUnwrap(state.accentComponents)
        XCTAssertEqual(rgb.red, 0x4F / 255, accuracy: 0.0001)
        XCTAssertEqual(rgb.green, 0x99 / 255, accuracy: 0.0001)
        XCTAssertEqual(rgb.blue, 1, accuracy: 0.0001)
        var bad = dictionary(jobs: [])
        bad["accent"] = "gold"
        XCTAssertNil(try XCTUnwrap(SubtitlePanelState.from(dictionary: bad)).accentComponents)
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
