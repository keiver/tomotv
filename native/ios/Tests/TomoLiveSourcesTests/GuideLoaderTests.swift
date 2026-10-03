import XCTest

@testable import TomoLiveSources

/// Serves canned responses in chunks; `hold` leaves the response open until the task is cancelled.
final class StubProtocol: URLProtocol {
    struct Reply {
        var status = 200
        var chunks: [[UInt8]] = []
        var failure: URLError?
        var hold = false
    }

    private static let lock = NSLock()
    private static var replies: [String: Reply] = [:]
    private static var requests: [URLRequest] = []
    private static var stopped = 0

    static func reset(_ table: [String: Reply]) {
        lock.lock()
        replies = table
        requests = []
        stopped = 0
        lock.unlock()
    }

    static var seen: [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    static var stops: Int { lock.lock(); defer { lock.unlock() }; return stopped }

    override class func canInit(with _: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let reply = Self.replies[request.url?.path ?? ""] ?? Reply(status: 500)
        Self.requests.append(request)
        Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in reply.chunks { client?.urlProtocol(self, didLoad: Data(chunk)) }
        if reply.hold { return }
        if let failure = reply.failure {
            client?.urlProtocol(self, didFailWithError: failure)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {
        Self.lock.lock()
        Self.stopped += 1
        Self.lock.unlock()
    }
}

final class GuideLoaderTests: XCTestCase {
    private let document = Array("""
    <?xml version="1.0" encoding="UTF-8"?><tv><channel id="a.us"><display-name>A</display-name></channel>\
    <programme start="20260925010000 +0000" stop="20260925020000 +0000" channel="a.us"><title>One</title></programme>\
    <programme start="20260925020000 +0000" stop="20260925030000 +0000" channel="a.us"><title>Two</title></programme></tv>
    """.utf8)

    private func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return configuration
    }

    /// Runs a load and waits for completion, failing if it arrives more than once.
    private func load(_ url: String, headers: [String: String] = [:], store: GuideStore = GuideStore(),
                      whileRunning: ((GuideLoader) -> Void)? = nil) -> Result<GuideStats, Error> {
        let done = expectation(description: "completion")
        done.assertForOverFulfill = true
        var result: Result<GuideStats, Error>?
        let loader = GuideLoader.load(url: URL(string: url)!, window: nil, headers: headers, store: store, configuration: configuration()) {
            result = $0
            done.fulfill()
        }
        whileRunning?(loader)
        wait(for: [done], timeout: 10)
        // A second completion would land here and trip assertForOverFulfill.
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        return result!
    }

    private func chunked(_ bytes: [UInt8], _ size: Int) -> [[UInt8]] {
        stride(from: 0, to: bytes.count, by: size).map { Array(bytes[$0 ..< min($0 + size, bytes.count)]) }
    }

    func testStreamsAChunkedGzipResponse() throws {
        let gz = Fixture.gzip(document)
        StubProtocol.reset(["/guide.xml.gz": .init(chunks: chunked(gz, 17))])
        let store = GuideStore()
        let stats = try load("http://stub/guide.xml.gz", store: store).get()
        XCTAssertEqual(stats.channels, 1)
        XCTAssertEqual(stats.programmes, 2)
        XCTAssertEqual(stats.errors, 0)
        XCTAssertEqual(stats.load.networkBytes, gz.count)
        XCTAssertEqual(stats.load.inflatedBytes, document.count)
        XCTAssertEqual(Fixture.programmes(store).map(\.title), ["One", "Two"])
    }

    func testSendsHeaders() throws {
        StubProtocol.reset(["/g.xml": .init(chunks: [document])])
        _ = try load("http://stub/g.xml", headers: ["User-Agent": "TomoTest/1", "X-Token": "t"]).get()
        let request = try XCTUnwrap(StubProtocol.seen.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "TomoTest/1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Token"), "t")
    }

    func testFailsOnHttpError() {
        StubProtocol.reset(["/missing.xml": .init(status: 404, chunks: [Array("not found".utf8)])])
        guard case let .failure(error) = load("http://stub/missing.xml"), case let GuideLoadError.http(code) = error else {
            return XCTFail("expected an HTTP failure")
        }
        XCTAssertEqual(code, 404)
    }

    func testFailsWhenTheConnectionDropsMidStream() {
        let gz = Fixture.gzip(document)
        StubProtocol.reset(["/cut.xml.gz": .init(chunks: [Array(gz[..<(gz.count / 2)])], failure: URLError(.networkConnectionLost))])
        guard case let .failure(error) = load("http://stub/cut.xml.gz") else { return XCTFail("expected failure") }
        XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost)
    }

    func testFailsOnATruncatedGzipBody() {
        let gz = Fixture.gzip(document)
        StubProtocol.reset(["/short.xml.gz": .init(chunks: [Array(gz[..<(gz.count - 10)])])])
        guard case let .failure(error) = load("http://stub/short.xml.gz"), case let GuideLoadError.decode(inner) = error else {
            return XCTFail("expected a decode failure")
        }
        XCTAssertEqual(inner as? Gunzip.Failure, .truncated)
    }

    func testADecodeFailureStopsTheDownload() {
        // Reserved gzip header flags fail the first inflate; the response then stays open until the task is cancelled.
        // URLSession hands a held body over only once it is large, hence the padding.
        var gz = Fixture.gzip(document)
        gz[3] = 0xE0
        StubProtocol.reset(["/bad.xml.gz": .init(chunks: [gz + [UInt8](repeating: 0, count: 1 << 20)], hold: true)])
        guard case let .failure(error) = load("http://stub/bad.xml.gz"), case GuideLoadError.decode = error else {
            return XCTFail("expected a decode failure")
        }
        XCTAssertEqual(StubProtocol.stops, 1)
    }

    func testCancelCompletesOnceWithCancellation() {
        StubProtocol.reset(["/slow.xml": .init(chunks: [Array(document[..<40])], hold: true)])
        let result = load("http://stub/slow.xml") { loader in
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { loader.cancel() }
        }
        guard case let .failure(error) = result else { return XCTFail("expected failure") }
        XCTAssertEqual((error as? URLError)?.code, .cancelled)
        XCTAssertEqual(StubProtocol.stops, 1)
    }

    func testReadsAFileUrl() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("guide-\(UUID().uuidString).xml.gz")
        try Data(Fixture.gzip(document)).write(to: file)
        addTeardownBlock { try? FileManager.default.removeItem(at: file) }
        let done = expectation(description: "completion")
        var result: Result<GuideStats, Error>?
        let loader = GuideLoader.load(url: file, window: nil, store: GuideStore()) {
            result = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 10)
        _ = loader
        XCTAssertEqual(try result?.get().programmes, 2)
    }

    func testReportsFootprint() throws {
        StubProtocol.reset(["/g.xml": .init(chunks: [document])])
        let stats = try load("http://stub/g.xml").get()
        XCTAssertGreaterThan(stats.load.footprintBeforeBytes, 0)
        XCTAssertGreaterThanOrEqual(stats.load.peakFootprintBytes, stats.load.footprintBeforeBytes)
        XCTAssertGreaterThan(stats.load.footprintAfterBytes, 0)
        XCTAssertGreaterThan(MemoryFootprint.bytes(), 0)
    }
}
