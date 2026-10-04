import XCTest

@testable import TomoLiveSources

final class GuideSearchTests: XCTestCase {
    private func programme(_ channel: String, _ start: Int64, title: String, subTitle: String? = nil, desc: String? = nil) -> GuideProgramme {
        GuideProgramme(channel: channel, start: start, stop: start + 10, title: title, subTitle: subTitle, desc: desc)
    }

    private func store() -> GuideStore {
        let store = GuideStore()
        store.add(programme("tbs", 30, title: "MLB Baseball", subTitle: "Yankees at Rays", desc: "The New York Yankees visit the Tampa Bay Rays."))
        store.add(programme("tbs", 10, title: "Pregame", desc: "Yankees and Rays warm up."))
        store.add(programme("espn", 20, title: "Fútbol", desc: "Real Madrid y Atlético."))
        store.add(programme("espn", 40, title: "News"))
        return store
    }

    func testFindsEveryWordInTitleSubTitleOrDescriptionEarliestFirst() {
        let hits = store().search(channelIds: ["tbs", "espn"], window: Fixture.everything, query: " YANKEES rays ", limit: 10)
        XCTAssertEqual(hits.map(\.start), [10, 30])
        XCTAssertEqual(store().search(channelIds: ["tbs"], window: Fixture.everything, query: "tampa bay", limit: 10).map(\.title), ["MLB Baseball"])
    }

    func testFoldsCaseAndAccents() {
        XCTAssertEqual(store().search(channelIds: ["espn"], window: Fixture.everything, query: "atletico futbol", limit: 10).map(\.title), ["Fútbol"])
        XCTAssertEqual(GuideSearch.fold(" Atlético "), "atletico")
    }

    func testKeepsToTheChannelsTheWindowAndTheLimit() {
        let search = store()
        XCTAssertTrue(search.search(channelIds: ["espn"], window: Fixture.everything, query: "yankees", limit: 10).isEmpty)
        XCTAssertEqual(search.search(channelIds: ["tbs"], window: GuideWindow(from: 25, to: 35), query: "yankees", limit: 10).map(\.start), [30])
        XCTAssertEqual(search.search(channelIds: ["tbs"], window: Fixture.everything, query: "yankees", limit: 1).map(\.start), [10])
    }

    func testKeepsATitlesEarliestAiringPerChannel() {
        let store = GuideStore()
        for start: Int64 in [50, 10, 30] { store.add(programme("trek", start, title: "Star Trek", desc: "Episode \(start)")) }
        store.add(programme("trek", 20, title: "STAR TREK: Voyager"))
        store.add(programme("scifi", 40, title: "Star Trek"))
        let hits = store.search(channelIds: ["trek", "scifi"], window: Fixture.everything, query: "star trek", limit: 10)
        XCTAssertEqual(hits.map { "\($0.channel)@\($0.start)" }, ["trek@10", "trek@20", "scifi@40"])
    }

    func testABlankQueryOrAWordNowhereFindsNothing() {
        XCTAssertTrue(store().search(channelIds: ["tbs", "espn"], window: Fixture.everything, query: "   ", limit: 10).isEmpty)
        XCTAssertTrue(store().search(channelIds: ["tbs", "espn"], window: Fixture.everything, query: "yankees mets", limit: 10).isEmpty)
    }
}
