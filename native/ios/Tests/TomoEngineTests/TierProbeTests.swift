import Network
import XCTest

@testable import TomoEngine

/// Answers the tier's server URLs in-process; URLSession.shared consults registered protocols.
final class TierServerStub: URLProtocol {
    static let lock = NSLock()
    static var routes: [String: (status: Int, body: Data)] = [:]
    /// Paths answered with a transport error instead of a status, the shape of a dead link.
    static var transportErrors: Set<String> = []
    static var hits: [String] = []
    /// Segment responses wait on this while set, so a test can serve the master first.
    static var holdSegments: DispatchSemaphore?

    static func reset() {
        lock.lock()
        routes = [:]
        transportErrors = []
        hits = []
        holdSegments = nil
        lock.unlock()
    }

    static func hitCount(_ path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return hits.filter { $0 == path }.count
    }

    static func sawHit(_ path: String, within seconds: Double = 5) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if hitCount(path) > 0 { return true }
            usleep(20_000)
        }
        return hitCount(path) > 0
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "tier.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        Self.lock.lock()
        Self.hits.append(path)
        let route = Self.routes[path]
        let dead = Self.transportErrors.contains(path)
        let hold = path.hasSuffix(".ts") ? Self.holdSegments : nil
        Self.lock.unlock()
        hold?.wait()
        if dead {
            client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            return
        }
        let status = route?.status ?? 404
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: route?.body ?? Data())
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A real socket, for what URLProtocol cannot show: a 200 whose body stops short, or never comes.
final class RawHTTPStub {
    enum Answer {
        case full(Data)
        /// Declares the whole length, sends `sent` bytes of it, and closes.
        case cutShort(Data, sent: Int)
        /// Answers 200, sends the first `sent` bytes, and then nothing more, the connection left open.
        case stalls(Data, sent: Int)
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "raw-http-stub")
    private let lock = NSLock()
    private var answers: [String: [Answer]] = [:]
    private var seen: [String] = []
    private var open: [NWConnection] = []

    var base: String { "http://127.0.0.1:\(listener.port?.rawValue ?? 0)" }

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.start(queue: queue)
        _ = ready.wait(timeout: .now() + 5)
    }

    /// Successive answers for a path; the last one repeats.
    func answer(_ path: String, _ sequence: Answer...) {
        lock.lock()
        answers[path] = sequence
        lock.unlock()
    }

    func requests(_ path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return seen.filter { $0 == path }.count
    }

    func stop() {
        listener.cancel()
        lock.lock()
        open.forEach { $0.cancel() }
        lock.unlock()
    }

    private func serve(_ connection: NWConnection) {
        lock.lock()
        open.append(connection)
        lock.unlock()
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
            guard let self, let data, let line = String(decoding: data, as: UTF8.self).components(separatedBy: "\r\n").first else { return connection.cancel() }
            let target = line.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
            let path = target.components(separatedBy: "?")[0]
            self.lock.lock()
            self.seen.append(path)
            var sequence = self.answers[path] ?? []
            let answer = sequence.first
            if sequence.count > 1 {
                sequence.removeFirst()
                self.answers[path] = sequence
            }
            self.lock.unlock()
            func head(_ status: String, _ length: Int) -> Data {
                Data("HTTP/1.1 \(status)\r\nContent-Length: \(length)\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n".utf8)
            }
            switch answer {
            case .full(let body):
                connection.send(content: head("200 OK", body.count) + body, completion: .contentProcessed { _ in connection.cancel() })
            case .cutShort(let body, let sent):
                connection.send(content: head("200 OK", body.count) + body.prefix(sent), completion: .contentProcessed { _ in connection.cancel() })
            case .stalls(let body, let sent):
                connection.send(content: head("200 OK", body.count) + body.prefix(sent), completion: .contentProcessed { _ in })
            case nil:
                connection.send(content: head("404 Not Found", 0), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
    }
}

/// The tier lists on grid adoption and is retired in the background when the server stops
/// delivering. Every case here is a way a Jellyfin server refuses to transcode: no ffmpeg, a dead
/// encoder, a policy that answers the playlist but not the segments.
final class TierProbeTests: XCTestCase {
    /// The kill route is built from the ApiKey and PlaySessionId the tier URL carries.
    private let playlistUrl = "http://tier.test/Videos/x/main.m3u8?ApiKey=k&PlaySessionId=p"
    private let audioUrl = "http://tier.test/Audio/x/main.m3u8?ApiKey=k&PlaySessionId=p"
    private let playlist = Data("#EXTM3U\n#EXTINF:6.0,\nseg0.ts?s=1\n#EXTINF:6.0,\nseg1.ts?s=1\n#EXTINF:6.0,\nseg2.ts?s=1\n#EXT-X-ENDLIST\n".utf8)
    private let audioPlaylist = Data("#EXTM3U\n#EXT-X-MAP:URI=\"a-init.mp4\"\n#EXTINF:6.0,\na-seg0.mp4\n#EXTINF:6.0,\na-seg1.mp4\n#EXT-X-ENDLIST\n".utf8)

    /// h264 + aac in a transport stream: the shape Jellyfin's tier serves, and a real input
    /// for the tests that need a live pipeline (the segment routes answer notFound on a dead one).
    private var fixtureUrl: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/tier-segment.mpegts")
    }

    private var tierSegment: Data { (try? Data(contentsOf: fixtureUrl)) ?? Data() }

    override func setUp() {
        super.setUp()
        TierServerStub.reset()
        URLProtocol.registerClass(TierServerStub.self)
    }

    override func tearDown() {
        URLProtocol.unregisterClass(TierServerStub.self)
        TierServerStub.reset()
        super.tearDown()
    }

    private func session(
        tierPlaylistUrl: String? = nil,
        serverAudioUrl: String = "",
        startOffsetSeconds: Double = 0,
        inputUrl: String = "file:///dev/null",
        // Below the 8 Mbps source by default so the master lists the tier; nil leaves the real probe,
        // which cannot reach the stubbed source and so reads nothing.
        linkCeilingBps: Double? = 2_000_000
    ) throws -> (RemuxSession, () -> [[String: Any]]) {
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                inputUrl: inputUrl,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: serverAudioUrl)],
                tierPlaylistUrl: tierPlaylistUrl ?? playlistUrl,
                tierBandwidth: 1_700_000,
                tierCodecs: "avc1.4D401F,mp4a.40.2",
                tierWidth: 854,
                tierHeight: 480,
                startOffsetSeconds: startOffsetSeconds
            ))
        s.testLinkBps = linkCeilingBps
        let lock = NSLock()
        var reports: [[String: Any]] = []
        s.onTier = { report in
            lock.lock()
            reports.append(report)
            lock.unlock()
        }
        s.start()
        return (s, {
            lock.lock()
            defer { lock.unlock() }
            return reports
        })
    }

    /// Past the master budget: a refused playlist is retried until that budget ends.
    private func waitForProbe(_ s: RemuxSession) {
        let end = Date().addingTimeInterval(RemuxSession.masterBudgetSeconds + 3)
        while Date() < end, !s.tierProbeResolved { usleep(20_000) }
        XCTAssertTrue(s.tierProbeResolved, "probe never resolved")
    }

    private func states(_ reports: [[String: Any]]) -> [String] { reports.compactMap { $0["state"] as? String } }

    private func isFile(_ response: LocalHTTPResponse) -> Bool {
        if case .file = response { return true }
        return false
    }

    /// A route that has not been materialized yet answers chunked; the provider is what the
    /// HTTP layer runs to produce the body, so a test that wants the fetch must run it too.
    @discardableResult
    private func resolve(_ response: LocalHTTPResponse) -> URL? {
        switch response {
        case .file(let url, _): return url
        case .streamed(_, let provider): return provider()
        case .segment(_, _, _, let provider): return provider(SegmentRequest())
        default: return nil
        }
    }


    private func isNotFound(_ response: LocalHTTPResponse) -> Bool {
        if case .notFound = response { return true }
        return false
    }

    // MARK: - The tier is offered on adoption, proved in the background

    func testHealthyTierIsListedAndItsOpeningSegmentIsAlreadyOnDisk() throws {
        XCTAssertFalse(tierSegment.isEmpty, "Fixtures/tier-segment.mpegts is missing")
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)

        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertNotNil(s.tierPlaylist(rung: 0))

        // The probe's fetch is the one AVPlayer would have made: the segment and the init it
        // carries are on disk, and asking for them again does not go back to the server.
        XCTAssertTrue(isFile(s.tierInitResponse(rung: 0)), "the probe left the init on disk")
        XCTAssertNotNil(resolve(s.tierInitResponse(rung: 0)))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/seg0.ts"), 1, "the opening segment is fetched once, by the probe")
    }

    func testPlaylistRefusedDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (404, Data())
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t0.m3u8"))
        XCTAssertEqual(states(reports()), ["declined"])
        XCTAssertEqual(reports().first?["reason"] as? String, "playlist fetch failed")
    }

    func testFastCopyLeavesServerEncodersIdleUntilAFallbackIsNeeded() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (session, _) = try session(
            serverAudioUrl: "http://tier.test/Audio/x/main.m3u8",
            inputUrl: fixtureUrl.absoluteString,
            linkCeilingBps: 30_000_000
        )
        defer { session.stop() }
        waitForProbe(session)
        let master = session.masterPlaylist()
        XCTAssertTrue(session.sourceReady)
        XCTAssertNil(session.openingRung)
        let initialization = try Data(contentsOf: session.dir.appendingPathComponent("init.mp4"))
        let actualCodec = try XCTUnwrap(VideoCodecDeclaration.fromInit(initialization))
        XCTAssertTrue(actualCodec.hasPrefix("avc1.42"))
        XCTAssertTrue(master.contains("CODECS=\"\(actualCodec),mp4a.40.2\""))
        XCTAssertEqual(session.resolvedAudioCodecs["a0"], "mp4a.40.2")
        XCTAssertLessThan(try XCTUnwrap(master.range(of: "media.m3u8")).lowerBound, try XCTUnwrap(master.range(of: "t0.m3u8")).lowerBound)
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/seg0.ts"), 0)
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/main.m3u8"), 0)
        XCTAssertEqual(session.probeSeconds, 0)

        XCTAssertEqual(session.chooseOpeningRung(linkBps: 2_000_000), 0)
        XCTAssertTrue(TierServerStub.sawHit("/Videos/x/seg0.ts"))
        XCTAssertTrue(TierServerStub.sawHit("/Audio/x/main.m3u8"))
    }

    func testPlaylistWithOneSegmentDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, Data("#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n".utf8))
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t0.m3u8"))
        XCTAssertEqual(reports().first?["reason"] as? String, "playlist held 1 segments")
        XCTAssertFalse(TierServerStub.hits.contains("/Videos/x/seg0.ts"), "an unadopted grid is never probed")
    }

    func testLocalOnlyMasterWaitsForActualOutputCodecs() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 2, inputUrl: fixtureUrl.absoluteString,
            audioTracks: [RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: "")], codecs: ""))
        defer { session.stop() }
        session.start()
        let master = session.masterPlaylist()
        XCTAssertTrue(session.sourceReady)
        let initialization = try Data(contentsOf: session.dir.appendingPathComponent("init.mp4"))
        let actualCodec = try XCTUnwrap(VideoCodecDeclaration.fromInit(initialization))
        XCTAssertTrue(master.contains("CODECS=\"\(actualCodec),mp4a.40.2\""))
    }

    func testOpeningSegmentServerErrorKeepsTheTierRetryable() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertTrue(TierServerStub.hits.contains("/Videos/x/seg0.ts"))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/ActiveEncodings"), 0)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("media.m3u8"), "the primary is still offered")
        XCTAssertNotNil(s.tierPlaylist(rung: 0))
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertEqual(s.supplierRecovery[.rung(0)]?.failure, .http(500))
    }

    func testTransportErrorOnTheOpeningSegmentKeepsTheTierRetryable() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.transportErrors.insert("/Videos/x/seg0.ts")
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertTrue(s.masterPlaylist().contains("t0.m3u8"))
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertEqual(s.supplierRecovery[.rung(0)]?.failure, .transport)
    }

    /// A server that answers with something that is not a transport stream (an error page).
    func testUnrewrappableOpeningSegmentDoesNotDisableOtherSuppliers() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, Data("<html>no transcoder</html>".utf8))
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertTrue(s.masterPlaylist().contains("t0.m3u8"))
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertEqual(s.supplierRecovery[.rung(0)]?.failure, .invalidMedia)
        XCTAssertNil(s.supplierRecovery[.audio(0)])
        XCTAssertTrue(s.tierOffered)
    }

    func testResumeProbesTheSegmentAtTheOffset() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        let (s, _) = try session(startOffsetSeconds: 7)
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertTrue(TierServerStub.hits.contains("/Videos/x/seg1.ts"))
        XCTAssertFalse(TierServerStub.hits.contains("/Videos/x/seg0.ts"))
        XCTAssertEqual(s.lastTierDemandAt, .distantPast, "the probe is not the player living on the tier")
    }

    func testResumePastTheEndClampsToTheLastSegment() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        let (s, _) = try session(startOffsetSeconds: 9_999)
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertTrue(TierServerStub.hits.contains("/Videos/x/seg2.ts"))
    }

    // MARK: - A tier that dies after it was offered

    /// On a link below the source, a server whose grid is adopted lists its rung on adoption even
    /// while the opening segment is still transcoding; the probe proving it runs in the background.
    /// Blocking the master on the cold segment is what dropped playback to the audio-losing server
    /// lane on a real link.
    func testASlowServerStillOffersTheRungOnAdoption() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let hold = DispatchSemaphore(value: 0)
        TierServerStub.holdSegments = hold
        let (s, reports) = try session()
        defer {
            hold.signal()
            s.stop()
        }
        let end = Date().addingTimeInterval(10)
        while Date() < end, !s.tierActive { usleep(20_000) }
        XCTAssertTrue(s.tierActive, "the grid is adopted; only the segment is slow")

        // The probe is still parked on the held segment when the master is written; the rung lists anyway.
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"), "an adopted rung is offered before its segment proves")
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertTrue(s.tierOffered)
        XCTAssertEqual(states(reports()), ["listed"])
    }

    func testAnOpeningFailureDoesNotRemoveTheRungsRoutes() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, _) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertNotNil(s.tierPlaylist(rung: 0))
        XCTAssertFalse(isNotFound(s.tierSegmentResponse(rung: 0, 0)))
        XCTAssertFalse(isNotFound(s.tierInitResponse(rung: 0)))
        XCTAssertTrue(s.tierOffered)
    }

    func testAudioRefusalsDoNotRetireTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Audio/x/main.m3u8"] = (200, audioPlaylist)
        TierServerStub.routes["/Audio/x/a-init.mp4"] = (200, Data("init".utf8))
        TierServerStub.routes["/Audio/x/a-seg0.mp4"] = (500, Data())
        let (s, reports) = try session(serverAudioUrl: audioUrl)
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertTrue(s.audioLoActive)

        resolve(s.audioLoInitResponse(position: 0))
        XCTAssertTrue(s.tierOffered)
        resolve(s.audioLoInitResponse(position: 0))
        XCTAssertTrue(s.tierOffered)
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertEqual(s.supplierRecovery[.audio(0)]?.failure, .http(500))
        XCTAssertNil(s.supplierRecovery[.rung(0)])
    }

    // MARK: - Reporting

    func testTheMasterReportsOnceHoweverOftenItIsAsked() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        _ = s.masterPlaylist()
        _ = s.masterPlaylist()
        XCTAssertEqual(states(reports()), ["listed"])
    }

    func testADeclinedTierIsNeverAlsoReportedDropped() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, Data("#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n".utf8))
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        // Nothing a later request does can turn a tier the viewer never saw into a drop.
        _ = s.tierSegmentResponse(rung: 0, 1)
        _ = s.tierSegmentResponse(rung: 0, 2)
        XCTAssertEqual(states(reports()), ["declined"])
    }

    /// Every session that is not slipstreamed: no probe, no report, no tier in the master.
    func testASessionWithNoTierIsNeverProbedOrReported() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: "")]))
        defer { s.stop() }
        var reports: [[String: Any]] = []
        s.onTier = { reports.append($0) }
        s.start()
        let master = s.masterPlaylist()
        XCTAssertFalse(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertTrue(reports.isEmpty)
        XCTAssertNil(s.tierPlaylist(rung: 0))
    }

    /// A link three times the source starts on the copy; the rungs stay listed after it for a later drop.
    func testALinkThatCarriesThePrimaryStartsOnIt() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, reports) = try session(inputUrl: fixtureUrl.absoluteString, linkCeilingBps: 30_000_000)
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertTrue(master.contains("t0.m3u8"), "the rung stays listed for a later drop")
        XCTAssertLessThan(master.range(of: "media.m3u8")!.lowerBound, master.range(of: "t0.m3u8")!.lowerBound, "the copy is the startup variant")
        XCTAssertEqual(states(reports()), ["listed"])
    }

    // MARK: - The ladder

    private func ladderSession(rung1Playlist: Data, inputUrl: String = "file:///dev/null") throws -> RemuxSession {
        TierServerStub.routes["/Videos/x/t0.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (200, rung1Playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                inputUrl: inputUrl,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: "")],
                tiers: [
                    TierConfig(playlistUrl: "http://tier.test/Videos/x/t0.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 992_000, codecs: "avc1.64001E,mp4a.40.2", width: 640, height: 360),
                    TierConfig(playlistUrl: "http://tier.test/Videos/x/t1.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 1_692_000, codecs: "avc1.64001F,mp4a.40.2", width: 854, height: 480),
                ]
            ))
        // Below the 8 Mbps source: the master starts on the biggest rung under 80% of the link (t0).
        s.testLinkBps = 2_000_000
        return s
    }

    /// A two-rung ladder lists both variants ascending, each with its own RESOLUTION.
    func testLadderListsEveryAdoptedRungAscending() throws {
        XCTAssertFalse(tierSegment.isEmpty, "Fixtures/tier-segment.mpegts is missing")
        let s = try ladderSession(rung1Playlist: playlist)
        defer { s.stop() }
        s.start()
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("t1.m3u8"))
        XCTAssertLessThan(master.range(of: "t0.m3u8")!.lowerBound, master.range(of: "t1.m3u8")!.lowerBound, "rungs list ascending")
        XCTAssertTrue(master.contains("RESOLUTION=640x360"))
        XCTAssertTrue(master.contains("RESOLUTION=854x480"))
        XCTAssertNotNil(s.tierPlaylist(rung: 0))
        XCTAssertNotNil(s.tierPlaylist(rung: 1))
    }

    // MARK: - One stereo group for every rung

    private func entries(_ master: String, for playlist: String) -> [String] {
        let lines = master.components(separatedBy: "\n")
        return lines.indices.filter { lines[$0] == playlist && $0 > 0 }.map { lines[$0 - 1] }
    }

    /// A surround output takes only surround entries, so the rungs offer none: each is listed once, in stereo.
    func testEveryRungIsListedOnceWithTheStereoGroup() throws {
        TierServerStub.routes["/Videos/x/t0.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        var track = RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: audioUrl)
        track.serverAudioChannels = 2
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                audioTracks: [track],
                tiers: [TierConfig(playlistUrl: "http://tier.test/Videos/x/t0.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 496_000, codecs: "avc1.640015,mp4a.40.2", width: 426, height: 240),
                        TierConfig(playlistUrl: "http://tier.test/Videos/x/t1.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 1_620_000, codecs: "avc1.64001F,mp4a.40.2", width: 854, height: 480)]))
        s.testLinkBps = 2_000_000
        defer { s.stop() }
        s.start()
        waitForProbe(s)
        let master = s.masterPlaylist()
        for rung in ["t0.m3u8", "t1.m3u8"] {
            XCTAssertEqual(entries(master, for: rung).map { $0.contains("AUDIO=\"audio-lo\"") }, [true])
        }
        let lines = master.components(separatedBy: "\n")
        XCTAssertTrue(lines.first { $0.contains("GROUP-ID=\"audio-lo\"") }?.contains("CHANNELS=\"2\"") == true)
        XCTAssertFalse(isNotFound(s.route("a0s-init.mp4")))
    }

    // MARK: - PGS from the server

    private func pgsTrack(serverSupUrl: String) -> RemuxSubtitle {
        var track = RemuxSubtitle(index: 3, name: "PGS", language: "eng", vttUrl: "", localVtt: "", isDefault: false, isForced: false, isImage: true, isEngineText: false, serverVttUrl: "")
        track.serverSupUrl = serverSupUrl
        return track
    }

    /// A PGS track the server can hand over raw is no reason to keep the source on a thin link.
    func testAPgsTrackWithAServerStreamLetsTheSourceGo() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: audioUrl)],
                subtitles: [pgsTrack(serverSupUrl: "file:///nonexistent.sup")],
                tierPlaylistUrl: playlistUrl, tierBandwidth: 1_700_000, tierCodecs: "avc1.4D401F,mp4a.40.2", tierWidth: 854, tierHeight: 480))
        s.testLinkBps = 2_000_000
        s.start()
        defer { s.stop() }
        settle { s.isSourceReleased }
        XCTAssertTrue(s.isSourceReleased)
    }

    /// The server's raw stream decodes to the track's own cue manifest: its index, its own file
    /// names, every cue, and complete so the app stops asking.
    func testTheServerPgsStreamBecomesTheTracksManifest() throws {
        let sup = fixtureUrl.deletingLastPathComponent().appendingPathComponent("pgs-track.sup")
        XCTAssertTrue(FileManager.default.fileExists(atPath: sup.path), "Fixtures/pgs-track.sup is missing")
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [pgsTrack(serverSupUrl: sup.path)]))
        defer { s.stop() }
        s.startServerImageSubtitles()
        settle { s.serverImageSubtitles[3]?.isComplete == true }
        let data = try XCTUnwrap(s.subtitleCueManifest(streamIndex: 3))
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(manifest["streamIndex"] as? Int, 3)
        XCTAssertEqual(manifest["complete"] as? Bool, true)
        let events = try XCTUnwrap(manifest["events"] as? [[String: Any]])
        let drawn = events.compactMap { ($0["images"] as? [[String: Any]])?.first?["file"] as? String }
        XCTAssertFalse(drawn.isEmpty, "the stream's display sets were decoded")
        XCTAssertTrue(drawn.allSatisfy { $0.hasPrefix("pgs3s-") }, "its images never share the demuxer's names")
        XCTAssertEqual(events.first?["time"] as? Double ?? -1, 1.001, accuracy: 0.01, "cue times are the session's, as they arrive")
    }

    /// A stream that is not there on the first try is read on a later one.
    func testAServerStreamThatFailsOnceIsReadOnTheNextTry() throws {
        let sup = fixtureUrl.deletingLastPathComponent().appendingPathComponent("pgs-track.sup")
        let late = FileManager.default.temporaryDirectory.appendingPathComponent("late-\(UUID().uuidString).pgssub")
        defer { try? FileManager.default.removeItem(at: late) }
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [pgsTrack(serverSupUrl: late.path)]))
        defer { s.stop() }
        s.startServerImageSubtitles()
        usleep(500_000)
        XCTAssertNil(s.serverImageSubtitles[3], "the first try found nothing")
        try FileManager.default.copyItem(at: sup, to: late)
        settle(8) { s.serverImageSubtitles[3]?.isComplete == true }
        XCTAssertEqual(s.serverImageSubtitles[3]?.isComplete, true)
    }

    /// A stream that breaks off mid-read is not complete with the cues it got: it is read again.
    func testAServerStreamThatBreaksOffIsReadAgainInFull() throws {
        let sup = try Data(contentsOf: fixtureUrl.deletingLastPathComponent().appendingPathComponent("pgs-track.sup"))
        let whole = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [pgsTrack(serverSupUrl: fixtureUrl.deletingLastPathComponent().appendingPathComponent("pgs-track.sup").path)]))
        defer { whole.stop() }
        whole.startServerImageSubtitles()
        settle { whole.serverImageSubtitles[3]?.isComplete == true }
        let expected = try cueCount(whole)

        let server = try RawHTTPStub()
        defer { server.stop() }
        server.answer("/Subtitles/3/Stream.pgssub", .cutShort(sup, sent: sup.count / 2), .full(sup))
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [pgsTrack(serverSupUrl: "\(server.base)/Subtitles/3/Stream.pgssub")]))
        defer { s.stop() }
        s.startServerImageSubtitles()
        settle(10) { server.requests("/Subtitles/3/Stream.pgssub") >= 2 && s.serverImageSubtitles[3]?.isComplete == true }
        XCTAssertEqual(server.requests("/Subtitles/3/Stream.pgssub"), 2, "the broken read was tried again")
        XCTAssertEqual(try cueCount(s), expected, "and the track holds every cue, not half of them")
    }

    private func cueCount(_ s: RemuxSession) throws -> Int {
        let data = try XCTUnwrap(s.subtitleCueManifest(streamIndex: 3))
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(manifest["complete"] as? Bool, true)
        return (manifest["events"] as? [[String: Any]])?.count ?? 0
    }

    /// A DVD track arrives in Matroska and is found by its content, not named like the PGS stream.
    func testTheServerDvdStreamBecomesTheTracksManifest() throws {
        let mks = fixtureUrl.deletingLastPathComponent().appendingPathComponent("dvd-track.mks")
        XCTAssertTrue(FileManager.default.fileExists(atPath: mks.path), "Fixtures/dvd-track.mks is missing")
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [pgsTrack(serverSupUrl: mks.path)]))
        defer { s.stop() }
        s.startServerImageSubtitles()
        settle { s.serverImageSubtitles[3]?.isComplete == true }
        let data = try XCTUnwrap(s.subtitleCueManifest(streamIndex: 3))
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(manifest["streamIndex"] as? Int, 3)
        XCTAssertEqual(manifest["complete"] as? Bool, true)
        let events = try XCTUnwrap(manifest["events"] as? [[String: Any]])
        let drawn = events.compactMap { ($0["images"] as? [[String: Any]])?.first?["file"] as? String }
        XCTAssertFalse(drawn.isEmpty, "the DVD display sets were decoded")
        XCTAssertTrue(drawn.allSatisfy { $0.hasPrefix("pgs3s-") })
    }

    // MARK: - A source lost mid-play

    private func isGone(_ response: LocalHTTPResponse) -> Bool {
        if case .gone = response { return true }
        return false
    }

    func testASourceLostAfterTheMasterHandsTheSessionToTheRungs() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                inputUrl: fixtureUrl.absoluteString,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: audioUrl)],
                tierPlaylistUrl: playlistUrl, tierBandwidth: 1_700_000, tierCodecs: "avc1.4D401F,mp4a.40.2", tierWidth: 854, tierHeight: 480))
        s.testLinkBps = 30_000_000
        var failures = 0
        s.onFailed = { _ in failures += 1 }
        s.start()
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("media.m3u8"), "the master named the copy")
        XCTAssertTrue(master.contains("t0.m3u8"))

        s.fail("read_frame: the source went away")

        XCTAssertFalse(s.hasFailed)
        XCTAssertEqual(failures, 0, "the app is not told to leave")
        XCTAssertTrue(s.isSourceReleased)
        let original = s.segmentResponse(0)
        XCTAssertTrue(isGone(original) || isFile(original))
        XCTAssertTrue(isFile(s.initResponse()), "valid cached initialization data remains usable")
        XCTAssertFalse(isNotFound(s.tierSegmentResponse(rung: 0, 0)), "the rung still serves")
        XCTAssertTrue(s.reportsCopyListed)
        _ = s.initResponse()
        _ = s.tierSegmentResponse(rung: 0, 0)
        s.stateLock.lock()
        let riding = s.ridingTierLocked()
        s.stateLock.unlock()
        XCTAssertTrue(riding, "AVPlayer asking after a copy that is gone is not leaving the rungs")
    }

    /// Without a ladder to carry it, a failure is what it always was.
    func testAFailureWithNoLadderStillEndsTheSession() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: "")]))
        defer { s.stop() }
        s.fail("read_frame: the source went away")
        XCTAssertTrue(s.hasFailed)
        XCTAssertTrue(isNotFound(s.segmentResponse(0)))
    }

    // MARK: - A request the player gave up

    private func holdSegments() -> DispatchSemaphore {
        let hold = DispatchSemaphore(value: 0)
        TierServerStub.lock.lock()
        TierServerStub.holdSegments = hold
        TierServerStub.lock.unlock()
        return hold
    }

    private func provider(of response: LocalHTTPResponse) throws -> (SegmentRequest) -> URL? {
        guard case .segment(_, _, _, let provider) = response else { throw XCTSkip("the segment is already on disk") }
        return provider
    }

    /// The player closing the connection ends the fetch behind it, while the server still holds it.
    func testAnAbandonedRungRequestEndsItsFetch() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Videos/x/seg1.ts"] = (200, tierSegment)
        let (s, _) = try session()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        let hold = holdSegments()
        defer { hold.signal() }
        let request = SegmentRequest()
        let serve = try provider(of: s.tierSegmentResponse(rung: 0, 1))
        let done = expectation(description: "the provider returns")
        var served: URL?
        DispatchQueue.global().async {
            served = serve(request)
            done.fulfill()
        }
        XCTAssertTrue(TierServerStub.sawHit("/Videos/x/seg1.ts"))
        request.abandon()
        wait(for: [done], timeout: 5)
        XCTAssertNil(served, "the fetch ended with the server still holding the segment")
        XCTAssertNil(s.supplierRecovery[.rung(0)], "a fetch the player gave up is not a failing supplier")
    }

    /// The measured shape itself: the server has answered 200, the body has not come, and the player
    /// gives the segment up. Twice in a row, and the ladder is still there.
    func testSegmentsGivenUpAfterThe200DoNotRetireTheLadder() throws {
        let server = try RawHTTPStub()
        defer { server.stop() }
        server.answer("/Videos/x/main.m3u8", .full(playlist))
        server.answer("/Videos/x/seg0.ts", .full(tierSegment))
        server.answer("/Videos/x/seg1.ts", .stalls(tierSegment, sent: 4096))
        server.answer("/Videos/x/seg2.ts", .stalls(tierSegment, sent: 4096))
        // A source that opens: a session whose pipeline failed answers every rung route notFound.
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                inputUrl: fixtureUrl.absoluteString,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: "")],
                tierPlaylistUrl: "\(server.base)/Videos/x/main.m3u8?ApiKey=k&PlaySessionId=p", tierBandwidth: 1_700_000, tierCodecs: "avc1.4D401F,mp4a.40.2", tierWidth: 854, tierHeight: 480))
        s.testLinkBps = 2_000_000
        s.start()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        for n in [1, 2] {
            let response = s.tierSegmentResponse(rung: 0, n)
            guard case .segment(_, _, _, let serve) = response else { return XCTFail("segment \(n) is not served as a fetch: \(response)") }
            let request = SegmentRequest()
            let done = expectation(description: "segment \(n) returns")
            DispatchQueue.global().async {
                XCTAssertNil(serve(request))
                done.fulfill()
            }
            settle { server.requests("/Videos/x/seg\(n).ts") > 0 }
            usleep(300_000)
            request.abandon()
            wait(for: [done], timeout: 5)
        }
        XCTAssertNil(s.supplierRecovery[.rung(0)], "a segment the player gave up is not the server refusing")
    }

    /// A rung landing beside the producer is counted once: by its own transfer, not again by the
    /// producer's sample (which read a 9.6 Mb/s second as 14.4).
    func testASourceReadBesideARungCountsTheRungOnce() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { s.stop() }
        let t0 = Date()
        s.restartLinkSample(now: t0)
        s.transfers.note(bytes: 600_000)
        s.noteFloorSample(bytes: 600_000, from: t0, to: t0.addingTimeInterval(1))
        s.noteSourceRead(bytes: 600_000, seconds: 0.5, now: t0.addingTimeInterval(1))
        XCTAssertEqual(s.floorLinkBps ?? 0, 9_600_000, accuracy: 1, "1.2 MB over one shared second")
        XCTAssertNil(s.wireLinkBps)
        XCTAssertNil(s.pacedLinkBps)
    }

    /// A producer that sat out a minute under a rung starts its next sample when it wakes: the
    /// minute's rung bytes and the minute itself are no part of it.
    func testASampleDoesNotSpanAHold() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { s.stop() }
        let t0 = Date()
        s.restartLinkSample(now: t0)
        s.transfers.note(bytes: 3_000_000)
        s.restartLinkSample(now: t0.addingTimeInterval(60))
        s.noteSourceRead(bytes: 600_000, seconds: 1, now: t0.addingTimeInterval(61))
        XCTAssertEqual(s.wireLinkBps ?? 0, 4_800_000, accuracy: 1, "600 KB read alone in one second is the wire")
    }

    /// The server's audio arrives beside a 64px picture (the one route that maps the track asked
    /// for): the rendition AVPlayer gets is the audio alone, on the session's clock.
    func testTheAudioCarrierIsRewrappedToItsAudioAlone() throws {
        let fixtures = fixtureUrl.deletingLastPathComponent()
        let initData = try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-init.mp4"))
        let segment = try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-seg0.mp4"))
        let out = try XCTUnwrap(TierRewrapper.rewrapAudio(initData: initData, segmentData: segment, targetStartSeconds: 12))
        XCTAssertNotNil(out.initSegment.range(of: Data("mp4a".utf8)))
        XCTAssertNil(out.initSegment.range(of: Data("avc1".utf8)), "the picture is dropped")
        XCTAssertEqual(out.durationSeconds, 6, accuracy: 0.1)
        XCTAssertLessThan(out.mediaSegment.count, segment.count)
    }

    /// A player gone before the fetch begins (it waited behind another) starts no transfer at all.
    func testARequestAbandonedBeforeItsFetchStartsNoTransfer() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Videos/x/seg1.ts"] = (200, tierSegment)
        let (s, _) = try session()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        let request = SegmentRequest()
        request.abandon()
        let serve = try provider(of: s.tierSegmentResponse(rung: 0, 1))
        XCTAssertNil(serve(request))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/seg1.ts"), 0, "nobody wants it, so the server is never asked")
        XCTAssertNil(s.supplierRecovery[.rung(0)])
        XCTAssertNotNil(try provider(of: s.tierSegmentResponse(rung: 0, 1))(SegmentRequest()), "the next request still gets it")
    }

    /// The server's audio segments end with their player too.
    func testAnAbandonedAudioRequestStartsNoTransfer() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Audio/x/main.m3u8"] = (200, audioPlaylist)
        TierServerStub.routes["/Audio/x/a-init.mp4"] = (200, Data("init".utf8))
        TierServerStub.routes["/Audio/x/a-seg1.mp4"] = (200, Data("seg".utf8))
        let (s, _) = try session(serverAudioUrl: audioUrl)
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        let request = SegmentRequest()
        request.abandon()
        let serve = try provider(of: s.audioLoSegmentResponse(position: 0, n: 1))
        XCTAssertNil(serve(request))
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/a-seg1.mp4"), 0)
        XCTAssertTrue(s.tierOffered)
    }

    /// A resumed session's audio init comes from the segment at the resume point, not the film's first.
    func testTheAudioInitIsCutFromTheSegmentAtThePlayhead() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg1.ts"] = (200, tierSegment)
        TierServerStub.routes["/Audio/x/main.m3u8"] = (200, audioPlaylist)
        TierServerStub.routes["/Audio/x/a-init.mp4"] = (200, Data("init".utf8))
        TierServerStub.routes["/Audio/x/a-seg1.mp4"] = (200, Data("seg".utf8))
        let (s, _) = try session(serverAudioUrl: audioUrl, startOffsetSeconds: 7)
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        resolve(s.audioLoInitResponse(position: 0))
        XCTAssertTrue(TierServerStub.sawHit("/Audio/x/a-seg1.mp4"))
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/a-seg0.mp4"), 0, "7s in is the second segment of the audio grid")
    }

    /// Two requests want the same segment: one leaving does not take it from the other.
    func testASecondLiveRequestKeepsTheFetch() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Videos/x/seg1.ts"] = (200, tierSegment)
        let (s, _) = try session()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        let hold = holdSegments()
        let leaving = SegmentRequest()
        let first = try provider(of: s.tierSegmentResponse(rung: 0, 1))
        let second = try provider(of: s.tierSegmentResponse(rung: 0, 1))
        let done = expectation(description: "both providers return")
        done.expectedFulfillmentCount = 2
        var kept: URL?
        DispatchQueue.global().async {
            _ = first(leaving)
            done.fulfill()
        }
        XCTAssertTrue(TierServerStub.sawHit("/Videos/x/seg1.ts"))
        DispatchQueue.global().async {
            kept = second(SegmentRequest())
            done.fulfill()
        }
        usleep(200_000)
        leaving.abandon()
        usleep(200_000)
        hold.signal()
        wait(for: [done], timeout: 5)
        XCTAssertNotNil(kept, "the request still waiting got its segment")
    }

    /// The master leads with the biggest rung whose segment the link lands in about a second.
    func testTheLinkChoosesTheRungThatOpens() throws {
        let thin = try ladderSession(rung1Playlist: playlist)
        defer { thin.stop() }
        thin.start()
        waitForProbe(thin)
        let thinMaster = thin.masterPlaylist()
        XCTAssertLessThan(thinMaster.range(of: "t0.m3u8")!.lowerBound, thinMaster.range(of: "t1.m3u8")!.lowerBound)

        let fast = try ladderSession(rung1Playlist: playlist)
        defer { fast.stop() }
        fast.testLinkBps = 12_000_000
        fast.start()
        waitForProbe(fast)
        let fastMaster = fast.masterPlaylist()
        XCTAssertLessThan(fastMaster.range(of: "t1.m3u8")!.lowerBound, fastMaster.range(of: "t0.m3u8")!.lowerBound, "1.7 Mb/s six times over is inside 12 Mb/s")
        settle { FileManager.default.fileExists(atPath: fast.dir.appendingPathComponent("t1-seg0.m4s").path) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: fast.dir.appendingPathComponent("t1-seg0.m4s").path), "the opening segment of the leading rung is fetched ahead of the player")

        // A copy leads only while its source is read, so this one opens a real file.
        let plenty = try ladderSession(rung1Playlist: playlist, inputUrl: fixtureUrl.absoluteString)
        defer { plenty.stop() }
        plenty.testLinkBps = 30_000_000
        plenty.start()
        waitForProbe(plenty)
        _ = plenty.masterPlaylist()
        XCTAssertNil(plenty.openingRung, "a copy that leads has the link to itself, and latches no rung")
    }

    func testOpeningChoiceSkipsAFailedLatchWithoutRetiringItsRendition() throws {
        let session = try ladderSession(rung1Playlist: playlist)
        defer { session.stop() }
        session.sourceState = .dormant
        session.openingRung = 0
        session.openingRungResolved = true
        session.recordSupplierFailure(.rung(0), failure: .http(503))

        XCTAssertEqual(session.chooseOpeningRung(linkBps: 2_000_000), 1)
        XCTAssertEqual(session.openingRung, 1)
        XCTAssertFalse(session.openingRungResolved)
        XCTAssertFalse(session.rungsUnavailable.contains(0))
        XCTAssertEqual(session.supplierRecovery[.rung(0)]?.failure, .http(503))
    }

    func testSelectingRungZeroStartsItsOwnOpeningFetch() throws {
        let session = try ladderSession(rung1Playlist: playlist)
        defer { session.stop() }
        session.sourceState = .dormant
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.gridResolved = true
        session.openingRung = 1
        session.openingRungResolved = false
        session.recordSupplierFailure(.rung(1), failure: .http(503))
        let media = try XCTUnwrap(TierRewrapper.rewrap(tsData: tierSegment, targetStartSeconds: 0))
        try media.mediaSegment.write(to: session.dir.appendingPathComponent("t0-seg0.m4s"))

        XCTAssertEqual(session.chooseOpeningRung(linkBps: 2_000_000), 0)
        settle {
            session.stateLock.lock()
            defer { session.stateLock.unlock() }
            return session.openingRungResolved
        }
        session.stateLock.lock()
        let resolved = session.openingRungResolved
        session.stateLock.unlock()
        XCTAssertTrue(resolved)
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/seg0.ts"), 0)
    }

    func testOpeningHoldUsesTheSelectedRungRatherThanTheCanonicalProbe() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.rungLeads = true
        for selectedRung in [0, 1] {
            session.openingRung = selectedRung
            session.tierProbeResolved = true
            session.openingRungResolved = false
            XCTAssertTrue(session.openingHoldLocked())
            session.tierProbeResolved = false
            session.openingRungResolved = true
            XCTAssertFalse(session.openingHoldLocked())
        }
        session.rungLeads = false
        session.openingRungResolved = false
        XCTAssertFalse(session.openingHoldLocked())
    }

    /// A fast link whose source will not open is still a fast link: the rungs open where it affords.
    func testAFastLinkWithNoSourceOpensAboveTheBottomRung() throws {
        TierServerStub.routes["/Videos/x/t0.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Audio/x/main.m3u8"] = (200, audioPlaylist)
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: audioUrl)],
                tiers: [
                    TierConfig(playlistUrl: "http://tier.test/Videos/x/t0.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 992_000, codecs: "avc1.64001E,mp4a.40.2", width: 640, height: 360),
                    TierConfig(playlistUrl: "http://tier.test/Videos/x/t1.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 1_692_000, codecs: "avc1.64001F,mp4a.40.2", width: 854, height: 480),
                ]
            ))
        s.testLinkBps = 30_000_000
        s.start()
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(s.isSourceReleased)
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertLessThan(master.range(of: "t1.m3u8")!.lowerBound, master.range(of: "t0.m3u8")!.lowerBound, "30 Mb/s opens on the upper rung, not on the smallest")
    }

    /// A rung above the first is listed unfetched and adopted when it is asked for: one cut on
    /// another grid (a different segment count) is retired then, and its routes answer 404.
    func testRungWithMismatchedGridIsRetiredWhenAskedFor() throws {
        XCTAssertFalse(tierSegment.isEmpty, "Fixtures/tier-segment.mpegts is missing")
        let twoSegments = Data("#EXTM3U\n#EXTINF:6.0,\nseg0.ts?s=1\n#EXTINF:6.0,\nseg1.ts?s=1\n#EXT-X-ENDLIST\n".utf8)
        let s = try ladderSession(rung1Playlist: twoSegments)
        defer { s.stop() }
        s.start()
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/t1.m3u8"), 0, "a rung's playlist is not fetched before the master")
        XCTAssertNil(s.tierPlaylist(rung: 1), "a grid-mismatched rung is retired")
        XCTAssertTrue(isNotFound(s.route("t1.m3u8")))
        XCTAssertTrue(isNotFound(s.route("t1-seg0.m4s")))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/t1.m3u8"), 1, "a retired rung is not fetched again")
        XCTAssertNotNil(s.tierPlaylist(rung: 0), "the rest of the ladder stands")
    }

    // MARK: - The copy decision and the source

    private func settle(_ seconds: Double = 5, until done: () -> Bool) {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end, !done() { usleep(20_000) }
    }

    func testALinkThatReadNothingDefersTheCopy() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, _) = try session(serverAudioUrl: audioUrl, linkCeilingBps: nil)
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("media.m3u8"))
        guard case .temporarilyUnavailable = s.initResponse() else { return XCTFail("an unready supplier must defer before media headers") }
        XCTAssertTrue(master.contains("t0.m3u8"))
    }

    func testASlowLinkKeepsTheSourceDormantAndListed() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, _) = try session(serverAudioUrl: audioUrl)
        defer { s.stop() }
        settle { s.isSourceReleased }
        XCTAssertTrue(s.isSourceReleased)
        XCTAssertFalse(s.hasFailed, "the rungs carry a session whose source was let go")
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("GROUP-ID=\"audio-lo\""))
        guard case .temporarilyUnavailable = s.segmentResponse(0) else { return XCTFail("a cold source must defer before media headers") }
    }

    func testDormantSourceWakesInsideItsOriginalSession() throws {
        let shortGrid = Data("#EXTM3U\n#EXTINF:1.0,\nseg0.ts?s=1\n#EXTINF:1.0,\nseg1.ts?s=1\n#EXT-X-ENDLIST\n".utf8)
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, shortGrid)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 2, inputUrl: fixtureUrl.absoluteString,
            audioTracks: [RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: audioUrl)],
            tierPlaylistUrl: playlistUrl, tierBandwidth: 1_700_000, tierCodecs: "avc1.4D401F,mp4a.40.2", tierWidth: 854, tierHeight: 480))
        session.testLinkBps = 600_000
        session.start()
        defer { session.stop() }
        settle { session.isSourceReleased }
        let token = session.token
        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertNil(session.renditions.first)
        session.stateLock.lock()
        session.lastRequestedSegment = 1
        session.sourceRetryAttempts = 4
        session.testLinkBps = 40_000_000
        session.stateLock.unlock()
        settle { session.sourceReady || session.hasFailed }
        XCTAssertFalse(session.hasFailed)
        XCTAssertTrue(session.sourceReady)
        XCTAssertEqual(session.token, token)
        XCTAssertNotNil(session.segmentURL(1))
        XCTAssertEqual(session.sessionAnchorSeconds ?? .infinity, 1.423222, accuracy: 0.01)
        XCTAssertNil(session.copyResponseDeferral())
        XCTAssertEqual(session.sourceRetryAttempts, 0)
    }

    func testForegroundWakeDoesNotRequireCapacityForTwoVideoSuppliers() throws {
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 18, bandwidth: 4_000_000,
            tierPlaylistUrl: playlistUrl, tierBandwidth: 4_000_000))
        defer { session.stop() }
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.sourceState = .dormant
        session.copyAnnounced = true
        session.lastRequestedSegment = 1
        session.lastTierRung = 0
        session.wireLinkBps = 5_000_000
        let token = session.token

        XCTAssertTrue(session.wakeSourceIfAffordable())
        XCTAssertEqual(session.sourceState, .warming)
        XCTAssertEqual(session.sourceTakeoverSegment, 1)
        XCTAssertEqual(session.pendingSeekSegment, 1)
        XCTAssertEqual(session.token, token)
        XCTAssertFalse(session.sourceReady)
        XCTAssertTrue(session.awaitCopyAdmission(until: Date()))
        XCTAssertFalse(session.copyFollowsLocked())
    }

    func testTheFullMultiplexedSourceCostGovernsCopyAdmissionAndWake() throws {
        var configuration = makeConfig(durationSeconds: 18, bandwidth: 4_000_000,
                                       tierPlaylistUrl: playlistUrl, tierBandwidth: 1_000_000)
        configuration.sourceBandwidth = 8_000_000
        let session = try RemuxSession(config: configuration)
        defer { session.stop() }
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.copyAnnounced = true
        session.testLinkBps = 6_000_000
        session.finishLinkProbe(6_000_000, reporting: false)
        session.sourceState = .dormant

        XCTAssertFalse(session.decideCopy())
        XCTAssertFalse(session.wakeSourceIfAffordable())
        session.sourceState = .warming
        XCTAssertFalse(session.awaitCopyAdmission(until: Date()))
        XCTAssertFalse(session.copyFollowsLocked())
        XCTAssertEqual(session.wireLinkBps, 6_000_000)

        session.sourceState = .dormant
        session.testLinkBps = 12_000_000
        session.finishLinkProbe(12_000_000, reporting: true)
        XCTAssertTrue(session.wakeSourceIfAffordable())
        XCTAssertTrue(session.awaitCopyAdmission(until: Date()))
        XCTAssertTrue(session.copyFollowsLocked())
    }

    func testMissingSavedSubtitleDefersWhileImagePlaceholdersRemainIntentional() throws {
        let saved = RemuxSubtitle(index: 2, name: "Text", language: "eng", vttUrl: "",
                                  localVtt: "file:///missing-\(UUID().uuidString).vtt", isDefault: false,
                                  isForced: false, isImage: false, isEngineText: false)
        let image = RemuxSubtitle(index: 3, name: "Image", language: "eng", vttUrl: "", localVtt: "",
                                  isDefault: false, isForced: false, isImage: true, isEngineText: false)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [saved, image]))
        defer { session.stop() }
        guard case .temporarilyUnavailable = session.route("sub2.vtt") else { return XCTFail("missing text is not empty successful text") }
        guard case .data(let body, _) = session.route("sub3.vtt") else { return XCTFail("image captions keep their cue-less picker rendition") }
        XCTAssertEqual(String(decoding: body, as: UTF8.self), session.emptySubtitleBody())
        XCTAssertTrue(isNotFound(session.route("sub99.vtt")))
        XCTAssertTrue(isNotFound(session.route("sub3--1.vtt")))
        XCTAssertTrue(isNotFound(session.route("sub3-99.vtt")))
        XCTAssertTrue(isNotFound(session.route("sub2-0.vtt")))
    }

    func testAnUncoveredTextWindowDefersBeforeHeaders() throws {
        var subtitle = RemuxSubtitle(index: 2, name: "Text", language: "eng", vttUrl: "", localVtt: "",
                                     isDefault: false, isForced: false, isImage: false, isEngineText: true)
        subtitle.serverVttUrl = "http://tier.test/missing-subtitle.vtt"
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, subtitles: [subtitle]))
        defer { session.stop() }
        session.subtitleDecodersBuilt = true
        guard case .temporarilyUnavailable = session.route("sub2-0.vtt") else { return XCTFail("uncovered text is not an empty successful window") }
        XCTAssertTrue(isNotFound(session.route("sub99-0.vtt")))
        XCTAssertTrue(isNotFound(session.route("sub2-3.vtt")))
    }

    func testSourceRetryWaitIsBoundedAndKeepsTheSessionRecoverable() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.sourceState = .ready
        session.sourceReady = true
        session.sourceTakeoverSegment = 2
        let now = Date()
        session.retrySource(because: "network timeout", now: now)

        XCTAssertEqual(session.sourceState, .retryWait)
        XCTAssertFalse(session.sourceReady)
        XCTAssertNil(session.sourceTakeoverSegment)
        XCTAssertTrue(session.recovering)
        XCTAssertFalse(session.sourceUnusable)
        XCTAssertFalse(session.hasFailed)
        XCTAssertEqual(session.sourceRetryAttempts, 1)
        XCTAssertEqual(session.sourceRetryAt.timeIntervalSince(now), 1, accuracy: 0.001)
        XCTAssertFalse(session.wakeSourceIfAffordable(now: now))
        XCTAssertFalse(session.awaitCopyAdmission(until: now))
        XCTAssertTrue(session.wakeSourceIfAffordable(now: now.addingTimeInterval(1)))

        for _ in 0..<20 { session.retrySource(because: "network timeout", now: now) }
        XCTAssertEqual(session.sourceRetryAttempts, 6)
        XCTAssertEqual(session.sourceRetryAt.timeIntervalSince(now), 30, accuracy: 0.001)
        XCTAssertFalse(session.sourceUnusable)
        session.cancelled = true
        XCTAssertFalse(session.wakeSourceIfAffordable(now: now.addingTimeInterval(60)))
    }

    func testCachedRungMediaBypassesAdmissionButNotSessionCancellation() throws {
        let session = try ladderSession(rung1Playlist: playlist)
        defer { session.stop() }
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.testLinkBps = 600_000
        let media = try XCTUnwrap(TierRewrapper.rewrap(tsData: tierSegment, targetStartSeconds: 0))
        try media.initSegment.write(to: session.dir.appendingPathComponent("t1-init.mp4"))
        try media.mediaSegment.write(to: session.dir.appendingPathComponent("t1-seg0.m4s"))
        session.recordSupplierFailure(.rung(1), failure: .http(503))

        XCTAssertTrue(isFile(session.route("t1-init.mp4")))
        XCTAssertTrue(isFile(session.route("t1-seg0.m4s")))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/t1.m3u8"), 0)
        session.cancelled = true
        XCTAssertTrue(isNotFound(session.route("t1-init.mp4")))
        XCTAssertTrue(isNotFound(session.route("t1-seg0.m4s")))
    }

    func testCachedOriginalVideoAndAudioSurviveSourceUnavailability() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        let video = RemuxSession.Rendition(prefix: "", inputStreams: [], transcoder: nil)
        let audio = RemuxSession.Rendition(prefix: "a0", inputStreams: [], transcoder: nil)
        let media = try XCTUnwrap(TierRewrapper.rewrap(tsData: tierSegment, targetStartSeconds: 0))
        session.renditions = [video, audio]
        for rendition in session.renditions {
            rendition.completed.insert(0)
            try media.initSegment.write(to: session.dir.appendingPathComponent(rendition.initName))
            try media.mediaSegment.write(to: session.dir.appendingPathComponent(rendition.segmentName(0)))
        }
        session.sourceState = .unavailable
        session.wireLinkBps = 600_000

        XCTAssertTrue(isFile(session.initResponse()))
        XCTAssertTrue(isFile(session.segmentResponse(0)))
        XCTAssertTrue(isFile(session.initResponse(prefix: "a0")))
        XCTAssertTrue(isFile(session.segmentResponse(0, prefix: "a0")))
        XCTAssertNotNil(session.segmentURL(0))
        XCTAssertNotNil(session.segmentURL(0, prefix: "a0"))
        session.cancelled = true
        XCTAssertTrue(isNotFound(session.initResponse()))
        XCTAssertTrue(isNotFound(session.segmentResponse(0)))
        XCTAssertNil(session.segmentURL(0))
    }

    func testColdVideoDefersBeforeHeadersWithoutGatingEngineAudioByVideoBitrate() throws {
        let session = try ladderSession(rung1Playlist: playlist)
        defer { session.stop() }
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.sourceState = .ready
        session.sourceReady = true
        session.testLinkBps = 600_000
        session.renditions = [
            RemuxSession.Rendition(prefix: "", inputStreams: [], transcoder: nil),
            RemuxSession.Rendition(prefix: "a0", inputStreams: [], transcoder: nil),
        ]

        guard case .temporarilyUnavailable = session.initResponse() else { return XCTFail("cold video init must defer before headers") }
        guard case .temporarilyUnavailable = session.segmentResponse(0) else { return XCTFail("cold video segment must defer before headers") }
        guard case .temporarilyUnavailable = session.route("t1-init.mp4") else { return XCTFail("cold rung init must defer before headers") }
        guard case .temporarilyUnavailable = session.route("t1-seg0.m4s") else { return XCTFail("cold rung media must defer before headers") }
        guard case .streamed = session.initResponse(prefix: "a0") else { return XCTFail("audio init does not require capacity for the whole video") }
        guard case .segment = session.segmentResponse(0, prefix: "a0") else { return XCTFail("audio media does not require capacity for the whole video") }
    }

    func testSegmentWaiterFollowsTheRenditionAfterProducerRecovery() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.sourceState = .ready
        session.sourceReady = true
        session.renditions = [RemuxSession.Rendition(prefix: "", inputStreams: [], transcoder: nil)]
        let served = expectation(description: "the original waiter receives the recovered producer's segment")
        DispatchQueue.global().async {
            XCTAssertNotNil(session.segmentURL(0))
            served.fulfill()
        }
        settle {
            session.stateLock.lock()
            defer { session.stateLock.unlock() }
            return session.activeWaiters[0] != nil
        }
        let replacement = RemuxSession.Rendition(prefix: "", inputStreams: [], transcoder: nil)
        let media = try XCTUnwrap(TierRewrapper.rewrap(tsData: tierSegment, targetStartSeconds: 0))
        try media.mediaSegment.write(to: session.dir.appendingPathComponent("seg0.m4s"))
        session.stateLock.lock()
        replacement.completed.insert(0)
        session.renditions = [replacement]
        session.stateLock.unlock()
        wait(for: [served], timeout: 2)
    }

    func testSupplierFailuresAndSuccessesAreIsolated() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        let now = Date()
        for _ in 0..<12 { session.recordSupplierFailure(.rung(1), failure: .http(503), now: now) }
        session.recordSupplierFailure(.audio(0), failure: .invalidMedia, now: now)

        XCTAssertEqual(session.supplierRecovery[.rung(1)]?.failures, 6)
        XCTAssertEqual(try XCTUnwrap(session.supplierRecovery[.rung(1)]).retryAt.timeIntervalSince(now), 30, accuracy: 0.001)
        XCTAssertNil(session.supplierRecovery[.rung(0)])
        XCTAssertNil(session.supplierRecovery[.audio(1)])
        XCTAssertEqual(session.supplierRecovery.count, 2)
        guard let deferral = session.supplierResponseDeferral(.rung(1), now: now),
              case .temporarilyUnavailable = deferral else { return XCTFail("retry backoff must defer before headers") }
        XCTAssertNil(session.supplierResponseDeferral(.rung(1), now: now.addingTimeInterval(30)))
        session.recordSupplierSuccess(.rung(1))
        XCTAssertNil(session.supplierRecovery[.rung(1)])
        XCTAssertEqual(session.supplierRecovery[.audio(0)]?.failure, .invalidMedia)
        XCTAssertTrue(session.awaitSupplierRetry(.rung(1)))
        session.recordSupplierFailure(.rung(0), failure: .unsupported)
        XCTAssertFalse(session.awaitSupplierRetry(.rung(0)))
        XCTAssertNil(session.supplierResponseDeferral(.rung(1)))
    }

    func testAbandonedFetchDoesNotChangeSupplierHealth() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        let request = SegmentRequest()
        request.abandon()
        session.withFetchInterest("t0-1", request) {
            session.recordSupplierFetchFailure(.rung(0), status: 200, key: "t0-1", counted: true)
        }
        XCTAssertNil(session.supplierRecovery[.rung(0)])
        XCTAssertFalse(session.awaitSupplierRetry(.rung(0), request: request))
    }

    func testAudioBackoffDefersColdMediaButPreservesCachedMediaAndPlaylist() throws {
        let track = RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: audioUrl)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [track]))
        defer { session.stop() }
        session.wireLinkBps = 1
        session.sourceState = .unavailable
        session.audioLoSegments[0] = [TierSegment(duration: 6, url: "a-seg0.mp4")]
        session.recordSupplierFailure(.audio(0), failure: .http(503))
        guard case .temporarilyUnavailable = session.audioLoInitResponse(position: 0) else { return XCTFail("cold audio init must defer before headers") }
        guard case .temporarilyUnavailable = session.audioLoSegmentResponse(position: 0, n: 0) else { return XCTFail("cold audio media must defer before headers") }
        guard case .data = session.route("a0s.m3u8") else { return XCTFail("the valid cached audio playlist must remain available") }

        let fixtures = fixtureUrl.deletingLastPathComponent()
        let initData = try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-init.mp4"))
        let segmentData = try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-seg0.mp4"))
        let audio = try XCTUnwrap(TierRewrapper.rewrapAudio(initData: initData, segmentData: segmentData, targetStartSeconds: 0))
        try audio.initSegment.write(to: session.dir.appendingPathComponent("a0s-init.mp4"))
        try audio.mediaSegment.write(to: session.dir.appendingPathComponent("a0s-seg0.m4s"))
        XCTAssertTrue(isFile(session.audioLoInitResponse(position: 0)))
        XCTAssertTrue(isFile(session.audioLoSegmentResponse(position: 0, n: 0)))
        XCTAssertTrue(isNotFound(session.audioLoSegmentResponse(position: 0, n: 1)))
        XCTAssertTrue(isNotFound(session.audioLoInitResponse(position: 1)))
        session.cancelled = true
        XCTAssertTrue(isNotFound(session.audioLoInitResponse(position: 0)))
        XCTAssertTrue(isNotFound(session.audioLoSegmentResponse(position: 0, n: 0)))
    }

    func testAudioPlaylistFailureReturnsBackpressureAndDoesNotRefetchDuringBackoff() throws {
        TierServerStub.routes["/Audio/x/main.m3u8"] = (503, Data())
        let track = RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: audioUrl)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [track]))
        defer { session.stop() }
        guard case .temporarilyUnavailable = session.route("a0s.m3u8") else { return XCTFail("a temporary playlist failure must remain retryable") }
        guard case .temporarilyUnavailable = session.route("a0s.m3u8") else { return XCTFail("retry backoff must be reported before headers") }
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/main.m3u8"), 1)
        XCTAssertEqual(session.supplierRecovery[.audio(0)]?.failure, .http(503))
        XCTAssertTrue(isNotFound(session.route("a1s.m3u8")))
    }

    func testInvalidAudioInitIsNotCachedAndTheNextAttemptFetchesAReplacement() throws {
        let fixtures = fixtureUrl.deletingLastPathComponent()
        let validInit = try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-init.mp4"))
        let validSegment = try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-seg0.mp4"))
        TierServerStub.routes["/Audio/x/main.m3u8"] = (200, audioPlaylist)
        TierServerStub.routes["/Audio/x/a-init.mp4"] = (200, Data("invalid init".utf8))
        TierServerStub.routes["/Audio/x/a-seg0.mp4"] = (200, validSegment)
        let track = RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: audioUrl)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [track]))
        defer { session.stop() }

        XCTAssertNil(session.materializeAudioLoSegment(position: 0, n: 0))
        XCTAssertNil(session.audioLoInitData[0])
        XCTAssertNil(session.audioLoChain[0])
        XCTAssertEqual(session.supplierRecovery[.audio(0)]?.failure, .invalidMedia)
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/a-init.mp4"), 1)

        TierServerStub.routes["/Audio/x/a-init.mp4"] = (200, validInit)
        session.recordSupplierFailure(.audio(0), failure: .invalidMedia, now: Date().addingTimeInterval(-5))
        XCTAssertNotNil(session.materializeAudioLoSegment(position: 0, n: 0))
        XCTAssertEqual(session.audioLoInitData[0], validInit)
        XCTAssertNil(session.supplierRecovery[.audio(0)])
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/a-init.mp4"), 2)
    }

    func testRungPlaylistFailureIsTemporaryAndCanRecoverOnTheSameRoute() throws {
        let session = try ladderSession(rung1Playlist: playlist)
        defer { session.stop() }
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (503, Data())
        session.adoptTierGrid()
        guard case .temporarilyUnavailable = session.route("t1.m3u8") else { return XCTFail("a temporary rung failure must not become a missing rendition") }
        XCTAssertFalse(session.rungsUnavailable.contains(1))
        XCTAssertTrue(session.tierOffered)
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (200, playlist)
        session.recordSupplierFailure(.rung(1), failure: .transport, now: Date().addingTimeInterval(-5))
        guard case .data = session.route("t1.m3u8") else { return XCTFail("the same rendition can recover after backoff") }
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/t1.m3u8"), 2)
        XCTAssertTrue(isNotFound(session.route("t99.m3u8")))
    }

    func testAnAbandonedAudioRequestLeavesBackoffWithoutStartingItsInitFetch() throws {
        let track = RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: audioUrl)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [track]))
        defer { session.stop() }
        session.recordSupplierFailure(.audio(0), failure: .http(503))
        let request = SegmentRequest()
        request.abandon()
        XCTAssertNil(session.materializeAudioLoSegment(position: 0, n: 0, request: request))
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/main.m3u8"), 0)
        XCTAssertEqual(TierServerStub.hitCount("/Audio/x/a-init.mp4"), 0)
        XCTAssertEqual(session.supplierRecovery[.audio(0)]?.failures, 1)
    }

    func testAbandoningAudioCancelsItsInFlightInitWithoutPenalizingTheSupplier() throws {
        let server = try RawHTTPStub()
        defer { server.stop() }
        let initData = try Data(contentsOf: fixtureUrl.deletingLastPathComponent().appendingPathComponent("audio-carrier-init.mp4"))
        server.answer("/audio-init.mp4", .stalls(initData, sent: 16))
        let track = RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: "\(server.base)/main.m3u8")
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18, audioTracks: [track]))
        defer { session.stop() }
        session.audioLoSegments[0] = [TierSegment(duration: 6, url: "audio-seg0.mp4")]
        session.audioLoInitRemote[0] = URL(string: "\(server.base)/audio-init.mp4")
        let request = SegmentRequest()
        let serve = try provider(of: session.audioLoSegmentResponse(position: 0, n: 0))
        let returned = expectation(description: "the cancelled audio init fetch returns")
        DispatchQueue.global().async {
            XCTAssertNil(serve(request))
            returned.fulfill()
        }
        settle { server.requests("/audio-init.mp4") > 0 }
        XCTAssertEqual(server.requests("/audio-init.mp4"), 1)
        request.abandon()
        wait(for: [returned], timeout: 5)
        XCTAssertEqual(server.requests("/audio-seg0.mp4"), 0)
        XCTAssertNil(session.supplierRecovery[.audio(0)])
    }

    func testPublishingTheMasterDoesNotPreventSourceDormancy() throws {
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 2,
            audioTracks: [RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: audioUrl)],
            tierPlaylistUrl: playlistUrl, tierBandwidth: 260_000))
        defer { session.stop() }
        session.adoptedStarts = [0, 1]
        session.adoptedDurations = [1, 1]
        session.gridResolved = true
        session.copyAnnounced = true
        session.testLinkBps = 600_000
        XCTAssertTrue(session.releaseSource(because: "thin link"))
        XCTAssertTrue(session.isSourceReleased)
        guard case .temporarilyUnavailable = session.initResponse() else { return XCTFail("publishing the copy must not announce unready media") }
        session.cancelled = true
        session.testLinkBps = 40_000_000
        XCTAssertFalse(session.wakeSourceIfAffordable())
    }

    func testRungPlaylistsRemainAvailableBelowTheirMediaBudget() throws {
        let session = try ladderSession(rung1Playlist: playlist)
        defer { session.stop() }
        session.testLinkBps = 600_000
        session.start()
        waitForProbe(session)
        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("t1.m3u8"))
        guard case .data = session.route("t1.m3u8") else { return XCTFail("a rendition playlist is not gated by the video's transfer budget") }
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/t1.m3u8"), 1)
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/seg1.ts"), 0)
        session.stateLock.lock()
        session.testLinkBps = 30_000_000
        session.stateLock.unlock()
        guard case .data = session.route("t1.m3u8") else { return XCTFail("the same route must recover without a replacement session") }
    }

    /// An image subtitle is decoded on the device, so its source stays open whatever the link.
    func testATrackOnlyTheDemuxerServesKeepsTheSource() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let image = RemuxSubtitle(index: 3, name: "PGS", language: "eng", vttUrl: "", localVtt: "", isDefault: false, isForced: false, isImage: true, isEngineText: false, serverVttUrl: "")
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: audioUrl)],
                subtitles: [image],
                tierPlaylistUrl: playlistUrl, tierBandwidth: 1_700_000, tierCodecs: "avc1.4D401F,mp4a.40.2", tierWidth: 854, tierHeight: 480))
        s.testLinkBps = 2_000_000
        defer { s.stop() }
        s.start()
        settle { s.sourceRetryAttempts > 0 }
        XCTAssertTrue(s.demuxerOwesTracks)
        XCTAssertFalse(s.sourceUnusable)
        XCTAssertFalse(s.hasFailed)
        XCTAssertGreaterThan(s.sourceRetryAttempts, 0)
    }

    func testAnOpeningSourceFailureKeepsTheOriginalRetryableBesideTheRungs() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, _) = try session(serverAudioUrl: audioUrl, linkCeilingBps: 40_000_000)
        defer { s.stop() }
        var links: [[String: Any]] = []
        let lock = NSLock()
        s.onLink = { report in
            lock.lock()
            links.append(report)
            lock.unlock()
        }
        let master = s.masterPlaylist()
        XCTAssertTrue(s.isSourceReleased)
        XCTAssertFalse(s.hasFailed)
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertFalse(s.sourceUnusable)
        XCTAssertGreaterThan(s.sourceRetryAttempts, 0)
        XCTAssertTrue(master.contains("t0.m3u8"))
        s.noteFloorSample(bytes: 2_000_000, from: Date().addingTimeInterval(-1), to: Date())
        lock.lock()
        let listed = links.last?["copyListed"] as? Bool
        lock.unlock()
        XCTAssertEqual(listed, true)
    }

    func testARefusedProbeDoesNotPermanentlyDisableTheOriginal() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.finishLinkProbe(nil, reporting: false, failure: .unavailable(404))
        XCTAssertEqual(session.sourceProbeFailure, .unavailable(404))
        XCTAssertFalse(session.sourceUnusable)
    }

    func testServerVideoOnlyFallbackKeepsTheCatalogueWithoutOpeningTheSourceProducer() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        TierServerStub.routes["/Audio/x/main.m3u8"] = (200, audioPlaylist)
        TierServerStub.routes["/subtitles/3.vtt"] = (200, Data("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCaption\n".utf8))
        let fixtures = fixtureUrl.deletingLastPathComponent()
        TierServerStub.routes["/Audio/x/a-init.mp4"] = (200, try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-init.mp4")))
        TierServerStub.routes["/Audio/x/a-seg0.mp4"] = (200, try Data(contentsOf: fixtures.appendingPathComponent("audio-carrier-seg0.mp4")))
        let tracks = [
            RemuxAudioTrack(index: 1, name: "English", language: "eng", serverAudioUrl: audioUrl),
            RemuxAudioTrack(index: 2, name: "Spanish", language: "spa", serverAudioUrl: audioUrl + "&AudioStreamIndex=2"),
        ]
        var subtitle = RemuxSubtitle(index: 3, name: "Captions", language: "eng", vttUrl: "", localVtt: "",
                                     isDefault: false, isForced: false, isImage: false, isEngineText: true)
        subtitle.serverVttUrl = "http://tier.test/subtitles/3.vtt"
        var configuration = makeConfig(durationSeconds: 18, inputUrl: fixtureUrl.absoluteString,
                                       audioTracks: tracks, subtitles: [subtitle], tierPlaylistUrl: playlistUrl,
                                       tierBandwidth: 1_700_000, tierCodecs: "avc1.4D401F,mp4a.40.2", tierWidth: 854, tierHeight: 480)
        configuration.serverVideoOnly = true
        let session = try RemuxSession(config: configuration)
        defer { session.stop() }
        session.testLinkBps = 30_000_000
        let lock = NSLock()
        var stages: [String] = []
        session.onStage = { event in
            lock.lock()
            if let stage = event["stage"] as? String { stages.append(stage) }
            lock.unlock()
        }
        session.start()
        waitForProbe(session)
        let master = session.masterPlaylist()
        XCTAssertFalse(session.hasFailed)
        XCTAssertTrue(session.sourceUnusable)
        XCTAssertFalse(session.sourceReady)
        XCTAssertTrue(session.renditions.isEmpty)
        XCTAssertFalse(master.contains("\nmedia.m3u8\n"))
        XCTAssertTrue(master.contains("\nt0.m3u8\n"))
        XCTAssertTrue(master.contains("URI=\"a0s.m3u8\""))
        XCTAssertTrue(master.contains("URI=\"a1s.m3u8\""))
        XCTAssertTrue(master.contains("URI=\"sub3.m3u8\""))
        XCTAssertTrue(master.contains("NAME=\"English\""))
        XCTAssertTrue(master.contains("NAME=\"Spanish\""))
        lock.lock()
        let openedSource = stages.contains("open_input") || stages.contains("renditions_built")
        lock.unlock()
        XCTAssertFalse(openedSource)
        XCTAssertFalse(session.wakeSourceIfAffordable())
    }

    func testTheProbeDistinguishesTemporaryErrorsFromUnavailableSources() throws {
        let meter = LinkMeter(wanted: 1024, window: 1.5, settled: 0.75, plentyBps: 0, beside: TransferLedger())
        let url = try XCTUnwrap(URL(string: "http://tier.test/source"))
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil))
        let task = URLSession.shared.dataTask(with: url)
        var disposition: URLSession.ResponseDisposition?
        meter.urlSession(URLSession.shared, dataTask: task, didReceive: response) { disposition = $0 }
        XCTAssertEqual(meter.failure, .transient(503))
        XCTAssertFalse(try XCTUnwrap(meter.failure).usesServerTransferFallback)
        XCTAssertEqual(disposition, .cancel)
        XCTAssertEqual(meter.done.wait(timeout: .now()), .success)
        XCTAssertEqual(LinkProbeFailure.classify(status: 403), .authentication(403))
        XCTAssertEqual(LinkProbeFailure.classify(status: 404), .unavailable(404))
        XCTAssertEqual(LinkProbeFailure.classify(status: 410), .unavailable(410))
        XCTAssertEqual(LinkProbeFailure.classify(status: 416), .rangeUnsupported(416))
        XCTAssertEqual(LinkProbeFailure.classify(status: 429), .transient(429))
        XCTAssertNil(LinkProbeFailure.classify(status: 206))
    }

    /// Values from Libavutil/error.h: FFERRTAG(0xF8, a, b, c), negated.
    func testAnOpenErrorNoRetryFixesFailsTheSource() {
        let permanent: [Int32] = [-0x4D45_44F8, -0x4F52_50F8, -0x4345_44F8, -0x3030_34F8, -0x3130_34F8, -0x3330_34F8, -0x3430_34F8, -0x5858_34F8]
        for code in permanent { XCTAssertTrue(RemuxSession.isPermanentInputError(code), "\(code)") }
        // 429, 5XX, EIO, ETIMEDOUT and invalid data stay with the in-session retry.
        let retried: [Int32] = [-0x3932_34F8, -0x5858_35F8, -5, -60, -0x4144_4E49]
        for code in retried { XCTAssertFalse(RemuxSession.isPermanentInputError(code), "\(code)") }
    }

    // MARK: - The link rate

    func testRenditionFloorsRequestConfirmationWithoutChangingCapacity() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { s.stop() }
        s.finishLinkProbe(2_000_000, reporting: false)
        s.lastLinkProbeAt = .distantPast
        let t0 = Date()
        s.noteFloorSample(bytes: 300_000, from: t0, to: t0.addingTimeInterval(2))
        s.noteFloorSample(bytes: 300_000, from: t0, to: t0.addingTimeInterval(2))
        XCTAssertEqual(s.floorLinkBps ?? 0, 2_400_000, accuracy: 1, "600 KB over a shared 2s, not over 4s")
        XCTAssertEqual(s.pacedLinkBps, 2_000_000)
        s.noteFloorSample(bytes: 1_000_000, from: t0.addingTimeInterval(3), to: t0.addingTimeInterval(4))
        XCTAssertTrue(s.reprobeAsked)
        XCTAssertEqual(s.wireLinkBps, 2_000_000)
        s.noteFloorSample(bytes: 600_000, from: t0.addingTimeInterval(10), to: t0.addingTimeInterval(16))
        XCTAssertEqual(s.pacedLinkBps, 2_000_000)
        s.noteLinkSample(bytes: 600_000, seconds: 4)
        XCTAssertEqual(s.pacedLinkBps ?? 0, 1_200_000, accuracy: 1)
        XCTAssertEqual(s.wireLinkBps, s.pacedLinkBps)
        XCTAssertEqual(s.measuredLinkBps, s.wireLinkBps)
    }

    func testProbeCapacityIsTheSameSnapshotReportedToTheApp() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        var reports: [[String: Any]] = []
        session.onLink = { reports.append($0) }
        session.copyAnnounced = true
        session.finishLinkProbe(1_500_000, reporting: true)
        XCTAssertEqual(reports.last?["bps"] as? Double, session.wireLinkBps)
        XCTAssertEqual(session.wireLinkBps, session.pacedLinkBps)
        XCTAssertEqual(session.wireLinkBps, session.measuredLinkBps)
        XCTAssertEqual(reports.last?["copyListed"] as? Bool, true)

        session.noteLinkSample(bytes: 2_000_000, seconds: 1)
        XCTAssertEqual(session.wireLinkBps, 1_500_000)
        XCTAssertTrue(session.reprobeAsked)
        session.finishLinkProbe(30_000_000, reporting: true)
        XCTAssertEqual(reports.last?["bps"] as? Double, 30_000_000)
        XCTAssertEqual(session.wireLinkBps, session.measuredLinkBps)
        XCTAssertEqual(session.wireLinkBps, session.pacedLinkBps)

        session.cancelled = true
        let count = reports.count
        session.finishLinkProbe(600_000, reporting: true)
        session.noteLinkSample(bytes: 600_000, seconds: 4)
        session.noteFloorSample(bytes: 600_000, from: Date().addingTimeInterval(-4), to: Date())
        XCTAssertEqual(reports.count, count)
        XCTAssertEqual(session.wireLinkBps, 30_000_000)
    }

    func testUnavailableOriginalUsesMeasuredServerTransfersInBothDirections() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        let now = Date()
        session.finishLinkProbe(nil, reporting: false, failure: .unavailable(404))
        session.notePlaylistTransfer(bytes: 30_000, from: now, to: now.addingTimeInterval(0.2))
        XCTAssertEqual(session.wireLinkBps ?? 0, 1_200_000, accuracy: 1)
        session.noteFloorSample(bytes: 600_000, from: now, to: now.addingTimeInterval(1))
        XCTAssertEqual(session.wireLinkBps ?? 0, 4_800_000, accuracy: 1)
        session.noteFloorSample(bytes: 600_000, from: now.addingTimeInterval(10), to: now.addingTimeInterval(18))
        XCTAssertEqual(session.wireLinkBps ?? 0, 600_000, accuracy: 1)
        XCTAssertEqual(session.wireLinkBps, session.pacedLinkBps)

        session.finishLinkProbe(2_000_000, reporting: true)
        XCTAssertNil(session.sourceProbeFailure)
        session.noteFloorSample(bytes: 2_000_000, from: now.addingTimeInterval(30), to: now.addingTimeInterval(31))
        XCTAssertEqual(session.wireLinkBps, 2_000_000)
        XCTAssertEqual(session.pacedLinkBps, 2_000_000)
    }

    func testRetryingSourceUsesServerCapacityWithoutBeingMarkedUnsupported() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.retrySource(because: "connection reset")
        session.noteFloorSample(bytes: 600_000, from: Date().addingTimeInterval(-2), to: Date())
        XCTAssertNotNil(session.wireLinkBps)
        XCTAssertEqual(session.wireLinkBps, session.measuredLinkBps)
        XCTAssertFalse(session.sourceUnusable)
    }

    func testARecoveryObservationInsideTheProbeGapStaysQueued() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.finishLinkProbe(600_000, reporting: false)
        session.noteFloorSample(bytes: 600_000, from: Date().addingTimeInterval(-1), to: Date())
        XCTAssertTrue(session.reprobeAsked)
        XCTAssertEqual(session.wireLinkBps, 600_000)
    }

    /// Jellyfin's cues count from the file's start, which is session time: no anchor is taken off.
    func testServerCuesAreSessionTimeAsTheyArrive() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { s.stop() }
        let cues = RemuxSession.parseWebVTT("WEBVTT\n\n00:00:07.000 --> 00:00:09.000\nseven\n\n00:00:13.000 --> 00:00:14.000\nthirteen\n")
        let body = s.serverSubtitleBody(cues, from: 6, to: 12)
        XCTAssertTrue(body.contains("00:00:07.000 --> 00:00:09.000"))
        XCTAssertFalse(body.contains("thirteen"))
    }

    func testStoppingDuringTheProbeKillsTheServerTranscode() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let hold = DispatchSemaphore(value: 0)
        TierServerStub.holdSegments = hold
        let (s, _) = try session()
        let end = Date().addingTimeInterval(10)
        while Date() < end, !s.tierActive { usleep(20_000) }
        s.stop()
        hold.signal()
        XCTAssertTrue(TierServerStub.sawHit("/Videos/ActiveEncodings"), "a session that stops takes its server transcode with it")
    }
}
