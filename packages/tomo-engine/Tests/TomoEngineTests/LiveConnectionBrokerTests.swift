import Foundation
import XCTest
@testable import TomoEngine

/// The connection budget: its rules on their own, then the real grab and live session against relay.py capped at
/// one reader (refuse and kick, the two ways providers enforce it), with the relay's own count as the witness.
final class LiveConnectionBrokerTests: XCTestCase {
    func testAKeyFromAUrlCarriesThePortSoTwoServersOnOneAddressNeverShareABudget() {
        XCTAssertEqual(LiveConnectionBroker.key(forURL: "http://192.168.1.2:9191/live/one/pass/4"), "192.168.1.2:9191")
        XCTAssertEqual(LiveConnectionBroker.key(forURL: "http://192.168.1.2:8096/Videos/ch/stream"), "192.168.1.2:8096")
        XCTAssertEqual(LiveConnectionBroker.key(forURL: "https://provider.example/live.ts"), "provider.example")
        XCTAssertEqual(LiveConnectionBroker.key(forURL: "not a url"), "-")
    }

    func testAnUnbudgetedKeyAdmitsEveryReader() {
        let broker = LiveConnectionBroker()
        let leases = (0 ..< 5).compactMap { _ in broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {}) }
        XCTAssertEqual(leases.count, 5)
    }

    func testTheSweepNeverTakesAFullBudget() {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "k")
        let first = broker.tryAcquire(key: "k", priority: .ring, onRevoke: {})
        XCTAssertNotNil(first)
        XCTAssertNil(broker.tryAcquire(key: "k", priority: .playback, onRevoke: {}))
        first?.release()
        XCTAssertNotNil(broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {}))
    }

    func testPlaybackWaitsForTheRevokedReadToCloseBeforeItsOwnOpens() {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "k")
        var countAtRevoke = -1
        var sweep: LiveConnectionBroker.Lease?
        sweep = broker.tryAcquire(key: "k", priority: .sweep) {
            countAtRevoke = broker.activeCount(for: "k")
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { sweep?.release() }
        }
        let started = Date()
        let playback = broker.acquire(key: "k", priority: .playback, timeout: 5, onRevoke: {})
        XCTAssertNotNil(playback)
        XCTAssertEqual(countAtRevoke, 1, "the revoked read still held its slot when told to yield")
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.3, "granted before the revoked read closed")
        XCTAssertEqual(broker.activeCount(for: "k"), 1)
    }

    func testPlaybackWaitsOutThePlaybackItReplaces() {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "k")
        let previous = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { previous?.release() }
        XCTAssertNotNil(broker.acquire(key: "k", priority: .playback, timeout: 5, onRevoke: {}))
        XCTAssertEqual(broker.activeCount(for: "k"), 1)
    }

    func testNothingTakesPlaybacksSlot() {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "k")
        var revoked = false
        let playback = broker.tryAcquire(key: "k", priority: .playback) { revoked = true }
        XCTAssertNotNil(playback)
        XCTAssertNil(broker.acquire(key: "k", priority: .ring, timeout: 0.2, onRevoke: {}))
        XCTAssertFalse(revoked)
    }

    func testAPreviewThePlayerAdoptedKeepsItsSlotFromTheRing() {
        let broker = LiveConnectionBroker()
        broker.setBudget(2, for: "k")
        var revoked = false
        let preview = broker.tryAcquire(key: "k", priority: .preview) { revoked = true }
        XCTAssertNotNil(preview)
        broker.setPriority(.playback, of: preview!)
        _ = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        XCTAssertNil(broker.acquire(key: "k", priority: .ring, timeout: 0.2, onRevoke: {}))
        XCTAssertFalse(revoked)
    }

    func testARevokedReadThatNeverClosesTimesTheAskerOut() {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "k")
        let stuck = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})
        XCTAssertNotNil(stuck)
        XCTAssertNil(broker.acquire(key: "k", priority: .playback, timeout: 0.3, onRevoke: {}))
        XCTAssertEqual(broker.activeCount(for: "k"), 1)
    }

    func testARefusalWhileOthersAreHeldLearnsTheLimitAndRevokesTheReadsBelow() {
        let broker = LiveConnectionBroker()
        var sweepRevoked = false
        let sweep = broker.tryAcquire(key: "k", priority: .sweep) { sweepRevoked = true }
        let playback = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        XCTAssertNotNil(sweep)
        XCTAssertTrue(broker.noteRefusal(of: playback!))
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertTrue(sweepRevoked)
    }

    func testARefusalWithNothingElseHeldIsNotALimit() {
        let broker = LiveConnectionBroker()
        let alone = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        XCTAssertFalse(broker.noteRefusal(of: alone!))
        XCTAssertNil(broker.budget(for: "k"))
    }

    func testAnInputDroppedRightAfterAnotherReadOpenedIsAKick() {
        let broker = LiveConnectionBroker()
        let playback = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})!
        Thread.sleep(forTimeInterval: 0.01)
        var ringRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .ring) { ringRevoked = true }
        broker.noteLost(playback)
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertTrue(ringRevoked)
    }

    func testAnInputDroppedWithNothingElseHeldIsNoLimit() {
        let broker = LiveConnectionBroker()
        let alone = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})!
        broker.noteLost(alone)
        XCTAssertNil(broker.budget(for: "k"))
    }

    /// Either side of a fresh pair can be the one the origin kicks: the newer open itself, or the older read beside it.
    func testTheNewerOfAFreshPairDroppingIsAKickToo() {
        let broker = LiveConnectionBroker()
        var ringRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .ring) { ringRevoked = true }
        Thread.sleep(forTimeInterval: 0.01)
        let playback = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})!
        broker.noteLost(playback)
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertTrue(ringRevoked)
    }

    func testAPreviewLeavesTheSweepASlot() {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "one")
        XCTAssertNil(broker.acquire(key: "one", priority: .preview, timeout: 0.2, onRevoke: {}))
        broker.setBudget(2, for: "two")
        XCTAssertNotNil(broker.acquire(key: "two", priority: .preview, timeout: 0.2, onRevoke: {}))
        XCTAssertNotNil(broker.tryAcquire(key: "two", priority: .sweep, onRevoke: {}))
        XCTAssertNotNil(broker.tryAcquire(key: "free", priority: .preview, onRevoke: {}))
    }

    func testABudgetSetUnderTheReadsHeldRevokesTheLowestOnesAndNeverPlayback() {
        let broker = LiveConnectionBroker()
        var sweepRevoked = false
        var previewRevoked = false
        var ringRevoked = false
        var playbackRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .sweep) { sweepRevoked = true }
        _ = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }
        _ = broker.tryAcquire(key: "k", priority: .ring) { ringRevoked = true }
        _ = broker.tryAcquire(key: "k", priority: .playback) { playbackRevoked = true }
        broker.setBudget(2, for: "k")
        XCTAssertTrue(sweepRevoked)
        XCTAssertTrue(previewRevoked)
        XCTAssertFalse(ringRevoked)
        XCTAssertFalse(playbackRevoked)
        broker.setBudget(1, for: "k")
        XCTAssertTrue(ringRevoked)
        XCTAssertFalse(playbackRevoked)
    }

    func testAPlainReleaseCountsAsARecentCloseForTheNextRefusedOpen() {
        let broker = LiveConnectionBroker()
        let previous = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        XCTAssertFalse(broker.recentlyClosed(key: "k", within: 15))
        previous?.release()
        XCTAssertTrue(broker.recentlyClosed(key: "k", within: 15))
        XCTAssertFalse(broker.recentlyClosed(key: "k", within: 0))
    }

    func testARefusalThatTeachesNoNumberStillMakesRoom() {
        let broker = LiveConnectionBroker()
        var sweepRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .sweep) { sweepRevoked = true }
        let playback = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        XCTAssertTrue(broker.noteRefusal(of: playback!, learn: false))
        XCTAssertNil(broker.budget(for: "k"))
        XCTAssertTrue(sweepRevoked)
    }

    func testANeighbourRefusedBesideOnlyPlaybackGetsNoRoom() {
        let broker = LiveConnectionBroker()
        var playbackRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .playback) { playbackRevoked = true }
        let ring = broker.tryAcquire(key: "k", priority: .ring, onRevoke: {})
        XCTAssertFalse(broker.noteRefusal(of: ring!))
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertFalse(playbackRevoked)
    }

    func testPlaybackRefusedBesideThePlaybackItReplacesWaitsForRoom() {
        let broker = LiveConnectionBroker()
        _ = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        let next = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        XCTAssertTrue(broker.noteRefusal(of: next!))
        XCTAssertEqual(broker.budget(for: "k"), 1)
    }

    // MARK: - Against a capped origin

    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    private static let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Fixtures/tier-segment.mpegts")

    private struct Relay {
        let processes: [Process]
        let url: String
        let port: Int

        func stats() throws -> [String: Int] {
            let data = try Data(contentsOf: URL(string: "http://127.0.0.1:\(port)/stats")!)
            return try JSONDecoder().decode([String: Int].self, from: data)
        }

        func stop() { processes.forEach { $0.terminate() } }
    }

    /// `status` is the refusal's status line; `lagMs` is how long the relay keeps counting a closed reader; `holdMs` has
    /// an admitted reader sent nothing that long and then closed (the 200 first when `holdHeaders`); `pace` feeds each
    /// reader at a fraction of the live rate for its first seconds, in `paceSlice` packets at a time.
    private func cappedRelay(mode: String, port: Int, status: String = "403 Forbidden", lagMs: Int = 0, holdMs: Int = 0, holdHeaders: Bool = false,
                             pace: String = "", paceSlice: Int = 350) throws -> Relay {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("needs \(Self.ffmpeg)") }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("broker-relay-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("{\"channels\":[{\"id\":\"cap\",\"port\":\(port)}]}".utf8).write(to: dir.appendingPathComponent("lineup.json"))
        let relay = Process()
        relay.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        relay.arguments = ["python3", Self.repo.appendingPathComponent("scripts/demo-livetv/relay.py").path, dir.path]
        relay.environment = ProcessInfo.processInfo.environment.merging(
            ["RELAY_MAX_READERS": "1", "RELAY_CAP_MODE": mode, "RELAY_CAP_STATUS": status, "RELAY_RELEASE_LAG_MS": String(lagMs),
             "RELAY_HOLD_MS": String(holdMs), "RELAY_HOLD_HEADERS": holdHeaders ? "1" : "0", "RELAY_PACE": pace,
             "RELAY_PACE_SLICE": String(paceSlice)]) { $1 }
        relay.standardOutput = FileHandle.nullDevice
        try relay.run()
        // The feed connects once and exits on a refusal, and a cold python takes over a second to listen.
        let listening = Relay(processes: [relay], url: "", port: port)
        let up = Date().addingTimeInterval(10)
        while (try? listening.stats()) == nil, Date() < up { Thread.sleep(forTimeInterval: 0.05) }
        let feed = Process()
        feed.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        feed.arguments = ["-v", "error", "-re", "-stream_loop", "-1", "-i", Self.fixture.path, "-c", "copy", "-f", "mpegts", "tcp://127.0.0.1:\(port + 100)"]
        feed.standardError = FileHandle.nullDevice
        try feed.run()
        Thread.sleep(forTimeInterval: 3)
        return Relay(processes: [feed, relay], url: "http://127.0.0.1:\(port)/live.ts", port: port)
    }

    private func frameQueue() throws -> LiveFrameQueue {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("broker-frames-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return LiveFrameQueue(root: root)
    }

    /// A grab reading the origin when playback asks: the grab is cancelled, playback's session opens and keeps
    /// reading. The origin frees its count a moment after the grab closes, so it may refuse playback's first open
    /// (retried) or kick the connection already closed; neither may cost playback its stream.
    private func assertPlaybackTakesTheSweepsConnection(mode: String, port: Int) throws {
        let relay = try cappedRelay(mode: mode, port: port)
        defer { relay.stop() }
        let key = "capped-\(mode)"
        LiveConnectionBroker.shared.setBudget(1, for: key)
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }

        let queue = try frameQueue()
        let reading = XCTestExpectation(description: "grab reading")
        let grabbed = XCTestExpectation(description: "grab done")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "sweep", inputUrl: relay.url, headers: [:], deadline: 12, span: 36, interval: 3, count: 12,
                      originKey: key, priority: .sweep, frame: { _, _ in reading.fulfill() }) {
            outcome = $0
            grabbed.fulfill()
        }
        wait(for: [reading], timeout: 10)

        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        config.livePriority = .playback
        let session = try RemuxSession(config: config)
        var failure: String?
        session.onFailed = { failure = $0["message"] as? String }
        session.start()
        defer { session.stop() }

        wait(for: [grabbed], timeout: 15)
        if case .cancelled? = outcome {} else { XCTFail("the grab was not cancelled: \(String(describing: outcome))") }
        Thread.sleep(forTimeInterval: 4)
        XCTAssertNil(failure, "playback failed: \(failure ?? "")")
        let stats = try relay.stats()
        XCTAssertEqual(stats["peak"], 1, "the origin counted two readers: \(stats)")
        XCTAssertEqual(stats["active"], 1, "playback is not reading: \(stats)")
        print("[LiveConnectionBroker] \(mode): \(stats)")
    }

    /// Nothing known about the origin: playback's open is refused while the grab holds the only connection. The
    /// grab yields and playback's retry gets in; a 4xx teaches the limit, a 5xx teaches no number.
    func testARefusedPlaybackTeachesTheLimitAndTakesTheGrabsConnection() throws {
        try assertARefusedPlaybackTakesTheGrabsConnection(status: "403 Forbidden", learns: true, port: 19562)
    }

    func testAPlaybackRefusedWith429TeachesTheLimitAndTakesTheGrabsConnection() throws {
        try assertARefusedPlaybackTakesTheGrabsConnection(status: "429 Too Many Requests", learns: true, port: 19722)
    }

    func testAPlaybackRefusedWith503TakesTheGrabsConnectionAndLearnsNoNumber() throws {
        try assertARefusedPlaybackTakesTheGrabsConnection(status: "503 Service Unavailable", learns: false, port: 19732)
    }

    private func assertARefusedPlaybackTakesTheGrabsConnection(status: String, learns: Bool, port: Int) throws {
        let relay = try cappedRelay(mode: "refuse", port: port, status: status)
        defer { relay.stop() }
        let key = "learn-refuse-\(port)"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let queue = try frameQueue()
        let reading = XCTestExpectation(description: "grab reading")
        let grabbed = XCTestExpectation(description: "grab done")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "sweep", inputUrl: relay.url, headers: [:], deadline: 12, span: 36, interval: 3, count: 12,
                      originKey: key, frame: { _, _ in reading.fulfill() }) {
            outcome = $0
            grabbed.fulfill()
        }
        wait(for: [reading], timeout: 10)
        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        let session = try RemuxSession(config: config)
        var failure: String?
        session.onFailed = { failure = $0["message"] as? String }
        session.start()
        defer { session.stop() }
        wait(for: [grabbed], timeout: 15)
        if case .cancelled? = outcome {} else { XCTFail("the grab did not yield: \(String(describing: outcome))") }
        Thread.sleep(forTimeInterval: 5)
        XCTAssertNil(failure, "playback failed: \(failure ?? "")")
        XCTAssertEqual(LiveConnectionBroker.shared.budget(for: key), learns ? 1 : nil, "\(status)")
        let stats = try relay.stats()
        XCTAssertEqual(stats["active"], 1, "playback is not reading: \(stats)")
    }

    /// Nothing known about the origin, which keeps counting a closed reader for a while: the channel the viewer just
    /// left still holds the only connection when the next one opens. The refusal is the origin catching up; the retry gets in.
    func testPlaybackReplacingPlaybackOpensWhileTheOriginStillCountsTheClosedRead() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19742, status: "429 Too Many Requests", lagMs: 1500)
        defer { relay.stop() }
        let key = "lagging-release"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        config.livePriority = .playback
        let previous = try RemuxSession(config: config)
        previous.start()
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(try relay.stats()["active"], 1, "the first channel is not reading")
        previous.stop()
        Thread.sleep(forTimeInterval: 0.2)
        let next = try RemuxSession(config: config)
        var failure: String?
        next.onFailed = { failure = $0["message"] as? String }
        next.start()
        defer { next.stop() }
        Thread.sleep(forTimeInterval: 6)
        XCTAssertNil(failure, "the next channel failed: \(failure ?? "")")
        let stats = try relay.stats()
        XCTAssertGreaterThanOrEqual(stats["refused"] ?? 0, 1, "the origin never refused the open: \(stats)")
        XCTAssertEqual(stats["active"], 1, "the next channel is not reading: \(stats)")
    }

    /// A 404 beside another read is a dead channel, not the origin's cap: nothing is learned and nothing yields.
    func testA404BesideAnotherReadTeachesNothing() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19752, status: "404 Not Found")
        defer { relay.stop() }
        let key = "dead-channel"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let occupier = try occupy(relay, key: key)
        defer { occupier.stop() }
        XCTAssertEqual(try relay.stats()["active"], 1, "the relay is not occupied")
        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        config.livePriority = .playback
        let session = try RemuxSession(config: config)
        let failed = XCTestExpectation(description: "404")
        var failure: String?
        session.onFailed = {
            failure = $0["message"] as? String
            failed.fulfill()
        }
        session.start()
        defer { session.stop() }
        wait(for: [failed], timeout: 10)
        XCTAssertTrue(failure?.contains("404") == true, "\(failure ?? "no failure")")
        XCTAssertNil(LiveConnectionBroker.shared.budget(for: key))
        XCTAssertEqual(try relay.stats()["active"], 1, "the occupier was made to yield")
    }

    /// A grab refused with a 429 beside playback for its whole fight teaches the limit the same as a 403 does. The open
    /// is tried again every second to the deadline and the answer is a refusal, never the server's copy, which reads
    /// the origin on the same account.
    func testAGrabRefusedWith429TeachesTheLimitAndNeverReadsTheServerCopy() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19762, status: "429 Too Many Requests")
        defer { relay.stop() }
        let key = "grab-429"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let playing = try occupy(relay, key: key)
        defer { playing.stop() }
        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "refused-429", inputUrl: relay.url, headers: [:], deadline: 6, span: 9, interval: 3, count: 4, originKey: key,
                      fallbackUrl: Self.fixture.absoluteString) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .refused(let failure)? = outcome else { return XCTFail("the grab was not refused: \(String(describing: outcome))") }
        XCTAssertTrue(failure?.contains("429") == true, "\(failure ?? "no failure")")
        XCTAssertEqual(LiveConnectionBroker.shared.budget(for: key), 1)
        let stats = try relay.stats()
        XCTAssertGreaterThanOrEqual(stats["refused"] ?? 0, 4, "the open was not tried again through the deadline: \(stats)")
        XCTAssertEqual(stats["active"], 1, "playback was made to yield")
    }

    /// The origin keeps counting a closed reader for a while, here 10 s: the grab after one it just closed keeps
    /// retrying for its deadline, the refusals off the clock, and gets in once the count clears.
    func testAGrabRefusedRightAfterACloseKeepsRetryingUntilItOpens() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19772, status: "429 Too Many Requests", lagMs: 10000)
        defer { relay.stop() }
        let key = "grab-after-close"
        LiveConnectionBroker.shared.setBudget(1, for: key)
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let queue = try frameQueue()
        let first = XCTestExpectation(description: "first grab")
        queue.request(channelId: "first", inputUrl: relay.url, headers: [:], deadline: 12, span: 3, interval: 3, count: 2, originKey: key) { _ in first.fulfill() }
        wait(for: [first], timeout: 15)
        let second = XCTestExpectation(description: "second grab")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "second", inputUrl: relay.url, headers: [:], deadline: 12, span: 3, interval: 3, count: 2, originKey: key) {
            outcome = $0
            second.fulfill()
        }
        wait(for: [second], timeout: 30)
        guard case .frames? = outcome else { return XCTFail("the retry did not open: \(String(describing: outcome))") }
        let stats = try relay.stats()
        XCTAssertGreaterThanOrEqual(stats["refused"] ?? 0, 5, "the grab gave up before the count cleared: \(stats)")
        XCTAssertEqual(stats["admitted"], 2, "\(stats)")
    }

    /// No connection spare on a provider: the grab waits its deadline for one to free, asks the origin nothing, and
    /// answers busy, so the channel stays due.
    func testAGrabWithNoConnectionSpareAnswersBusyWithoutAnOpen() throws {
        let key = "busy-\(UUID().uuidString)"
        let broker = LiveConnectionBroker.shared
        broker.setBudget(1, for: key)
        defer { broker.setBudget(0, for: key) }
        let held = try XCTUnwrap(broker.tryAcquire(key: key, priority: .ring, onRevoke: {}))
        defer { held.release() }
        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        let started = Date()
        queue.request(channelId: "busy", inputUrl: Self.unopenable, headers: [:], deadline: 1, originKey: key) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        guard case .busy? = outcome else { return XCTFail("the grab did not answer busy: \(String(describing: outcome))") }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 1, "the grab did not wait for a connection")
    }

    /// An origin admits the read and sends nothing while its channel starts: the grab waits on the origin past its own
    /// deadline, and the origin's close of the open is the channel's own answer (`ended`), never a refusal.
    func testAGrabTheOriginAdmitsAndHoldsWaitsForTheOriginToEndIt() throws {
        try assertAHeldOpenWaitsForTheOrigin(port: 19802, headers: false)
    }

    func testAGrabTheOriginAdmitsWithA200AndHoldsWaitsForTheOriginToEndIt() throws {
        try assertAHeldOpenWaitsForTheOrigin(port: 19812, headers: true)
    }

    private func assertAHeldOpenWaitsForTheOrigin(port: Int, headers: Bool) throws {
        let relay = try cappedRelay(mode: "refuse", port: port, holdMs: 6000, holdHeaders: headers)
        defer { relay.stop() }
        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        let started = Date()
        queue.request(channelId: "held", inputUrl: relay.url, headers: [:], deadline: 3, originKey: "held-\(port)") {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 20)
        let elapsed = Date().timeIntervalSince(started)
        guard case .none(opened: false, failure: _, ended: true)? = outcome else {
            return XCTFail("the origin's close was not the answer: \(String(describing: outcome))")
        }
        XCTAssertGreaterThanOrEqual(elapsed, 6, "the grab's own deadline cut an open the origin had admitted")
        XCTAssertLessThan(elapsed, 12, "the grab opened again after the origin ended it")
        XCTAssertEqual(try relay.stats()["admitted"], 1)
    }

    /// An origin serving a trickle: the grab's deadline counts from the first byte, so a probe the trickle drags out
    /// is cut by it, and our cut is not the channel's answer.
    func testAGrabOnATrickleEndsAtItsDeadlineFromTheFirstByte() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19822, pace: "0.05:120", paceSlice: 7)
        defer { relay.stop() }
        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        let started = Date()
        queue.request(channelId: "trickle", inputUrl: relay.url, headers: [:], deadline: 3, originKey: "trickle") {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 90)
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertLessThan(elapsed, 10, "the deadline waited for the probe instead of counting from the first byte")
        if case .none(_, _, let ended)? = outcome { XCTAssertFalse(ended, "our own cut was taken for the channel's answer") }
    }

    /// A sweep waiting for a connection gets it the moment the read holding it closes.
    func testASweepWaitsForTheSlotToFreeAndTakesIt() throws {
        let broker = LiveConnectionBroker()
        broker.setBudget(1, for: "k")
        let ring = try XCTUnwrap(broker.tryAcquire(key: "k", priority: .ring, onRevoke: {}))
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { ring.release() }
        let started = Date()
        XCTAssertNotNil(broker.acquire(key: "k", priority: .sweep, timeout: 5, onRevoke: {}))
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.3)
        XCTAssertNil(broker.acquire(key: "k", priority: .sweep, timeout: 0.2, onRevoke: {}), "the sweep took a slot from the sweep holding it")
    }

    // MARK: - A preview holds a slot only while one stays spare beside it

    func testASweepsLostFightBesideAPreviewWithNoBudgetKnownEndsThePreviewAndTeachesOne() {
        let broker = LiveConnectionBroker()
        var previewRevoked = false
        let preview = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }
        let sweep = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})
        XCTAssertNotNil(preview)
        broker.noteLostFight(of: sweep!, channel: "a", learn: true)
        XCTAssertTrue(previewRevoked)
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertNil(broker.tryAcquire(key: "k", priority: .preview, onRevoke: {}), "a preview was granted on a one-connection key")
    }

    func testAPreviewRefusedBesideASweepLeavesTheSweepAloneAndEndsItself() {
        let broker = LiveConnectionBroker()
        var sweepRevoked = false
        var previewRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .sweep) { sweepRevoked = true }
        let preview = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }
        XCTAssertFalse(broker.noteRefusal(of: preview!))
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertFalse(sweepRevoked)
        XCTAssertTrue(previewRevoked)
    }

    func testABudgetOfOneSetWithAPreviewHeldEndsIt() {
        let broker = LiveConnectionBroker()
        var previewRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }
        broker.setBudget(1, for: "k")
        XCTAssertTrue(previewRevoked)
    }

    func testAPreviewKeepsItsSlotWhileOneStaysSpareBesideIt() {
        let broker = LiveConnectionBroker()
        var previewRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }
        _ = broker.tryAcquire(key: "k", priority: .playback, onRevoke: {})
        broker.setBudget(3, for: "k")
        XCTAssertFalse(previewRevoked)
        // A budget of two sent again with the sweep in the spare slot: the spare is the sweep's, the preview stays.
        let two = LiveConnectionBroker()
        var twoRevoked = false
        two.setBudget(2, for: "k")
        _ = two.tryAcquire(key: "k", priority: .preview) { twoRevoked = true }
        XCTAssertNotNil(two.tryAcquire(key: "k", priority: .sweep, onRevoke: {}))
        two.setBudget(2, for: "k")
        XCTAssertFalse(twoRevoked)
    }

    func testAKickedPreviewRevokesNothingBelowIt() {
        let broker = LiveConnectionBroker()
        var sweepRevoked = false
        let preview = broker.tryAcquire(key: "k", priority: .preview, onRevoke: {})!
        Thread.sleep(forTimeInterval: 0.01)
        _ = broker.tryAcquire(key: "k", priority: .sweep) { sweepRevoked = true }
        broker.noteLost(preview)
        XCTAssertEqual(broker.budget(for: "k"), 1)
        XCTAssertFalse(sweepRevoked)
    }

    func testAKeyThatShowedRoomBesideAPreviewRevokesAndLearnsOnlyOnceTwoChannelsLost() {
        let broker = LiveConnectionBroker()
        var previewRevoked = false
        let preview = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }!
        broker.noteOpened(preview)
        let sibling = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteOpened(sibling)
        sibling.release()
        // One channel losing beside a preview the origin served another read beside is that channel's own refusal.
        let broken = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteLostFight(of: broken, channel: "broken", learn: true)
        XCTAssertFalse(previewRevoked)
        XCTAssertNil(broker.budget(for: "k"))
        broker.noteLostFight(of: broken, channel: "broken", learn: true)
        XCTAssertFalse(previewRevoked)
        // A second channel losing since means the room is gone: the preview yields and the count is learned.
        broker.noteLostFight(of: broken, channel: "other", learn: true)
        XCTAssertTrue(previewRevoked)
        XCTAssertEqual(broker.budget(for: "k"), 1)
        preview.release()
        broken.release()
        // Previews are not stopped on a key that showed room; a fresh one is granted once the budget allows.
        broker.setBudget(2, for: "k")
        XCTAssertNotNil(broker.tryAcquire(key: "k", priority: .preview, onRevoke: {}))
    }

    func testAReadAdmittedBesideAnOpenedPreviewForgetsTheChannelsThatLostSince() {
        let broker = LiveConnectionBroker()
        var previewRevoked = false
        let preview = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }!
        broker.noteOpened(preview)
        let first = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteOpened(first)
        first.release()
        let lost = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteLostFight(of: lost, channel: "a", learn: false)
        lost.release()
        let admitted = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteOpened(admitted)
        admitted.release()
        let again = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteLostFight(of: again, channel: "b", learn: false)
        XCTAssertFalse(previewRevoked, "one channel lost since the last admission counts as two")
    }

    func testAKeyThatNeverShowedRoomStopsPreviewsAtTheSecondChannelLostWithNoNumber() {
        let broker = LiveConnectionBroker()
        var firstRevoked = false
        let first = broker.tryAcquire(key: "k", priority: .preview) { firstRevoked = true }!
        let sweep = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteLostFight(of: sweep, channel: "a", learn: false)
        XCTAssertTrue(firstRevoked)
        XCTAssertNil(broker.budget(for: "k"))
        first.release()
        // The next dwell's preview is still granted: one channel lost says nothing of the origin.
        var secondRevoked = false
        let second = broker.tryAcquire(key: "k", priority: .preview) { secondRevoked = true }
        XCTAssertNotNil(second)
        broker.noteLostFight(of: sweep, channel: "b", learn: false)
        XCTAssertTrue(secondRevoked)
        second?.release()
        sweep.release()
        XCTAssertNil(broker.tryAcquire(key: "k", priority: .preview, onRevoke: {}), "a preview was granted on a full origin")
        // The viewer's own number replaces what the refusals showed.
        broker.setBudget(2, for: "k")
        XCTAssertNotNil(broker.tryAcquire(key: "k", priority: .preview, onRevoke: {}))
    }

    func testAPreviewStillRetryingInAGhostShowsNoRoom() {
        let broker = LiveConnectionBroker()
        var previewRevoked = false
        _ = broker.tryAcquire(key: "k", priority: .preview) { previewRevoked = true }
        // The sweep is admitted beside a preview the origin has not admitted: no room shown.
        let sweep = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteOpened(sweep)
        sweep.release()
        let next = broker.tryAcquire(key: "k", priority: .sweep, onRevoke: {})!
        broker.noteLostFight(of: next, channel: "a", learn: true)
        XCTAssertTrue(previewRevoked)
        XCTAssertEqual(broker.budget(for: "k"), 1)
    }

    /// The warm preview holds the only connection and the sweep's fight is refused for its whole deadline: the preview
    /// yields, the sweep's next open gets in, and the origin never counted two readers.
    func testASweepsLostFightEndsThePreviewHoldingTheOnlyConnection() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19782, status: "429 Too Many Requests")
        defer { relay.stop() }
        let key = "preview-yields"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        var previewConfig = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        previewConfig.liveOriginKey = key
        previewConfig.livePriority = .preview
        let preview = try RemuxSession(config: previewConfig)
        let yielded = XCTestExpectation(description: "preview yielded")
        var failure: String?
        preview.onFailed = {
            failure = $0["message"] as? String
            yielded.fulfill()
        }
        preview.start()
        defer { preview.stop() }
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(try relay.stats()["active"], 1, "the preview is not reading")

        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "card", inputUrl: relay.url, headers: [:], deadline: 6, span: 3, interval: 3, count: 2, originKey: key) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .refused? = outcome else { return XCTFail("the first fight was not lost: \(String(describing: outcome))") }
        wait(for: [yielded], timeout: 5)
        XCTAssertTrue(failure?.contains("yielded") == true, "\(failure ?? "no failure")")
        XCTAssertEqual(LiveConnectionBroker.shared.budget(for: key), 1)
        let next = XCTestExpectation(description: "next grab")
        queue.request(channelId: "card", inputUrl: relay.url, headers: [:], deadline: 12, span: 3, interval: 3, count: 2, originKey: key) {
            outcome = $0
            next.fulfill()
        }
        wait(for: [next], timeout: 20)
        guard case .frames? = outcome else { return XCTFail("the grab after the preview yielded did not open: \(String(describing: outcome))") }
        let stats = try relay.stats()
        XCTAssertEqual(stats["peak"], 1, "the origin counted two readers: \(stats)")
    }

    /// The origin keeps counting the closed read for 10 s: playback's refused open keeps trying every second within the
    /// close window and opens once the count clears, never falling to the server's copy.
    func testPlaybackRidesOutATenSecondCountOfTheClosedRead() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19792, status: "429 Too Many Requests", lagMs: 10000)
        defer { relay.stop() }
        let key = "lagging-ten"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        config.livePriority = .playback
        config.fallbackInputUrl = Self.fixture.absoluteString
        let previous = try RemuxSession(config: config)
        previous.start()
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(try relay.stats()["active"], 1, "the first channel is not reading")
        previous.stop()
        Thread.sleep(forTimeInterval: 0.2)
        let next = try RemuxSession(config: config)
        var failure: String?
        next.onFailed = { failure = $0["message"] as? String }
        next.start()
        defer { next.stop() }
        Thread.sleep(forTimeInterval: 14)
        XCTAssertNil(failure, "the next channel failed: \(failure ?? "")")
        let stats = try relay.stats()
        XCTAssertGreaterThanOrEqual(stats["refused"] ?? 0, 5, "the open was not kept up through the count: \(stats)")
        XCTAssertEqual(stats["active"], 1, "the next channel is not reading the origin: \(stats)")
    }

    /// Nothing known about the origin: a ring neighbour opens beside playback and the origin kicks one of them. The
    /// neighbour opened without FFmpeg's reconnect, so the kicking stops there: it ends, the limit is learned, and
    /// playback keeps the connection.
    func testAKickBetweenPlaybackAndANeighbourTeachesTheLimitAndPlaybackKeepsReading() throws {
        let relay = try cappedRelay(mode: "kick", port: 19572)
        defer { relay.stop() }
        let key = "learn-kick"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        let playback = try RemuxSession(config: config)
        var failure: String?
        playback.onFailed = { failure = $0["message"] as? String }
        playback.start()
        defer { playback.stop() }
        Thread.sleep(forTimeInterval: 3)
        var ringConfig = config
        ringConfig.livePriority = .ring
        let ring = try RemuxSession(config: ringConfig)
        let yielded = XCTestExpectation(description: "neighbour ended")
        ring.onFailed = { _ in yielded.fulfill() }
        ring.start()
        defer { ring.stop() }
        wait(for: [yielded], timeout: 30)
        Thread.sleep(forTimeInterval: 6)
        XCTAssertEqual(LiveConnectionBroker.shared.budget(for: key), 1)
        XCTAssertNil(failure, "playback failed: \(failure ?? "")")
        let stats = try relay.stats()
        XCTAssertEqual(stats["active"], 1, "\(stats)")
        XCTAssertLessThanOrEqual(stats["kicked"] ?? 0, 2, "the origin kept kicking: \(stats)")
        print("[LiveConnectionBroker] learned kick: \(stats)")
    }

    func testPlaybackTakesTheSweepsConnectionOnAnOriginThatRefuses() throws {
        try assertPlaybackTakesTheSweepsConnection(mode: "refuse", port: 19512)
    }

    func testPlaybackTakesTheSweepsConnectionOnAnOriginThatKicks() throws {
        try assertPlaybackTakesTheSweepsConnection(mode: "kick", port: 19522)
    }

    /// A ring neighbour holding the only connection yields it to playback, which opens once the neighbour's input closed.
    func testARingNeighbourYieldsItsConnectionToPlayback() throws {
        let relay = try cappedRelay(mode: "kick", port: 19532)
        defer { relay.stop() }
        let key = "capped-ring"
        LiveConnectionBroker.shared.setBudget(1, for: key)
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }

        var ringConfig = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        ringConfig.liveOriginKey = key
        ringConfig.livePriority = .ring
        let ring = try RemuxSession(config: ringConfig)
        let yielded = XCTestExpectation(description: "ring yielded")
        ring.onFailed = { _ in yielded.fulfill() }
        ring.start()
        defer { ring.stop() }
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(try relay.stats()["active"], 1, "the ring neighbour is not reading")

        var playConfig = ringConfig
        playConfig.livePriority = .playback
        let playback = try RemuxSession(config: playConfig)
        var failure: String?
        playback.onFailed = { failure = $0["message"] as? String }
        playback.start()
        defer { playback.stop() }
        wait(for: [yielded], timeout: 10)
        Thread.sleep(forTimeInterval: 4)
        XCTAssertNil(failure, "playback failed: \(failure ?? "")")
        let stats = try relay.stats()
        XCTAssertEqual(stats["peak"], 1, "\(stats)")
        XCTAssertEqual(stats["active"], 1, "playback is not reading: \(stats)")
        print("[LiveConnectionBroker] ring: \(stats)")
    }

    // MARK: - Falling back to the server's copy

    /// An origin this device cannot open: the grab reads the fallback (the channel through the server) instead.
    func testAGrabReadsTheFallbackWhenTheOriginWillNotOpen() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19542)
        defer { relay.stop() }
        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "fallback", inputUrl: "http://127.0.0.1:9/live.ts", headers: ["User-Agent": "origin-only"], deadline: 6, span: 9,
                      interval: 3, count: 4, originKey: "fallback-grab", fallbackUrl: relay.url) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .frames(let files, _, _)? = outcome else { return XCTFail("no frames through the fallback: \(String(describing: outcome))") }
        XCTAssertFalse(files.isEmpty)
        XCTAssertEqual(try relay.stats()["admitted"], 1)
    }

    /// A live session whose origin refuses opens the fallback and keeps reading it.
    func testALiveSessionOpensTheFallbackWhenTheOriginWillNotOpen() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19552)
        defer { relay.stop() }
        var config = makeConfig(durationSeconds: 0, inputUrl: "http://127.0.0.1:9/live.ts", width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.fallbackInputUrl = relay.url
        let session = try RemuxSession(config: config)
        var failure: String?
        session.onFailed = { failure = $0["message"] as? String }
        session.start()
        defer { session.stop() }
        Thread.sleep(forTimeInterval: 4)
        XCTAssertNil(failure, "the session failed: \(failure ?? "")")
        XCTAssertEqual(try relay.stats()["active"], 1, "the fallback is not being read")
    }

    // MARK: - The fallback teaches the origin nothing

    private static let unopenable = "http://127.0.0.1:9/live.ts"

    /// A live session on its own key reading the relay, so the relay counts it as a reader.
    private func occupy(_ relay: Relay, key: String) throws -> RemuxSession {
        var config = makeConfig(durationSeconds: 0, inputUrl: relay.url, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        let session = try RemuxSession(config: config)
        session.start()
        Thread.sleep(forTimeInterval: 3)
        return session
    }

    private func fallbackSession(key: String, relay: Relay) throws -> RemuxSession {
        var config = makeConfig(durationSeconds: 0, inputUrl: Self.unopenable, width: 128, height: 96, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: 30)
        config.liveOriginKey = key
        config.fallbackInputUrl = relay.url
        return try RemuxSession(config: config)
    }

    func testARefusedFallbackSessionTeachesTheOriginNothing() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19582)
        defer { relay.stop() }
        let key = "fallback-refused-session"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let occupier = try occupy(relay, key: "\(key)-occupier")
        defer { occupier.stop() }
        XCTAssertEqual(try relay.stats()["active"], 1, "the relay is not occupied")
        let other = try XCTUnwrap(LiveConnectionBroker.shared.tryAcquire(key: key, priority: .sweep, onRevoke: {}))
        defer { other.release() }
        let session = try fallbackSession(key: key, relay: relay)
        session.start()
        defer { session.stop() }
        Thread.sleep(forTimeInterval: 4)
        XCTAssertGreaterThanOrEqual(try relay.stats()["refused"] ?? 0, 1, "the fallback was never refused")
        XCTAssertNil(LiveConnectionBroker.shared.budget(for: key), "the server's refusal is no limit of the origin")
    }

    func testARefusedFallbackGrabTeachesTheOriginNothing() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19592)
        defer { relay.stop() }
        let key = "fallback-refused-grab"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let occupier = try occupy(relay, key: "\(key)-occupier")
        defer { occupier.stop() }
        XCTAssertEqual(try relay.stats()["active"], 1, "the relay is not occupied")
        let other = try XCTUnwrap(LiveConnectionBroker.shared.tryAcquire(key: key, priority: .sweep, onRevoke: {}))
        defer { other.release() }
        let queue = try frameQueue()
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "refused-fallback", inputUrl: Self.unopenable, headers: [:], deadline: 6, span: 9,
                      interval: 3, count: 4, originKey: key, fallbackUrl: relay.url) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .none(opened: false, failure: let failure, ended: _)? = outcome else { return XCTFail("the fallback was not refused: \(String(describing: outcome))") }
        XCTAssertGreaterThanOrEqual(try relay.stats()["refused"] ?? 0, 1, "the fallback was never refused")
        XCTAssertFalse(failure?.contains("403") ?? false, "the grab reports the server copy's failure, not the origin's: \(failure ?? "no failure")")
        XCTAssertNil(LiveConnectionBroker.shared.budget(for: key), "the server's refusal is no limit of the origin")
    }

    func testAKickedFallbackGrabTeachesTheOriginNothing() throws {
        let relay = try cappedRelay(mode: "kick", port: 19702)
        defer { relay.stop() }
        let key = "fallback-kicked-grab"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let other = try XCTUnwrap(LiveConnectionBroker.shared.tryAcquire(key: key, priority: .sweep, onRevoke: {}))
        defer { other.release() }
        let queue = try frameQueue()
        let reading = XCTestExpectation(description: "fallback reading")
        reading.assertForOverFulfill = false
        let done = XCTestExpectation(description: "grab")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "kicked-fallback", inputUrl: Self.unopenable, headers: [:], deadline: 12, span: 36,
                      interval: 3, count: 12, originKey: key, fallbackUrl: relay.url, frame: { _, _ in reading.fulfill() }) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [reading], timeout: 10)
        let kicker = try occupy(relay, key: "\(key)-kicker")
        defer { kicker.stop() }
        wait(for: [done], timeout: 15)
        XCTAssertGreaterThanOrEqual(try relay.stats()["kicked"] ?? 0, 1, "the fallback grab was not kicked")
        if case .cancelled? = outcome { XCTFail("the grab was cancelled, not kicked") }
        XCTAssertNil(LiveConnectionBroker.shared.budget(for: key), "the server dropping its copy is no limit of the origin")
    }

    func testAKickedFallbackSessionTeachesTheOriginNothing() throws {
        let relay = try cappedRelay(mode: "kick", port: 19712)
        defer { relay.stop() }
        let key = "fallback-kicked-session"
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        let other = try XCTUnwrap(LiveConnectionBroker.shared.tryAcquire(key: key, priority: .sweep, onRevoke: {}))
        defer { other.release() }
        let session = try fallbackSession(key: key, relay: relay)
        let ended = XCTestExpectation(description: "fallback ended")
        ended.assertForOverFulfill = false
        session.onFailed = { _ in ended.fulfill() }
        session.start()
        defer { session.stop() }
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(try relay.stats()["active"], 1, "the fallback is not being read")
        let kicker = try occupy(relay, key: "\(key)-kicker")
        defer { kicker.stop() }
        wait(for: [ended], timeout: 20)
        XCTAssertNil(LiveConnectionBroker.shared.budget(for: key), "the server dropping its copy is no limit of the origin")
    }
}
