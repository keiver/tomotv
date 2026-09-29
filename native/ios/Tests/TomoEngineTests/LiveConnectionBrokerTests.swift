import Foundation
import XCTest
@testable import TomoEngine

/// The connection budget: its rules on their own, then the real grab and live session against relay.py capped at
/// one reader (refuse and kick, the two ways providers enforce it), with the relay's own count as the witness.
final class LiveConnectionBrokerTests: XCTestCase {
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

    private func cappedRelay(mode: String, port: Int) throws -> Relay {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("needs \(Self.ffmpeg)") }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("broker-relay-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("{\"channels\":[{\"id\":\"cap\",\"port\":\(port)}]}".utf8).write(to: dir.appendingPathComponent("lineup.json"))
        let relay = Process()
        relay.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        relay.arguments = ["python3", Self.repo.appendingPathComponent("scripts/demo-livetv/relay.py").path, dir.path]
        relay.environment = ProcessInfo.processInfo.environment.merging(["RELAY_MAX_READERS": "1", "RELAY_CAP_MODE": mode]) { $1 }
        relay.standardOutput = FileHandle.nullDevice
        try relay.run()
        Thread.sleep(forTimeInterval: 0.8)
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
    /// refusal teaches the limit, the grab yields, and playback's retry gets in.
    func testARefusedPlaybackTeachesTheLimitAndTakesTheGrabsConnection() throws {
        let relay = try cappedRelay(mode: "refuse", port: 19562)
        defer { relay.stop() }
        let key = "learn-refuse"
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
        XCTAssertEqual(LiveConnectionBroker.shared.budget(for: key), 1)
        let stats = try relay.stats()
        XCTAssertEqual(stats["active"], 1, "playback is not reading: \(stats)")
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
}
