import XCTest

@testable import TomoSubtitleSearch

final class SubtitlePanelStateTests: XCTestCase {
    private func result(_ id: String, applied: Bool = false) -> [String: Any] {
        ["id": id, "name": "Rel \(id)", "meta": "Podnapisi", "byline": "Podnapisi", "badges": ["SDH"], "monogram": "P", "hashMatch": false, "applying": false, "applied": applied]
    }

    private func job(_ id: String = "v1", results: [[String: Any]] = []) -> [String: Any] {
        ["id": id, "query": "Some Film", "stateLine": "2 results", "note": "", "busy": false, "results": results]
    }

    private func dictionary(job: [String: Any], selected: String = "en") -> [String: Any] {
        [
            "title": "Subtitles",
            "credit": "Subtitles provided by OpenSubtitles.com",
            "accent": "#4F99FF",
            "languages": [["code": "en", "name": "English"], ["code": "es", "name": "Español"]],
            "selectedLanguage": selected,
            "queryPlaceholder": "Title",
            "searchLabel": "Search",
            "closeLabel": "Close",
            "blurBehind": false,
            "job": job,
        ]
    }

    func testDecodesTheDictionaryJavaScriptSends() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(job: job("v1", results: [result("a"), result("b")]), selected: "es")))
        XCTAssertEqual(state.title, "Subtitles")
        XCTAssertEqual(state.credit, "Subtitles provided by OpenSubtitles.com")
        XCTAssertEqual(state.closeLabel, "Close")
        XCTAssertFalse(state.blurBehind)
        XCTAssertEqual(state.languages.map(\.code), ["en", "es"])
        XCTAssertEqual(state.selectedLanguageIndex, 1)
        XCTAssertEqual(state.job.id, "v1")
        XCTAssertEqual(state.job.results.map(\.id), ["a", "b"])
        XCTAssertEqual(state.job.results[0].badges, ["SDH"])
        XCTAssertNil(state.job.results[0].downloads)
        XCTAssertNil(state.job.results[0].rating)
    }

    func testAResultsDownloadsRatingAndBylineDecodeWhenSent() throws {
        var rated = result("r")
        rated["downloads"] = 42786
        rated["rating"] = 9.5
        rated["byline"] = "devnul13"
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(job: job("v1", results: [rated]))))
        XCTAssertEqual(state.job.results[0].downloads, 42786)
        XCTAssertEqual(state.job.results[0].rating, 9.5)
        XCTAssertEqual(state.job.results[0].byline, "devnul13")
    }

    func testTheKeptPicksTimingAndTheDownloadAlertDecodeWhenSent() throws {
        var kept = result("k", applied: true)
        kept["timing"] = [
            "id": 100_000, "offsetLabel": "1.5 s late", "earlierLabel": "Back 0.5 s", "laterLabel": "Forward 0.5 s", "earlierTitle": "−0.5 s", "laterTitle": "+0.5 s",
            "resetLabel": "Reset", "syncLabel": "Sync to audio", "canSync": true, "syncing": false, "note": "",
        ]
        var with = dictionary(job: job("v1", results: [result("a"), kept]))
        with["confirm"] = ["title": "Download this subtitle?", "remaining": "4 free downloads left today", "download": "Download", "cancel": "Cancel"]
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: with))
        XCTAssertEqual(state.confirm?.remaining, "4 free downloads left today")
        XCTAssertNil(try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(job: job()))).confirm)
        XCTAssertNil(state.job.results[0].timing)
        let timing = try XCTUnwrap(state.job.results[1].timing)
        XCTAssertEqual(timing.id, 100_000)
        XCTAssertEqual(timing.offsetLabel, "1.5 s late")
        XCTAssertEqual(timing.earlierTitle, "−0.5 s")
    }

    func testTheThemeColourReadsFromHexAndAnythingElseIsNil() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(job: job())))
        let rgb = try XCTUnwrap(state.accentComponents)
        XCTAssertEqual(rgb.red, 0x4F / 255, accuracy: 0.0001)
        XCTAssertEqual(rgb.green, 0x99 / 255, accuracy: 0.0001)
        XCTAssertEqual(rgb.blue, 1, accuracy: 0.0001)
        var bad = dictionary(job: job())
        bad["accent"] = "gold"
        XCTAssertNil(try XCTUnwrap(SubtitlePanelState.from(dictionary: bad)).accentComponents)
    }

    func testAMissingFieldDecodesToNothing() {
        var broken = dictionary(job: job())
        broken.removeValue(forKey: "searchLabel")
        XCTAssertNil(SubtitlePanelState.from(dictionary: broken))
    }

    func testAnUnknownSelectedLanguageFallsToTheFirstChip() throws {
        let state = try XCTUnwrap(SubtitlePanelState.from(dictionary: dictionary(job: job(), selected: "zz")))
        XCTAssertEqual(state.selectedLanguageIndex, 0)
    }
}
