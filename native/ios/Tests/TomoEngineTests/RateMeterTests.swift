import XCTest

@testable import TomoEngine

private let mbps = 1_000_000.0

/// Deliveries of synthetic transfers, replayed into a meter in time order.
private struct Trace {
    enum Step {
        case data(Int, Int)
        case end(Int)
    }

    private var events: [(at: Double, order: Int, step: Step)] = []
    private var cursor = 0
    private(set) var meter: RateMeter

    init(meter: RateMeter = RateMeter()) {
        self.meter = meter
    }

    /// One transfer delivering at `times`, each chunk carrying what `rate` (bits/s) moved since the previous one.
    /// The first chunk carries `firstChunk` bytes, or what moved over the gap before it.
    mutating func transfer(_ id: Int, at times: [Double], firstChunk: Int? = nil, ends: Bool = true, rate: (Double) -> Double) {
        guard let first = times.first else { return }
        let lead = times.count > 1 ? times[1] - first : 0.005
        add(first, .data(id, firstChunk ?? Int(integral(rate, first - lead, first) / 8)))
        var carry = 0.0
        for (previous, next) in zip(times, times.dropFirst()) {
            carry += integral(rate, previous, next) / 8
            let whole = Int(carry)
            carry -= Double(whole)
            add(next, .data(id, whole))
        }
        if ends, let last = times.last { add(last, .end(id)) }
    }

    mutating func transfer(_ id: Int, from start: Double, to end: Double, cadence: Double = 0.005, firstChunk: Int? = nil,
                           ends: Bool = true, rate: (Double) -> Double) {
        let count = Int(((end - start) / cadence).rounded())
        transfer(id, at: (0...count).map { start + Double($0) * cadence }, firstChunk: firstChunk, ends: ends, rate: rate)
    }

    /// Replays every event up to `time` and reads the meter.
    mutating func read(at time: Double) -> RateMeter.Reading {
        let ordered = events.sorted { ($0.at, $0.order) < ($1.at, $1.order) }
        while cursor < ordered.count, ordered[cursor].at <= time + 1e-9 {
            switch ordered[cursor].step {
            case let .data(id, bytes):
                meter.received(id, bytes: bytes, at: ordered[cursor].at)
            case let .end(id):
                meter.ended(id)
            }
            cursor += 1
        }
        return meter.reading()
    }

    private mutating func add(_ at: Double, _ step: Step) {
        events.append((at, events.count, step))
    }
}

/// Bits over [a, b], by midpoints fine enough to be exact for the piecewise-constant rates used here.
private func integral(_ rate: (Double) -> Double, _ a: Double, _ b: Double) -> Double {
    guard b > a else { return 0 }
    let steps = max(1, Int(((b - a) / 0.0005).rounded()))
    let h = (b - a) / Double(steps)
    return (0..<steps).reduce(0) { $0 + rate(a + (Double($1) + 0.5) * h) * h }
}

/// Deterministic values in [0, 1).
private struct Lcg {
    var state: UInt64
    mutating func next() -> Double {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return Double(state >> 11) / Double(1 << 53)
    }
}

final class RateMeterTests: XCTestCase {
    func testAFlatLinkSettlesOnItsRateAtEveryCadence() {
        for rate in [1.0, 6.6, 100, 240, 940] {
            for cadence in [0.001, 0.005, 0.02, 0.25] {
                var trace = Trace()
                trace.transfer(1, from: 0, to: 3, cadence: cadence) { _ in rate * mbps }
                let reading = trace.read(at: 2.5)
                XCTAssertEqual(reading.kind, .steady, "\(rate) Mb/s every \(cadence)s")
                XCTAssertEqual(reading.bps / mbps, rate, accuracy: rate * 0.001, "\(rate) Mb/s every \(cadence)s")
            }
        }
    }

    func testAReadingIsShortUntilAWindowOfFlowAndSteadyRightAfter() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 2) { _ in 200 * mbps }
        XCTAssertEqual(trace.read(at: 0.99).kind, .short)
        XCTAssertEqual(trace.read(at: 1.01).kind, .steady)
    }

    func testIrregularDeliveryTimesAreNotLinkJitter() {
        var random = Lcg(state: 7)
        var times = [0.0]
        while times.last! < 2 { times.append(times.last! + 0.001 + random.next() * 0.04) }
        var trace = Trace()
        trace.transfer(1, at: times) { _ in 100 * mbps }
        let reading = trace.read(at: 2)
        XCTAssertEqual(reading.kind, .steady)
        XCTAssertEqual(reading.bps / mbps, 100, accuracy: 0.1)
    }

    func testARampReadsBelowTheLinkUntilItLevels() {
        let rate: (Double) -> Double = { t in (t < 0.4 ? 20 * pow(12, t / 0.4) : 240) * mbps }
        var trace = Trace()
        trace.transfer(1, from: 0, to: 2.5, rate: rate)
        for step in 2...50 {
            let t = Double(step) * 0.05
            let reading = trace.read(at: t)
            XCTAssertLessThanOrEqual(reading.bps, rate(t) * 1.000_001, "at \(t)s")
            if reading.kind == .steady {
                XCTAssertGreaterThanOrEqual(reading.bps, rate(t) * 0.97, "at \(t)s")
            }
        }
        var early = Trace()
        early.transfer(1, from: 0, to: 2.5, rate: rate)
        XCTAssertEqual(early.read(at: 1.31).kind, .unsettled)
        let level = early.read(at: 1.51)
        XCTAssertEqual(level.kind, .steady)
        XCTAssertEqual(level.bps / mbps, 240, accuracy: 0.24)
    }

    func testADropIsNeverSteadyAcrossItAndSettlesOnTheLowerRate() {
        let rate: (Double) -> Double = { t in (t < 0.7 ? 200 : 50) * mbps }
        var trace = Trace()
        trace.transfer(1, from: 0, to: 2.5, rate: rate)
        let straddling = trace.read(at: 1.21)
        XCTAssertEqual(straddling.kind, .unsettled)
        XCTAssertEqual(straddling.lowBps / mbps, 50, accuracy: 0.05)
        XCTAssertEqual(straddling.highBps / mbps, 200, accuracy: 0.2)
        XCTAssertEqual(straddling.bps / mbps, (7 * 200 + 5 * 50) / 12, accuracy: 0.1, "the whole run's average")
        let settled = trace.read(at: 1.71)
        XCTAssertEqual(settled.kind, .steady)
        XCTAssertEqual(settled.bps / mbps, 50, accuracy: 0.05)
    }

    func testJitterNeverSettlesAndReadsTheWholeRunsAverage() {
        var random = Lcg(state: 42)
        let factors = (0..<200).map { _ in 0.7 + random.next() * 0.6 }
        let rate: (Double) -> Double = { t in 100 * mbps * factors[min(factors.count - 1, Int(t / 0.03))] }
        var trace = Trace()
        trace.transfer(1, from: 0, to: 3, rate: rate)
        for step in 11...60 {
            XCTAssertNotEqual(trace.read(at: Double(step) * 0.05).kind, .steady, "at \(Double(step) * 0.05)s")
        }
        var windowed = Trace()
        windowed.transfer(1, from: 0, to: 3, rate: rate)
        let reading = windowed.read(at: 1.52)
        XCTAssertEqual(reading.kind, .unsettled)
        XCTAssertEqual(reading.bps, integral(rate, 0, 1.5) / 1.5, accuracy: reading.bps * 0.000_1)
        XCTAssertLessThan(reading.lowBps, reading.bps)
        XCTAssertGreaterThan(reading.highBps, reading.bps)
    }

    func testConcurrentTransfersSumToTheLink() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 2) { _ in 120 * mbps }
        trace.transfer(2, from: 0.0025, to: 2.0025) { _ in 120 * mbps }
        let reading = trace.read(at: 1.8)
        XCTAssertEqual(reading.kind, .steady)
        XCTAssertEqual(reading.bps / mbps, 240, accuracy: 0.24)
    }

    func testATransferJoiningMidwayKeepsALevelLinkLevel() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 2.5) { t in (t < 0.595 ? 200 : 100) * mbps }
        trace.transfer(2, from: 0.6, to: 2.5) { _ in 100 * mbps }
        for step in 21...48 {
            let reading = trace.read(at: Double(step) * 0.05)
            XCTAssertEqual(reading.kind, .steady, "at \(Double(step) * 0.05)s")
            XCTAssertEqual(reading.bps / mbps, 200, accuracy: 0.2, "at \(Double(step) * 0.05)s")
        }
    }

    func testIdleGapsAreNotTheLink() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 0.5) { _ in 100 * mbps }
        trace.transfer(2, from: 3, to: 3.8) { _ in 100 * mbps }
        let reading = trace.read(at: 4)
        XCTAssertEqual(reading.kind, .steady)
        XCTAssertEqual(reading.bps / mbps, 100, accuracy: 0.1)
        XCTAssertEqual(reading.seconds, 1.3, accuracy: 0.000_1)
    }

    func testTransfersSmallerThanASampleAddUpToTheLink() {
        var trace = Trace()
        for index in 0..<60 {
            let start = Double(index) * 0.5
            trace.transfer(index, from: start, to: start + 0.03) { _ in 80 * mbps }
        }
        let reading = trace.read(at: 31)
        XCTAssertEqual(reading.kind, .steady)
        XCTAssertEqual(reading.bps / mbps, 80, accuracy: 0.08)
        XCTAssertEqual(reading.seconds, 60 * 0.03, accuracy: 0.000_1)
    }

    func testASlowFirstByteAndItsBurstAreNotTheLink() {
        var trace = Trace()
        trace.transfer(1, from: 0.8, to: 2.5, firstChunk: 4 * 1024 * 1024) { _ in 100 * mbps }
        let reading = trace.read(at: 2.2)
        XCTAssertEqual(reading.kind, .steady)
        XCTAssertEqual(reading.bps / mbps, 100, accuracy: 0.1)
        XCTAssertEqual(reading.seconds, 1.4, accuracy: 0.000_1)
    }

    func testLessThanAWindowIsShortAndReadsItsAverage() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 0.5) { _ in 100 * mbps }
        let reading = trace.read(at: 1)
        XCTAssertEqual(reading.kind, .short)
        XCTAssertEqual(reading.bps / mbps, 100, accuracy: 0.1)
        XCTAssertEqual(reading.seconds, 0.5, accuracy: 0.000_1)
    }

    func testNothingOrAFirstChunkAloneReadsNothing() {
        XCTAssertEqual(RateMeter().reading(), RateMeter.Reading(kind: .short, bps: 0, lowBps: 0, highBps: 0, seconds: 0))
        var meter = RateMeter()
        meter.received(1, bytes: 65_536, at: 3)
        XCTAssertEqual(meter.reading(), RateMeter.Reading(kind: .short, bps: 0, lowBps: 0, highBps: 0, seconds: 0))
    }

    func testEmptyLateAndBackwardDeliveriesChangeNothing() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 1.5) { _ in 100 * mbps }
        let before = trace.read(at: 2)
        var meter = trace.meter
        meter.received(1, bytes: 1_000_000, at: 2.1)
        meter.received(2, bytes: 0, at: 2.2)
        meter.received(3, bytes: 1_000_000, at: .nan)
        XCTAssertEqual(meter.reading(), before)

        var backward = RateMeter()
        backward.received(1, bytes: 1_000, at: 1)
        backward.received(1, bytes: 12_500, at: 0.5)
        XCTAssertEqual(backward.reading().seconds, 0)
    }

    func testToleranceDecidesSteady() {
        let rate: (Double) -> Double = { t in 100 * mbps * (Int(t / 0.1) % 2 == 0 ? 1.01 : 0.99) }
        var loose = Trace()
        loose.transfer(1, from: 0, to: 2, rate: rate)
        XCTAssertEqual(loose.read(at: 1.51).kind, .steady)

        var strict = Trace(meter: RateMeter(tolerance: 0.01))
        strict.transfer(1, from: 0, to: 2, rate: rate)
        XCTAssertEqual(strict.read(at: 1.51).kind, .unsettled)
    }

    func testALongRunHoldsABoundedWindow() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 120, cadence: 0.01) { _ in 50 * mbps }
        let reading = trace.read(at: 120)
        XCTAssertEqual(reading.kind, .steady)
        XCTAssertEqual(reading.bps / mbps, 50, accuracy: 0.05)
        XCTAssertLessThanOrEqual(trace.meter.retainedSamples, 6 * trace.meter.span + 1)
    }

    func testStallsCountInTheReading() {
        // Shape of the TV runs: ~200 with 100ms stalls down to 1 Mb/s and bursts to 300 and 400.
        let run: [Double] = [180, 210, 1, 205, 300, 190, 1, 215, 400, 200, 195, 1, 210, 205, 220, 190, 200, 210, 185, 205,
                             200, 1, 215, 195, 210, 300, 190, 205, 200, 210]
        var trace = Trace()
        trace.transfer(1, from: 0, to: 3.2) { t in run[min(run.count - 1, Int(t / 0.1))] * mbps }
        let reading = trace.read(at: 3.05)
        XCTAssertEqual(reading.kind, .unsettled)
        XCTAssertEqual(reading.bps / mbps, run.reduce(0, +) / Double(run.count), accuracy: 0.2)
        XCTAssertEqual(reading.lowBps / mbps, 1, accuracy: 0.01)
    }

    func testSamplesAreTheSettledRates() {
        var trace = Trace()
        trace.transfer(1, from: 0, to: 1.5) { _ in 100 * mbps }
        _ = trace.read(at: 2)
        let samples = trace.meter.samples()
        XCTAssertEqual(samples.count, 15)
        for rate in samples { XCTAssertEqual(rate / mbps, 100, accuracy: 0.1) }
    }
}
