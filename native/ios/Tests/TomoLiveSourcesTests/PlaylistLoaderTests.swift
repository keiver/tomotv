import XCTest

@testable import TomoLiveSources

final class PlaylistLoaderTests: XCTestCase {
    private let playlist = Array("""
    #EXTM3U
    #EXTINF:-1 tvg-id="a" group-title="News",A
    http://s/a
    #EXTINF:-1 tvg-id="b" group-title="News;Kids",B
    http://s/b

    """.utf8)

    private func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return configuration
    }

    private func load(_ url: String, headers: [String: String] = [:], store: PlaylistStore = PlaylistStore(),
                      whileRunning: ((PlaylistLoader) -> Void)? = nil) -> Result<PlaylistStats, Error> {
        let done = expectation(description: "completion")
        done.assertForOverFulfill = true
        var result: Result<PlaylistStats, Error>?
        let loader = PlaylistLoader.load(url: URL(string: url)!, headers: headers, store: store, configuration: configuration()) {
            result = $0
            done.fulfill()
        }
        whileRunning?(loader)
        wait(for: [done], timeout: 10)
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        return result!
    }

    func testStreamsAChunkedGzipPlaylist() throws {
        let gz = Fixture.gzip(playlist)
        StubProtocol.reset(["/p.m3u.gz": .init(chunks: stride(from: 0, to: gz.count, by: 11).map { Array(gz[$0 ..< min($0 + 11, gz.count)]) })])
        let store = PlaylistStore()
        let stats = try load("http://stub/p.m3u.gz", store: store).get()
        XCTAssertEqual(stats.entries, 2)
        XCTAssertEqual(stats.groups, 2)
        XCTAssertEqual(stats.load.inflatedBytes, playlist.count)
        XCTAssertEqual(store.groups, [PlaylistGroup(name: "News", count: 2), PlaylistGroup(name: "Kids", count: 1)])
    }

    func testStreamsPlainTextAndSendsTheUserAgent() throws {
        StubProtocol.reset(["/p.m3u": .init(chunks: [playlist])])
        let stats = try load("http://stub/p.m3u", headers: ["User-Agent": "Tuner/1"]).get()
        XCTAssertEqual(stats.entries, 2)
        XCTAssertEqual(StubProtocol.seen.first?.value(forHTTPHeaderField: "User-Agent"), "Tuner/1")
    }

    func testFailsOnHttpError() {
        StubProtocol.reset(["/missing.m3u": .init(status: 403, chunks: [])])
        guard case let .failure(error) = load("http://stub/missing.m3u"), case let SourceLoadError.http(code) = error else {
            return XCTFail("expected an HTTP failure")
        }
        XCTAssertEqual(code, 403)
    }

    func testCancelCompletesOnceWithCancellation() {
        StubProtocol.reset(["/slow.m3u": .init(chunks: [Array(playlist[..<20])], hold: true)])
        let result = load("http://stub/slow.m3u") { loader in
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { loader.cancel() }
        }
        guard case let .failure(error) = result else { return XCTFail("expected failure") }
        XCTAssertEqual((error as? URLError)?.code, .cancelled)
        XCTAssertEqual(StubProtocol.stops, 1)
    }

    func testParsesDataInMemory() throws {
        let store = PlaylistStore()
        let stats = try PlaylistLoader.parse(data: Data(playlist), store: store)
        XCTAssertEqual(stats.entries, 2)
        XCTAssertEqual(stats.load.networkBytes, playlist.count)
        XCTAssertEqual(store.entries(group: "Kids", offset: 0, limit: 10).map(\.name), ["B"])
    }
}
