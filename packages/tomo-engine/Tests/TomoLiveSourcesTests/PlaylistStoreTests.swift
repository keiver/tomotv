import XCTest

@testable import TomoLiveSources

final class PlaylistStoreTests: XCTestCase {
    private func entry(_ name: String, _ groups: [String]) -> M3uEntry {
        M3uEntry(name: name, url: "http://s/\(name)", line: "http://s/\(name)", hasExtInf: true, groups: groups)
    }

    func testGroupsInOrderOfFirstAppearanceWithCounts() {
        let store = PlaylistStore()
        for entry in [entry("a", ["Z", "A"]), entry("b", ["A"]), entry("c", []), entry("d", ["Z"])] { store.add(entry) }
        XCTAssertEqual(store.groups, [PlaylistGroup(name: "Z", count: 2), PlaylistGroup(name: "A", count: 2)])
        XCTAssertEqual(store.count, 4)
    }

    func testPagesEntriesInFileOrderHeldToAGroup() {
        let store = PlaylistStore()
        for index in 0 ..< 10 { store.add(entry("e\(index)", index.isMultiple(of: 2) ? ["Even"] : ["Odd"])) }
        XCTAssertEqual(store.entries(group: "Even", offset: 0, limit: 3).map(\.name), ["e0", "e2", "e4"])
        XCTAssertEqual(store.entries(group: "Even", offset: 3, limit: 3).map(\.name), ["e6", "e8"])
        XCTAssertEqual(store.entries(group: "Even", offset: 5, limit: 3), [])
        XCTAssertEqual(store.entries(group: "Missing", offset: 0, limit: 3), [])
        XCTAssertEqual(store.entries(group: nil, offset: 8, limit: 5).map(\.name), ["e8", "e9"])
        XCTAssertEqual(store.entries(group: nil, offset: -1, limit: 5), [])
        XCTAssertEqual(store.entries(group: nil, offset: 0, limit: 0), [])
    }

    func testKeepsTheHeader() {
        let store = PlaylistStore()
        store.set(M3uHeader(tvgUrls: ["http://g/x.xml"]))
        XCTAssertEqual(store.playlistHeader.tvgUrls, ["http://g/x.xml"])
    }

    func testConcurrentAddsAndQueries() {
        let store = PlaylistStore()
        DispatchQueue.concurrentPerform(iterations: 8) { worker in
            for index in 0 ..< 500 {
                if worker.isMultiple(of: 2) {
                    store.add(entry("w\(worker)-\(index)", ["g\(worker % 4)"]))
                } else {
                    _ = store.groups.count + store.entries(group: "g0", offset: 0, limit: 50).count + store.count
                }
            }
        }
        XCTAssertEqual(store.count, 2000)
        XCTAssertEqual(store.groups.map(\.count).reduce(0, +), 2000)
    }
}
