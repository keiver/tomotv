import Foundation

/// A link rate from the deliveries of any number of concurrent transfers: every byte over the flowing time
/// since the first one (NDT7's cumulative rate), stalls included. The clock runs only while a transfer flows,
/// and the chunk that starts it is not counted: its bytes arrived while nothing was timed.
struct RateMeter {
    enum Kind: Equatable {
        /// At least one window of flowing time.
        case full
        /// Under one window: a TCP ramp or one buffer's drain, not the link.
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

    private var clockStart: Double?
    private var pausedSeconds = 0.0
    private var pausedAt: Double?
    private var lastDelivery = -Double.infinity
    /// Flowing transfers and the clock time of each one's last delivery.
    private var flows: [Int: Double] = [:]
    private var closed: Set<Int> = []
    /// Bytes per sample of flowing time, starting at sample `firstBin`: the spread the log reports.
    private var bins: [Double] = []
    private var firstBin = 0
    private var counted = 0.0

    init(interval: Double = 0.1, span: Int = 10) {
        self.interval = interval
        self.span = span
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

    /// The read stops at `time` with transfers still open: the silence since their last chunk is the link too.
    mutating func close(at time: Double) {
        guard clockStart != nil, pausedAt == nil, !flows.isEmpty, time > lastDelivery else { return }
        lastDelivery = time
        flows.removeAll()
        pausedAt = time
    }

    /// Samples held in memory, bounded however long the meter runs.
    var retainedSamples: Int { bins.count }

    func reading() -> Reading {
        let seconds = flowingSeconds
        let bps = seconds > 0 ? counted * 8 / seconds : 0
        let window = samples().suffix(span)
        let kind: Kind = seconds < Double(span) * interval ? .short : .full
        return Reading(kind: kind, bps: bps, lowBps: window.min() ?? bps, highBps: window.max() ?? bps, seconds: seconds)
    }

    /// Every settled sample's rate, oldest first.
    func samples() -> [Double] {
        (firstBin..<settledBins).map { bytes(in: $0) * 8 / interval }
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
