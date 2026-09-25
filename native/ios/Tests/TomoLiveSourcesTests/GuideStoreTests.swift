import XCTest

@testable import TomoLiveSources

final class GuideStoreTests: XCTestCase {
    private func programme(_ channel: String, _ start: Int64, _ stop: Int64?) -> GuideProgramme {
        GuideProgramme(channel: channel, start: start, stop: stop, title: "\(channel)@\(start)")
    }

    func testOrdersEachChannelByStartInRequestedChannelOrder() {
        let store = GuideStore()
        for start: Int64 in [30, 10, 20] { store.add(programme("a", start, start + 10)) }
        store.add(programme("b", 5, 15))
        let result = store.programmes(channelIds: ["b", "a", "missing"], window: Fixture.everything)
        XCTAssertEqual(result.map(\.title), ["b@5", "a@10", "a@20", "a@30"])
        XCTAssertEqual(store.programmeCount, 4)
    }

    func testResortsAfterLateAdds() {
        let store = GuideStore()
        store.add(programme("a", 20, 30))
        _ = store.programmes(channelIds: ["a"], window: Fixture.everything)
        store.add(programme("a", 10, 20))
        XCTAssertEqual(store.programmes(channelIds: ["a"], window: Fixture.everything).map(\.start), [10, 20])
    }

    func testWindowOverlapIsInclusiveAndHandlesMissingStop() {
        let store = GuideStore()
        store.add(programme("a", 0, 10))
        store.add(programme("a", 10, 20))
        store.add(programme("a", 20, 30))
        store.add(programme("a", 25, nil))
        store.add(programme("a", 40, 50))
        let result = store.programmes(channelIds: ["a"], window: GuideWindow(from: 20, to: 25))
        XCTAssertEqual(result.map(\.start), [10, 20, 25])
    }

    func testKeepsChannelsInFileOrder() {
        let store = GuideStore()
        for id in ["z", "a", "m"] { store.add(GuideChannel(id: id)) }
        XCTAssertEqual(store.channels.map(\.id), ["z", "a", "m"])
    }

    func testConcurrentAddsAndQueries() {
        let store = GuideStore()
        DispatchQueue.concurrentPerform(iterations: 8) { worker in
            for index in 0 ..< 500 {
                if worker.isMultiple(of: 2) {
                    store.add(programme("c\(worker % 4)", Int64(500 - index), nil))
                    store.add(GuideChannel(id: "c\(worker)-\(index)"))
                } else {
                    let got = store.programmes(channelIds: ["c0", "c2"], window: Fixture.everything)
                    _ = store.channels.count + store.programmeCount + got.count
                }
            }
        }
        XCTAssertEqual(store.programmeCount, 2000)
        XCTAssertEqual(store.channels.count, 2000)
        let starts = store.programmes(channelIds: ["c0"], window: Fixture.everything).map(\.start)
        XCTAssertEqual(starts, starts.sorted())
    }
}
