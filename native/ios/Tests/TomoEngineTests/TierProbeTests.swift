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
        // Below the 8 Mbps source by default so the master lists the tier; nil leaves the real probe,
        // which cannot reach the stubbed source and so reads nothing.
        linkCeilingBps: Double? = 2_000_000,
        sourceRefused: Bool = false
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
                startOffsetSeconds: startOffsetSeconds
            ))
        s.testLinkBps = linkCeilingBps
        s.sourceRefused = sourceRefused
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
        // A copy segment a 2 Mb/s link cannot finish fails the whole item on AVPlayer's 6s deadline,
        // so a link below the source is offered the rung alone and climbs back by rebuilding.
        XCTAssertFalse(master.contains("media.m3u8"), "a link below the source lists no copy")
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

    func testPlaylistWithOneSegmentDeclinesTheTier() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, Data("#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n".utf8))
        let (s, reports) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertFalse(s.masterPlaylist().contains("t0.m3u8"))
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
        XCTAssertFalse(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("media.m3u8"), "the primary is still offered")
        XCTAssertNil(s.tierPlaylist(rung: 0))
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
        XCTAssertFalse(s.masterPlaylist().contains("t0.m3u8"))
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
        XCTAssertFalse(s.masterPlaylist().contains("t0.m3u8"))
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
        XCTAssertFalse(master.contains("media.m3u8"), "a link below the source lists no copy")
        XCTAssertTrue(s.tierOffered)
        XCTAssertEqual(states(reports()), ["listed"])
    }

    func testADroppedTierAnswersEveryOneOfItsRoutesWithNotFound() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (500, Data())
        let (s, _) = try session()
        defer { s.stop() }
        waitForProbe(s)
        XCTAssertNil(s.tierPlaylist(rung: 0))
        XCTAssertTrue(isNotFound(s.tierSegmentResponse(rung: 0, 0)))
        XCTAssertTrue(isNotFound(s.tierInitResponse(rung: 0)))
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
        let (s, reports) = try session(linkCeilingBps: 30_000_000)
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("media.m3u8"))
        XCTAssertTrue(master.contains("t0.m3u8"), "the rung stays listed for a later drop")
        XCTAssertLessThan(master.range(of: "media.m3u8")!.lowerBound, master.range(of: "t0.m3u8")!.lowerBound, "the copy is the startup variant")
        XCTAssertEqual(states(reports()), ["listed"])
    }

    // MARK: - The ladder

    private func ladderSession(rung1Playlist: Data) throws -> RemuxSession {
        TierServerStub.routes["/Videos/x/t0.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (200, rung1Playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
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

    // MARK: - Surround on the upper rungs

    private func surroundSession(hiUrl: String) throws -> RemuxSession {
        TierServerStub.routes["/Videos/x/t0.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/t1.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        var track = RemuxAudioTrack(index: 1, name: "Audio 1", language: "eng", serverAudioUrl: audioUrl)
        track.serverAudioHiUrl = hiUrl
        var upper = TierConfig(playlistUrl: "http://tier.test/Videos/x/t1.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 1_884_000, codecs: "avc1.64001F,mp4a.40.2", width: 854, height: 480)
        upper.audioHi = !hiUrl.isEmpty
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 18,
                audioTracks: [track],
                tiers: [TierConfig(playlistUrl: "http://tier.test/Videos/x/t0.m3u8?ApiKey=k&PlaySessionId=p", bandwidth: 496_000, codecs: "avc1.640015,mp4a.40.2", width: 426, height: 240), upper]))
        s.testLinkBps = 2_000_000
        return s
    }

    private func variantLine(_ master: String, before playlist: String) -> String {
        let lines = master.components(separatedBy: "\n")
        guard let index = lines.firstIndex(of: playlist), index > 0 else { return "" }
        return lines[index - 1]
    }

    /// The upper rung rides audio-hi and the lower one audio-lo, each group with every track.
    func testTheUpperRungsRideTheSurroundGroup() throws {
        let s = try surroundSession(hiUrl: "http://tier.test/Audio/x/hi.m3u8?ApiKey=k&PlaySessionId=h")
        defer { s.stop() }
        s.start()
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertTrue(master.contains("GROUP-ID=\"audio-hi\",NAME=\"Audio 1\""))
        XCTAssertTrue(master.contains("URI=\"a0h.m3u8\""))
        XCTAssertTrue(variantLine(master, before: "t1.m3u8").contains("AUDIO=\"audio-hi\""))
        XCTAssertTrue(variantLine(master, before: "t0.m3u8").contains("AUDIO=\"audio-lo\""))
        XCTAssertFalse(isNotFound(s.route("a0h-init.mp4")), "the hi group has its own routes")
        XCTAssertFalse(isNotFound(s.route("a0s-init.mp4")))
    }

    /// An item with no hi rendition gets the master it always got.
    func testAnItemWithoutSurroundHasNoHiGroup() throws {
        let s = try surroundSession(hiUrl: "")
        defer { s.stop() }
        s.start()
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertFalse(master.contains("audio-hi"))
        XCTAssertTrue(variantLine(master, before: "t1.m3u8").contains("AUDIO=\"audio-lo\""))
        XCTAssertTrue(isNotFound(s.route("a0h-init.mp4")))
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

    /// After the master has named the copy, a dead source no longer ends the session: the copy's
    /// routes answer 410, the rungs keep serving, and nothing asks for a rebuild toward the copy.
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
        XCTAssertTrue(isGone(s.segmentResponse(0)), "the copy is gone for good")
        XCTAssertTrue(isGone(s.initResponse()))
        XCTAssertFalse(isNotFound(s.tierSegmentResponse(rung: 0, 0)), "the rung still serves")
        XCTAssertTrue(s.reportsCopyListed, "nothing to climb back to")
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
        XCTAssertFalse(s.isTierDisabled, "a fetch the player gave up is not a failing tier")
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

        let plenty = try ladderSession(rung1Playlist: playlist)
        defer { plenty.stop() }
        plenty.testLinkBps = 30_000_000
        plenty.start()
        waitForProbe(plenty)
        _ = plenty.masterPlaylist()
        XCTAssertEqual(plenty.openingRung, 0, "a copy that leads has the link to itself")
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

    /// A probe that reads nothing is a slow link, never an unlimited one: the copy is withheld.
    func testALinkThatReadNothingWithholdsTheCopy() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, _) = try session(linkCeilingBps: nil)
        defer { s.stop() }
        waitForProbe(s)
        let master = s.masterPlaylist()
        XCTAssertFalse(master.contains("media.m3u8"), "an unmeasured link is not offered the copy")
        XCTAssertTrue(master.contains("t0.m3u8"))
    }

    /// A link under the copy, every audio track from the server, no track the demuxer owes: the
    /// source is let go, and a source that would never have opened costs the session nothing.
    func testASlowLinkLetsTheSourceGoAndTheSessionLives() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, _) = try session(serverAudioUrl: audioUrl)
        defer { s.stop() }
        settle { s.isSourceReleased }
        XCTAssertTrue(s.isSourceReleased)
        XCTAssertFalse(s.hasFailed, "the rungs carry a session whose source was let go")
        let master = s.masterPlaylist()
        XCTAssertFalse(master.contains("media.m3u8"))
        XCTAssertTrue(master.contains("t0.m3u8"))
        XCTAssertTrue(master.contains("GROUP-ID=\"audio-lo\""))
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
        // The source here never opens (file:///dev/null), and nothing else may carry the track.
        settle { s.hasFailed }
        XCTAssertFalse(s.isSourceReleased)
        XCTAssertTrue(s.hasFailed)
    }

    /// A source that will not open on a link that WOULD carry the copy: the rungs take the session
    /// before any master names the copy, and the app is not told there is a copy to climb back to.
    func testASourceThatWillNotOpenIsCarriedByTheRungs() throws {
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
        XCTAssertFalse(master.contains("media.m3u8"), "a copy that cannot be produced is never named")
        XCTAssertTrue(master.contains("t0.m3u8"))
        s.noteFloorSample(bytes: 2_000_000, from: Date().addingTimeInterval(-1), to: Date())
        lock.lock()
        let listed = links.last?["copyListed"] as? Bool
        lock.unlock()
        XCTAssertEqual(listed, true, "nothing to climb back to, so no rebuild is asked for")
    }

    /// A probe the server refuses is a source that is not there, not a slow link: no rebuild is
    /// asked for toward a copy nothing can produce.
    func testARefusedProbeLeavesNoCopyToClimbTo() throws {
        TierServerStub.routes["/Videos/x/main.m3u8"] = (200, playlist)
        TierServerStub.routes["/Videos/x/seg0.ts"] = (200, tierSegment)
        let (s, _) = try session(serverAudioUrl: audioUrl, linkCeilingBps: nil, sourceRefused: true)
        defer { s.stop() }
        settle { s.isSourceReleased }
        let master = s.masterPlaylist()
        XCTAssertTrue(s.isSourceReleased)
        XCTAssertFalse(master.contains("media.m3u8"))
        XCTAssertTrue(s.reportsCopyListed, "nothing to climb back to")
    }

    func testTheProbeReadsAnErrorStatusAsRefused() throws {
        let meter = LinkMeter(wanted: 1024, window: 1.5, settled: 0.75, plentyBps: 0, beside: TransferLedger())
        let url = try XCTUnwrap(URL(string: "http://tier.test/source"))
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil))
        let task = URLSession.shared.dataTask(with: url)
        var disposition: URLSession.ResponseDisposition?
        meter.urlSession(URLSession.shared, dataTask: task, didReceive: response) { disposition = $0 }
        XCTAssertTrue(meter.refused)
        XCTAssertEqual(disposition, .cancel)
        XCTAssertEqual(meter.done.wait(timeout: .now()), .success)
    }

    // MARK: - The link rate

    /// Server renditions are a floor under the link: overlapping transfers share one span, a
    /// floor raises the rate and never lowers it, and only a read of the wire brings it down.
    func testRenditionTransfersAreAFloorCountedOverTheirUnion() throws {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { s.stop() }
        let t0 = Date()
        // A rung segment and its audio, downloading together for the same two seconds.
        s.noteFloorSample(bytes: 300_000, from: t0, to: t0.addingTimeInterval(2))
        s.noteFloorSample(bytes: 300_000, from: t0, to: t0.addingTimeInterval(2))
        XCTAssertEqual(s.pacedLinkBps ?? 0, 2_400_000, accuracy: 1, "600 KB over a shared 2s, not over 4s")
        // Slower renditions later (the server's encoder, not the wire) leave the rate alone.
        s.noteFloorSample(bytes: 600_000, from: t0.addingTimeInterval(10), to: t0.addingTimeInterval(16))
        XCTAssertEqual(s.pacedLinkBps ?? 0, 2_400_000, accuracy: 1)
        // A read of the source itself is the wire, and may lower it.
        s.noteLinkSample(bytes: 600_000, seconds: 4)
        XCTAssertEqual(s.pacedLinkBps ?? 0, 1_200_000, accuracy: 1)
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
