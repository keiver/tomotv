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

/// The tier is proved before the master lists it, and retired when the server stops delivering.
/// Every case here is a way a Jellyfin server refuses to transcode: no ffmpeg, a dead encoder,
/// a policy that answers the playlist but not the segments.
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
        tierFirst: Bool = true,
        startOffsetSeconds: Double = 0
    ) throws -> (RemuxSession, () -> [[String: Any]]) {
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                audioTracks: [RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: serverAudioUrl)],
                tierPlaylistUrl: tierPlaylistUrl ?? playlistUrl,
                tierBandwidth: 1_700_000,
                tierCodecs: "avc1.4D401F,mp4a.40.2",
                tierWidth: 854,
                tierHeight: 480,
                tierFirst: tierFirst,
                startOffsetSeconds: startOffsetSeconds
            ))
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

    private func waitForProbe(_ s: RemuxSession) {
        let end = Date().addingTimeInterval(10)
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
        default: return nil
        }
    }


    private func isNotFound(_ response: LocalHTTPResponse) -> Bool {
        if case .notFound = response { return true }
        return false
    }

    // MARK: - The tier is proved before it is offered

    func testHealthyTierIsListedAndItsOpeningSegmentIsAlreadyOnDisk() throws {
        XCTAssertFalse(tierSegment.isEmpty, "Fixtures/tier-segment.mpegts is missing")
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)

        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t1.m3u8"))
        XCTAssertLessThan(master.range(of: "t1.m3u8")!.lowerBound, master.range(of: "media.m3u8")!.lowerBound, "a tier-first session leads with the tier")
        XCTAssertEqual(states(reports()), ["listed"])
        XCTAssertNotNil(s.tierPlaylist())

        // The probe's fetch is the one AVPlayer would have made: the segment and the init it
        // carries are on disk, and asking for them again does not go back to the server.
        XCTAssertTrue(isFile(s.tierInitResponse()), "the probe left the init on disk")
        XCTAssertNotNil(resolve(s.tierInitResponse()))
        XCTAssertEqual(TierServerStub.hitCount("/Videos/x/seg0.ts"), 1, "the opening segment is fetched once, by the probe")
    }

    func testPlaylistRefusedDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (404, Data())
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t1.m3u8"))
        XCTAssertEqual(states(reports()), ["declined"])
        XCTAssertEqual(reports().first?["reason"] as? String, "playlist fetch failed")
    }

    func testPlaylistWithOneSegmentDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, Data("#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n".utf8))
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t1.m3u8"))
        XCTAssertEqual(reports().first?["reason"] as? String, "playlist held 1 segments")
        XCTAssertFalse(TierServerStub.hits.contains("/Videos/x/seg0.ts"), "an unadopted grid is never probed")
    }

    func testOpeningSegmentRefusedDeclinesTheTierBeforeTheMaster() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertTrue(TierServerStub.hits.contains("/Videos/x/seg0.ts"))
        XCTAssertTrue(TierServerStub.sawHit("/Videos/ActiveEncodings"), "the transcode the probe started is killed")
        let master = s.masterPlaylist()
        XCTAssertFalse(master.contains("t1.m3u8"))
        XCTAssertTrue(master.contains("media.m3u8"), "the primary is still offered")
        XCTAssertNil(s.tierPlaylist())
        XCTAssertEqual(states(reports()), ["declined"])
        XCTAssertEqual(reports().first?["reason"] as? String, "opening segment 0 HTTP 500")
    }

    /// A dead link answers with no status at all. The tier is still declined, but nothing is
    /// counted as a structural failure: on a slow link the tier is the one variant that fits.
    func testTransportErrorOnTheOpeningSegmentDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.transportErrors.insert("/Videos/x/seg0.ts")
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t1.m3u8"))
        XCTAssertEqual(states(reports()), ["declined"])
        XCTAssertEqual(reports().first?["reason"] as? String, "opening segment 0 timed out")
    }

    /// A server that answers with something that is not a transport stream (an error page).
    func testUnrewrappableOpeningSegmentDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, Data("<html>no transcoder</html>".utf8))
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t1.m3u8"))
        XCTAssertEqual(states(reports()), ["declined"])
        XCTAssertEqual(reports().first?["reason"] as? String, "opening segment 0 rewrap failed")
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

    func testTierListedThenRefusedIsReportedDropped() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let hold = DispatchSemaphore(value: 0)
        TierServerStub.holdSegments = hold
        let (s, reports) = try session()
        defer { s.stop() }
        let end = Date().addingTimeInterval(10)
        while Date() < end, !s.tierActive { usleep(20_000) }
        XCTAssertTrue(s.tierActive)
        // The probe is parked on the held segment: the master lists the tier as unproven.
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t1.m3u8"))
        XCTAssertLessThan(master.range(of: "t1.m3u8")!.lowerBound, master.range(of: "media.m3u8")!.lowerBound, "tier first")
        XCTAssertEqual(states(reports()), ["listed"])
        hold.signal()
        waitForProbe(s)
        XCTAssertEqual(states(reports()), ["listed", "dropped"])
        XCTAssertEqual(reports().last?["reason"] as? String, "opening segment 0 HTTP 500")
        XCTAssertFalse(s.tierOffered)
    }

    func testADroppedTierAnswersEveryOneOfItsRoutesWithNotFound() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, _) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertNil(s.tierPlaylist())
        XCTAssertTrue(isNotFound(s.tierSegmentResponse(0)))
        XCTAssertTrue(isNotFound(s.tierInitResponse()))
        XCTAssertTrue(isNotFound(s.audioLoInitResponse(position: 0)))
        XCTAssertTrue(isNotFound(s.audioLoSegmentResponse(position: 0, n: 0)))
    }

    /// The audio the tier rides on is server-fed too: its refusals retire the tier the same way.
    func testAudioRefusalsRetireTheTier() throws {
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

        // Two refusals is the limit the session carries for structural failures.
        resolve(s.audioLoInitResponse(position: 0))
        XCTAssertTrue(s.tierOffered, "one refusal is not enough to retire it")
        resolve(s.audioLoInitResponse(position: 0))
        XCTAssertFalse(s.tierOffered)
        XCTAssertEqual(states(reports()), ["listed", "dropped"])
        XCTAssertEqual(reports().last?["reason"] as? String, "audio HTTP 500, after 2 failures")
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
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        _ = s.masterPlaylist()
        // Nothing a later request does can turn a tier the viewer never saw into a drop.
        _ = s.tierSegmentResponse(1)
        _ = s.tierSegmentResponse(2)
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
        XCTAssertFalse(master.contains("t1.m3u8"))
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertTrue(reports.isEmpty)
        XCTAssertTrue(TierServerStub.hits.isEmpty, "no server was touched")
        XCTAssertNil(s.tierPlaylist())
    }

    /// A tier listed second is still proved: the ordering is the only difference.
    func testATierListedSecondIsStillProved() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, reports) = try session(tierFirst: false)
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("t1.m3u8"))
        XCTAssertLessThan(master.range(of: "media.m3u8")!.lowerBound, master.range(of: "t1.m3u8")!.lowerBound, "primary first")
        XCTAssertEqual(states(reports()), ["listed"])
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
