import Network
import XCTest

@testable import TomoEngine

/// A loopback server that sends each body at a scripted rate, owed bytes on a 2ms tick.
private final class PacedServer {
    struct Script {
        var bps: Double
        var length: Int
        /// Bytes sent before the body stops arriving, the connection left open.
        var stallAfter: Int? = nil
        /// Seconds before the first byte.
        var firstByteAfter: Double = 0
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "paced-server")
    private let lock = NSLock()
    private var script: Script
    private var open: [NWConnection] = []
    private var timers: [DispatchSourceTimer] = []
    private(set) var requests = 0

    var url: URL { URL(string: "http://127.0.0.1:\(listener.port?.rawValue ?? 0)/body")! }

    init(_ script: Script) throws {
        self.script = script
        listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
        listener.newConnectionHandler = { [weak self] in self?.serve($0) }
        listener.start(queue: queue)
        _ = ready.wait(timeout: .now() + 5)
    }

    func stop() {
        listener.cancel()
        lock.lock()
        timers.forEach { $0.cancel() }
        open.forEach { $0.cancel() }
        lock.unlock()
    }

    private func serve(_ connection: NWConnection) {
        lock.lock()
        open.append(connection)
        lock.unlock()
        connection.start(queue: queue)
        answer(connection)
    }

    /// One request, then the next on the same connection: a keep-alive client asks again on it.
    private func answer(_ connection: NWConnection) {
        lock.lock()
        let script = script
        lock.unlock()
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
            guard let self, data != nil else { return }
            self.lock.lock()
            self.requests += 1
            self.lock.unlock()
            let head = Data("HTTP/1.1 200 OK\r\nContent-Length: \(script.length)\r\nContent-Type: application/octet-stream\r\n\r\n".utf8)
            connection.send(content: head, completion: .contentProcessed { _ in })
            self.queue.asyncAfter(deadline: .now() + script.firstByteAfter) { self.pace(connection, script) }
        }
    }

    private func pace(_ connection: NWConnection, _ script: Script) {
        let started = DispatchTime.now().uptimeNanoseconds
        let limit = min(script.length, script.stallAfter ?? script.length)
        var sent = 0
        let timer = DispatchSource.makeTimerSource(flags: .strict, queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(2), leeway: .nanoseconds(0))
        timer.setEventHandler { [weak self] in
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1e9
            let owed = min(limit, Int(script.bps * elapsed / 8)) - sent
            if owed > 0 {
                connection.send(content: Data(count: owed), completion: .contentProcessed { _ in })
                sent += owed
            }
            guard sent >= limit else { return }
            timer.cancel()
            if limit == script.length { self?.answer(connection) }
        }
        lock.lock()
        timers.append(timer)
        lock.unlock()
        timer.resume()
    }
}

final class RateProbeTests: XCTestCase {
    private let mbps = 1_000_000.0

    private func probe(_ server: PacedServer, budget: Double = 3, repeats: Bool = false, beside: @escaping () -> Int64 = { 0 }) -> (RateProbe.Outcome, Double) {
        let started = Date()
        let outcome = RateProbe(request: URLRequest(url: server.url), budget: budget, firstByteWithin: 1, repeats: repeats, beside: beside).run()
        return (outcome, Date().timeIntervalSince(started))
    }

    func testAPacedBodyReadsItsRateOverTheWholeBudget() throws {
        for rate in [8.0, 40, 120] {
            let server = try PacedServer(.init(bps: rate * mbps, length: 200_000_000))
            defer { server.stop() }
            let (outcome, elapsed) = probe(server)
            let reading = try XCTUnwrap(outcome.reading, "\(rate) Mb/s")
            XCTAssertNil(outcome.failure)
            XCTAssertEqual(reading.kind, .full, "\(rate) Mb/s")
            XCTAssertEqual(reading.bps / mbps, rate, accuracy: rate * 0.03, "\(rate) Mb/s")
            XCTAssertGreaterThanOrEqual(elapsed, 3, "no flat stretch ends the read before its budget")
        }
    }

    func testAShortTestBodyIsAskedForAgainUntilTheBudget() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 2_000_000))
        defer { server.stop() }
        let (outcome, _) = probe(server, repeats: true)
        let reading = try XCTUnwrap(outcome.reading)
        XCTAssertEqual(reading.kind, .full)
        XCTAssertEqual(reading.bps / mbps, 40, accuracy: 1.2)
        XCTAssertGreaterThan(server.requests, 5)
    }

    func testAShortBodyWithoutRepeatsReadsShort() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 1_000_000))
        defer { server.stop() }
        let (outcome, elapsed) = probe(server)
        let reading = try XCTUnwrap(outcome.reading)
        // A 0.2s body is one burst: its rate is never the link, so the claim is its kind and that Settings drops it.
        XCTAssertEqual(reading.kind, .short)
        XCTAssertGreaterThan(reading.bps, 0)
        XCTAssertLessThan(reading.seconds, 1)
        XCTAssertNil(outcome.linkReading)
        XCTAssertLessThan(elapsed, 1)
        XCTAssertEqual(server.requests, 1)
    }

    func testTheFirstByteWaitIsNotTheLink() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000, firstByteAfter: 0.6))
        defer { server.stop() }
        let (outcome, _) = probe(server)
        let reading = try XCTUnwrap(outcome.reading)
        XCTAssertEqual(reading.kind, .full)
        XCTAssertEqual(reading.bps / mbps, 40, accuracy: 1.2)
    }

    func testARepeatedBodyCountsTheWaitBeforeEachNextOne() throws {
        // 2 MB bursts at 400 Mb/s after a 0.2s fill each: 16 Mb per 0.24s, about 67 Mb/s.
        let server = try PacedServer(.init(bps: 400 * mbps, length: 2_000_000, firstByteAfter: 0.2))
        defer { server.stop() }
        let (outcome, _) = probe(server, repeats: true)
        let reading = try XCTUnwrap(outcome.reading)
        XCTAssertGreaterThan(server.requests, 5)
        XCTAssertLessThan(reading.bps / mbps, 67 + 12, "each body's burst is not the link")
    }

    func testOnlyAWindowOfDeliveryFromAnAnsweredRequestIsTheLink() {
        func outcome(_ kind: RateMeter.Kind, _ failure: LinkProbeFailure? = nil) -> RateProbe.Outcome {
            .init(reading: .init(kind: kind, bps: 640_000_000, lowBps: 0, highBps: 0, seconds: kind == .short ? 0.004 : 3), failure: failure)
        }
        XCTAssertNil(outcome(.short).linkReading, "one burst reads the last hop, not the link")
        XCTAssertNil(outcome(.full, .unavailable(404)).linkReading)
        XCTAssertNotNil(outcome(.full).linkReading)
        XCTAssertNotNil(outcome(.full, .transient(0)).linkReading, "a body cut off after a full window still read the link")
    }

    func testACancelledReadEndsAtOnceWithNoReading() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000))
        defer { server.stop() }
        let probe = RateProbe(request: URLRequest(url: server.url), budget: 10, firstByteWithin: 1, repeats: true)
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { probe.cancel() }
        let started = Date()
        let outcome = probe.run()
        XCTAssertNil(outcome.reading, "a read that shared the link with playback is no reading of it")
        XCTAssertNil(outcome.linkReading)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.5, "the ten-second budget is not waited out")
    }

    func testNoFirstByteReadsNothing() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 1_000_000, stallAfter: 0))
        defer { server.stop() }
        let (outcome, elapsed) = probe(server)
        XCTAssertNil(outcome.reading)
        XCTAssertLessThan(elapsed, 2, "the first-byte wait bounds a silent server")
    }

    func testABodyThatStallsEndsAtTheBudget() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000, stallAfter: 2_000_000))
        defer { server.stop() }
        let (outcome, elapsed) = probe(server, budget: 1.5)
        let reading = try XCTUnwrap(outcome.reading)
        XCTAssertLessThan(elapsed, 1.5 + 1, "a stalled body sends no chunk to stop on")
        XCTAssertEqual(reading.seconds, 1.5, accuracy: 0.1, "the silence up to the budget is read")
        XCTAssertLessThan(reading.bps / mbps, 16, "2 MB over 1.5s is about 11 Mb/s, not the 40 it arrived at")
    }

    func testBytesCarriedBesideTheProbeAreTheLinkToo() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000))
        defer { server.stop() }
        let origin = ProcessInfo.processInfo.systemUptime
        let (outcome, _) = probe(server) { Int64((ProcessInfo.processInfo.systemUptime - origin) * 40 * 1_000_000 / 8) }
        let reading = try XCTUnwrap(outcome.reading)
        XCTAssertEqual(reading.bps / mbps, 80, accuracy: 2.4)
    }
}

/// The session's one link estimate: what set it, how sure the probe was, and which readings a probe may drop.
final class LinkEstimateTests: XCTestCase {
    private let mbps = 1_000_000.0

    func testTheEngineProbeSetsTheLinkFromItsRead() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000))
        defer { server.stop() }
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, inputUrl: server.url.absoluteString))
        defer { s.stop() }
        s.probeLink(reporting: true)
        let link = try XCTUnwrap(s.link)
        XCTAssertEqual(link.source, .probe)
        XCTAssertEqual(link.bps / mbps, 40, accuracy: 1.2)
        XCTAssertNil(s.sourceProbeFailure)
    }

    /// A server disk waking from sleep answers late; the startup probe waits for it and reads the link.
    func testTheStartupProbeWaitsOutASlowFirstByte() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000, firstByteAfter: 5))
        defer { server.stop() }
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, inputUrl: server.url.absoluteString))
        defer { s.stop() }
        s.probeLink()
        XCTAssertEqual(try XCTUnwrap(s.wireLinkBps) / mbps, 40, accuracy: 1.2)
        XCTAssertNil(s.sourceProbeFailure)
    }

    /// Mid-session the first byte keeps its 3s: a late answer then is the link.
    func testAMidSessionProbeStillGivesUpOnASlowFirstByte() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 200_000_000, firstByteAfter: 5))
        defer { server.stop() }
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, inputUrl: server.url.absoluteString))
        defer { s.stop() }
        s.finishLinkProbe(200_000_000, reporting: false)
        let started = Date()
        s.probeLink(reporting: true)
        XCTAssertLessThan(Date().timeIntervalSince(started), 4.5)
        XCTAssertEqual(s.wireLinkBps, 200_000_000)
    }

    func testAMidSessionProbeUnderAWindowLeavesTheLinkStanding() throws {
        let server = try PacedServer(.init(bps: 40 * mbps, length: 1_000_000))
        defer { server.stop() }
        let s = try RemuxSession(config: makeConfig(durationSeconds: 18, inputUrl: server.url.absoluteString))
        defer { s.stop() }
        s.finishLinkProbe(200_000_000, reporting: false)
        s.lastLinkProbeAt = .distantPast
        s.probeLink(reporting: true)
        XCTAssertEqual(s.wireLinkBps, 200_000_000)
        XCTAssertGreaterThan(s.lastLinkProbeAt, Date().addingTimeInterval(-5), "the probe clock moves")
    }

    func testEachReadingNamesItsSource() throws {
        let reads = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { reads.stop() }
        reads.noteLinkSample(bytes: 600_000, seconds: 1)
        XCTAssertNil(reads.link, "a read never sets a link the probe did not measure")
        reads.finishLinkProbe(8_000_000, reporting: false)
        reads.noteLinkSample(bytes: 600_000, seconds: 1)
        XCTAssertEqual(reads.link?.source, .reads)

        let server = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { server.stop() }
        let now = Date()
        server.finishLinkProbe(nil, reporting: false, failure: .unavailable(404))
        server.notePlaylistTransfer(bytes: 30_000, from: now, to: now.addingTimeInterval(0.2))
        XCTAssertEqual(server.link?.source, .playlist)
        server.noteFloorSample(bytes: 600_000, from: now, to: now.addingTimeInterval(1))
        XCTAssertEqual(server.link?.source, .rungs)
    }
}

