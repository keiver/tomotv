import Darwin
import XCTest

@testable import TomoEngine

/// A loopback origin that answers each request however the test scripts it, and records what it was asked.
private final class ScriptedOrigin {
    enum Reply {
        case respond(Int, headers: [String: String] = [:], body: String = "")
        /// Headers promising a large body, then nothing more until the client leaves.
        case headersThenStall(Int, headers: [String: String] = [:], bodyPrefix: Int = 0)
        /// Reads the request and never answers.
        case silent
    }

    struct Request {
        let path: String
        let headers: [String: String]
    }

    private let listener: Int32
    let port: UInt16
    private let script: (Request) -> Reply
    private let lock = NSLock()
    private var recorded: [Request] = []
    private var held: [Int32] = []
    private var stopped = false

    init(_ script: @escaping (Request) -> Reply) throws {
        self.script = script
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard bound == 0, Darwin.listen(fd, 32) == 0 else { throw XCTSkip("loopback listener unavailable") }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.getsockname(fd, $0, &length) } }
        listener = fd
        port = UInt16(bigEndian: address.sin_port)
        Thread.detachNewThread { [weak self] in self?.acceptLoop() }
    }

    var base: String { "http://127.0.0.1:\(port)" }

    var requests: [Request] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func stop() {
        lock.lock()
        stopped = true
        let open = held
        held = []
        lock.unlock()
        open.forEach { Darwin.close($0) }
        Darwin.shutdown(listener, SHUT_RDWR)
        Darwin.close(listener)
    }

    private func acceptLoop() {
        let fd = listener
        while true {
            let client = Darwin.accept(fd, nil, nil)
            if client < 0 { return }
            DispatchQueue.global().async { [weak self] in
                guard let self else {
                    Darwin.close(client)
                    return
                }
                self.serve(client)
            }
        }
    }

    private func serve(_ client: Int32) {
        var head = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        let terminator = Data("\r\n\r\n".utf8)
        while head.range(of: terminator) == nil {
            let count = Darwin.read(client, &buffer, buffer.count)
            if count <= 0 {
                Darwin.close(client)
                return
            }
            head.append(buffer, count: count)
        }
        let lines = String(decoding: head, as: UTF8.self).components(separatedBy: "\r\n")
        let path = lines.first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let request = Request(path: path, headers: headers)
        lock.lock()
        recorded.append(request)
        lock.unlock()

        switch script(request) {
        case .respond(let status, let extra, let body):
            var reply = "HTTP/1.1 \(status) Scripted\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n"
            extra.forEach { reply += "\($0.key): \($0.value)\r\n" }
            reply += "\r\n" + body
            send(client, reply)
            Darwin.close(client)
        case .headersThenStall(let status, let extra, let bodyPrefix):
            var reply = "HTTP/1.1 \(status) Scripted\r\nContent-Length: 104857600\r\n"
            extra.forEach { reply += "\($0.key): \($0.value)\r\n" }
            send(client, reply + "\r\n" + String(repeating: "G", count: bodyPrefix))
            hold(client)
        case .silent:
            hold(client)
        }
    }

    private func hold(_ client: Int32) {
        lock.lock()
        let closeNow = stopped
        if !closeNow { held.append(client) }
        lock.unlock()
        if closeNow { Darwin.close(client) }
    }

    private func send(_ client: Int32, _ text: String) {
        let bytes = Array(text.utf8)
        _ = bytes.withUnsafeBufferPointer { Darwin.write(client, $0.baseAddress, $0.count) }
    }
}

/// The probe's verdicts against scripted origins: refusals come only from the answers given, never from silence.
final class EndpointProbeTests: XCTestCase {
    private var origins: [ScriptedOrigin] = []

    override func tearDown() {
        origins.forEach { $0.stop() }
        origins = []
        super.tearDown()
    }

    private func origin(_ script: @escaping (ScriptedOrigin.Request) -> ScriptedOrigin.Reply) throws -> ScriptedOrigin {
        let origin = try ScriptedOrigin(script)
        origins.append(origin)
        return origin
    }

    /// Routes by path; anything unrouted answers 404.
    private func routes(_ table: [String: ScriptedOrigin.Reply]) throws -> ScriptedOrigin {
        try origin { request in table[request.path] ?? .respond(404) }
    }

    private static let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh.m3u8\n"

    private static func media(_ segment: String) -> String {
        "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:6,\nold.ts\n#EXTINF:6,\n\(segment)\n"
    }

    private static func playlist(_ body: String) -> ScriptedOrigin.Reply {
        .respond(200, headers: ["Content-Type": "application/vnd.apple.mpegurl"], body: body)
    }

    // MARK: - Status classification

    func testOnlyAPermanentClientErrorIsARefusal() {
        for code in [400, 401, 403, 404, 410, 451] { XCTAssertTrue(EndpointProbe.isRefusalStatus(code), "\(code)") }
        for code in [200, 206, 301, 408, 429, 500, 502, 503, 504] { XCTAssertFalse(EndpointProbe.isRefusalStatus(code), "\(code)") }
    }

    // MARK: - Multivariant masters

    func testEveryVariantRefusingItsNewestSegmentIsDead() throws {
        let origin = try routes([
            "/master.m3u8": Self.playlist(Self.master),
            "/low.m3u8": Self.playlist(Self.media("low9.ts")),
            "/high.m3u8": Self.playlist(Self.media("high9.ts")),
            "/low9.ts": .respond(403), "/high9.ts": .respond(403),
        ])
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5), "origin refused every variant (segment HTTP 403)")
        // Only each variant's newest segment is asked for, and only its first byte.
        let segmentRequests = origin.requests.filter { $0.path.hasSuffix(".ts") }
        XCTAssertEqual(Set(segmentRequests.map(\.path)), ["/low9.ts", "/high9.ts"])
        XCTAssertEqual(segmentRequests.count, 2)
        XCTAssertTrue(segmentRequests.allSatisfy { $0.headers["range"] == "bytes=0-0" }, "\(segmentRequests.map(\.headers))")
    }

    func testEveryVariantPlaylistRefusedIsDead() throws {
        let origin = try routes(["/master.m3u8": Self.playlist(Self.master)])
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5), "origin refused every variant (playlist HTTP 404)")
    }

    func testOneVariantServingKeepsTheOriginAlive() throws {
        let origin = try routes([
            "/master.m3u8": Self.playlist(Self.master),
            "/low.m3u8": Self.playlist(Self.media("low9.ts")),
            "/high.m3u8": Self.playlist(Self.media("high9.ts")),
            "/low9.ts": .respond(403), "/high9.ts": .respond(206, body: "x"),
        ])
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5))
    }

    func testOneSilentVariantMeansNoVerdict() throws {
        let origin = try routes([
            "/master.m3u8": Self.playlist(Self.master),
            "/low.m3u8": Self.playlist(Self.media("low9.ts")),
            "/high.m3u8": .silent,
            "/low9.ts": .respond(404),
        ])
        let started = Date()
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 1))
        XCTAssertLessThan(Date().timeIntervalSince(started), 4)
    }

    func testAServerErrorOrThrottleIsNoVerdict() throws {
        let origin = try routes([
            "/master.m3u8": Self.playlist(Self.master),
            "/low.m3u8": .respond(503),
            "/high.m3u8": Self.playlist(Self.media("high9.ts")),
            "/high9.ts": .respond(429),
        ])
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5))
    }

    func testVariantsResolveAgainstWhereARedirectLanded() throws {
        let origin = try routes([
            "/short.m3u8": .respond(302, headers: ["Location": "/cdn/live/master.m3u8"]),
            "/cdn/live/master.m3u8": Self.playlist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhd/index.m3u8\n"),
            "/cdn/live/hd/index.m3u8": Self.playlist(Self.media("../seg/42.ts")),
            "/cdn/live/seg/42.ts": .respond(410),
        ])
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("\(origin.base)/short.m3u8", headers: [:], timeout: 5), "origin refused every variant (segment HTTP 410)")
        XCTAssertEqual(origin.requests.map(\.path), ["/short.m3u8", "/cdn/live/master.m3u8", "/cdn/live/hd/index.m3u8", "/cdn/live/seg/42.ts"])
    }

    func testTheChannelHeadersReachEveryRequest() throws {
        let origin = try origin { request in
            guard request.headers["user-agent"] == "TunerAgent/1" else { return .respond(403) }
            switch request.path {
            case "/master.m3u8": return .respond(200, body: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n")
            case "/v.m3u8": return .respond(200, body: EndpointProbeTests.media("s.ts"))
            default: return .respond(206, body: "x")
            }
        }
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: ["User-Agent": "TunerAgent/1"], timeout: 5))
        XCTAssertEqual(origin.requests.map(\.path), ["/master.m3u8", "/v.m3u8", "/s.ts"])
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5), "origin refused the playlist (HTTP 403)")
    }

    // MARK: - Media playlists and other inputs

    func testARefusedPlaylistIsDead() throws {
        let origin = try routes([:])
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5), "origin refused the playlist (HTTP 404)")
    }

    func testAMediaPlaylistInputIsJudgedByItsNewestSegment() throws {
        let origin = try routes([
            "/dead.m3u8": Self.playlist(Self.media("gone.ts")),
            "/live.m3u8": Self.playlist(Self.media("here.ts")),
            "/here.ts": .respond(200, body: "x"),
            "/old.ts": .respond(200, body: "x"),
        ])
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("\(origin.base)/dead.m3u8", headers: [:], timeout: 5), "origin refused segment HTTP 404")
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/live.m3u8", headers: [:], timeout: 5))
    }

    func testAPlaylistListingNoSegmentYetIsNoVerdict() throws {
        let origin = try routes(["/empty.m3u8": Self.playlist("#EXTM3U\n#EXT-X-TARGETDURATION:6\n")])
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/empty.m3u8", headers: [:], timeout: 5))
    }

    func testANonHlsBodyIsNoVerdict() throws {
        let origin = try routes(["/Manifest.mpd": .respond(200, body: "<MPD type=\"dynamic\"></MPD>")])
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/Manifest.mpd", headers: [:], timeout: 5))
        XCTAssertEqual(origin.requests.count, 1)
    }

    func testAnUnparseableUrlIsNoVerdict() {
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("not a url with spaces", headers: [:], timeout: 1))
    }

    // MARK: - Transport

    /// URLSession hands over a response with its first body byte, not with the headers alone
    /// (measured here: 0.002s with one byte, the whole budget with none, typed or not).
    func testASegmentIsAnsweredFromItsFirstByteWithoutTheRestOfItsBody() throws {
        let origin = try routes([
            "/one-byte.ts": .headersThenStall(206, headers: ["Content-Type": "video/mp2t"], bodyPrefix: 1),
            "/600-bytes.ts": .headersThenStall(200, bodyPrefix: 600),
        ])
        for name in ["one-byte.ts", "600-bytes.ts"] {
            let started = Date()
            let answer = EndpointProbe.request(URL(string: "\(origin.base)/\(name)")!, keepBody: false, timeout: 5)
            guard case .status(_, _, let body) = answer else {
                XCTFail("\(name): the first byte did not answer the request, got \(answer)")
                continue
            }
            XCTAssertNil(body, name)
            XCTAssertLessThan(Date().timeIntervalSince(started), 1, name)
        }
    }

    func testHeadersWithNoBodyByteAreNoVerdictWithinTheBudget() throws {
        let origin = try routes(["/stalled.ts": .headersThenStall(200, headers: ["Content-Type": "video/mp2t"])])
        let started = Date()
        let answer = EndpointProbe.request(URL(string: "\(origin.base)/stalled.ts")!, keepBody: false, timeout: 1)
        guard case .unknown = answer else { return XCTFail("a stalled body read as \(answer)") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }

    func testAClosedPortIsRefused() throws {
        let closed = try ScriptedOrigin { _ in .respond(200) }
        let port = closed.port
        closed.stop()
        let answer = EndpointProbe.request(URL(string: "http://127.0.0.1:\(port)/x.m3u8")!, keepBody: false, timeout: 5)
        guard case .refused = answer else { return XCTFail("a closed port read as \(answer)") }
        XCTAssertEqual(EndpointProbe.hlsOriginRefusal("http://127.0.0.1:\(port)/x.m3u8", headers: [:], timeout: 5)?.hasPrefix("origin unreachable"), true)
    }

    func testAnUnresolvableHostIsRefused() {
        let answer = EndpointProbe.request(URL(string: "http://tomo-endpoint-probe.invalid/x.m3u8")!, keepBody: false, timeout: 5)
        guard case .refused = answer else { return XCTFail("an unresolvable host read as \(answer)") }
    }

    func testSilenceIsNoVerdictWithinTheBudget() throws {
        let origin = try origin { _ in .silent }
        let started = Date()
        let answer = EndpointProbe.request(URL(string: "\(origin.base)/x.m3u8")!, keepBody: false, timeout: 1)
        guard case .unknown = answer else { return XCTFail("silence read as \(answer)") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
        XCTAssertNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/x.m3u8", headers: [:], timeout: 1))
    }

    func testARefusalArrivesAtTheSpeedOfTheAnswer() throws {
        let origin = try routes(["/master.m3u8": Self.playlist(Self.master), "/low.m3u8": .respond(404), "/high.m3u8": .respond(404)])
        let started = Date()
        XCTAssertNotNil(EndpointProbe.hlsOriginRefusal("\(origin.base)/master.m3u8", headers: [:], timeout: 5))
        XCTAssertLessThan(Date().timeIntervalSince(started), 1)
    }

    // MARK: - Parsing

    func testVariantUrlsSkipCommentsAndIFrameStreams() {
        let text = "#EXTM3U\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI=\"iframe.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=2\n\n# note\nhttps://cdn.example/a.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3\r\nb/c.m3u8\r\n"
        let urls = EndpointProbe.variantURLs(text, base: URL(string: "https://origin.example/live/master.m3u8")!)
        XCTAssertEqual(urls.map(\.absoluteString), ["https://cdn.example/a.m3u8", "https://origin.example/live/b/c.m3u8"])
    }
}
