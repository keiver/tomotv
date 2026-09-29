import Foundation

/// A link rate from the deliveries of any number of concurrent transfers, in fixed samples of flowing time.
/// The clock runs only while a transfer flows, so idle gaps and first-byte waits are not the link, and the
/// chunk that starts the clock is not counted: its bytes arrived while nothing was timed.
struct RateMeter {
    enum Kind: Equatable {
        /// The last window's samples lie within the tolerance of their mean (fast.com's stop rule).
        case steady
        /// A full window that has not settled, read by Speedtest's trimmed estimate over the whole run.
        case unsettled
        /// Less than one window of flowing time, read as its average.
        case short
    }

    struct Reading: Equatable {
        let kind: Kind
        let bps: Double
        let lowBps: Double
        let highBps: Double
        let seconds: Double
    }

    let interval: Double
    let span: Int
    let tolerance: Double

    private var clockStart: Double?
    private var pausedSeconds = 0.0
    private var pausedAt: Double?
    private var lastDelivery = -Double.infinity
    /// Flowing transfers and the clock time of each one's last delivery.
    private var flows: [Int: Double] = [:]
    private var closed: Set<Int> = []
    /// Bytes per sample of flowing time, starting at sample `firstBin`.
    private var bins: [Double] = []
    private var firstBin = 0
    private var counted = 0.0

    init(interval: Double = 0.1, span: Int = 10, tolerance: Double = 0.03) {
        self.interval = interval
        self.span = span
        self.tolerance = tolerance
    }

    mutating func received(_ transfer: Int, bytes: Int, at time: Double) {
        guard bytes > 0, time.isFinite, !closed.contains(transfer) else { return }
        let now = max(time, lastDelivery)
        lastDelivery = now
        guard let start = clockStart else {
            clockStart = now
            flows[transfer] = 0
            return
        }
        if let paused = pausedAt {
            pausedSeconds += now - paused
            pausedAt = nil
            flows[transfer] = now - start - pausedSeconds
            return
        }
        let at = now - start - pausedSeconds
        // A chunk holds what arrived since the transfer's previous one; a joining transfer's first lands at once.
        spread(Double(bytes), from: flows[transfer] ?? at, to: at)
        flows[transfer] = at
        trim()
    }

    mutating func ended(_ transfer: Int) {
        closed.insert(transfer)
        guard flows.removeValue(forKey: transfer) != nil, flows.isEmpty, pausedAt == nil else { return }
        pausedAt = lastDelivery
    }

    var isSteady: Bool { reading().kind == .steady }

    /// Samples held in memory, bounded however long the meter runs.
    var retainedSamples: Int { bins.count }

    func reading() -> Reading {
        let seconds = flowingSeconds
        let rates = (max(firstBin, settledBins - span)..<settledBins).map { bytes(in: $0) * 8 / interval }
        guard rates.count >= span else {
            let bps = seconds > 0 ? counted * 8 / seconds : 0
            return Reading(kind: .short, bps: bps, lowBps: rates.min() ?? bps, highBps: rates.max() ?? bps, seconds: seconds)
        }
        let mean = rates.reduce(0, +) / Double(span)
        let low = rates.min() ?? 0
        let high = rates.max() ?? 0
        guard mean > 0, high - low <= tolerance * mean else {
            let run = (firstBin..<settledBins).map { bytes(in: $0) }
            return Reading(kind: .unsettled, bps: Self.trimmedBps(run, interval: interval), lowBps: low, highBps: high, seconds: seconds)
        }
        return Reading(kind: .steady, bps: mean, lowBps: low, highBps: high, seconds: seconds)
    }

    /// Every settled sample's rate, oldest first.
    func samples() -> [Double] {
        (firstBin..<settledBins).map { bytes(in: $0) * 8 / interval }
    }

    /// Speedtest's estimate (FastBTS, NSDI '21, §2): the run cut into 20 slices of equal volume, the 5
    /// slowest and 2 fastest dropped, the rest averaged. A ramp and a stall fall among the slowest.
    static func trimmedBps(_ bins: [Double], interval: Double) -> Double {
        let total = bins.reduce(0, +)
        guard total > 0 else { return 0 }
        func time(reaching volume: Double) -> Double {
            var sum = 0.0
            for (index, bytes) in bins.enumerated() where bytes > 0 {
                if sum + bytes >= volume { return (Double(index) + (volume - sum) / bytes) * interval }
                sum += bytes
            }
            return Double(bins.count) * interval
        }
        let slice = total / 20
        let durations = (0..<20).map { time(reaching: slice * Double($0 + 1)) - time(reaching: slice * Double($0)) }.sorted()
        let kept = durations.dropFirst(2).dropLast(5).reduce(0, +)
        return kept > 0 ? slice * 13 * 8 / kept : 0
    }

    private var flowingSeconds: Double {
        guard let start = clockStart else { return 0 }
        return lastDelivery - start - pausedSeconds
    }

    /// Samples no transfer can add to: every flowing transfer's next chunk lands after them.
    private var settledBins: Int {
        let settled = pausedAt != nil ? flowingSeconds : (flows.values.min() ?? flowingSeconds)
        return max(0, Int(settled / interval))
    }

    private func bytes(in bin: Int) -> Double {
        let index = bin - firstBin
        return index >= 0 && index < bins.count ? bins[index] : 0
    }

    private mutating func spread(_ bytes: Double, from start: Double, to end: Double) {
        counted += bytes
        let last = Int(end / interval)
        if bins.count <= last - firstBin { bins += Array(repeating: 0, count: last - firstBin + 1 - bins.count) }
        guard end > start else { return bins[last - firstBin] += bytes }
        for bin in max(firstBin, Int(start / interval))...last {
            let overlap = min(end, Double(bin + 1) * interval) - max(start, Double(bin) * interval)
            if overlap > 0 { bins[bin - firstBin] += bytes * overlap / (end - start) }
        }
    }

    private mutating func trim() {
        let stale = settledBins - span - firstBin
        guard stale > span * 4 else { return }
        bins.removeFirst(stale)
        firstBin += stale
    }
}
