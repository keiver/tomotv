import Foundation

/// The link rate the master orders its variants by: a timed read of the source itself, since
/// AVPlayer measures only the loopback and the engine's own read loop starts after the grid.
extension RemuxSession {
    /// Time allowed for bytes to flow once the first one arrives, and before any arrives at all.
    static let linkProbeSeconds = 1.5
    static let linkProbeStartSeconds = 3.0

    /// How often the link is re-read while the session rides a rung. The rungs are transcoded as
    /// they are sent, so their transfers measure the server's encoder and never the wire: a link
    /// that recovered read 2.59 Mb/s from them, under a 6.3 Mb/s copy it could carry twice over.
    static let linkRepeatSeconds = 30.0

    func probeLink(reporting: Bool = false) {
        guard let url = URL(string: config.inputUrl) else { return finishLinkProbe(nil, reporting: reporting) }
        // Four seconds of source: enough on a fast link to leave TCP slow start behind.
        let wanted = max(512 * 1024, config.bandwidth / 2)
        var request = URLRequest(url: url, timeoutInterval: Self.linkProbeStartSeconds + Self.linkProbeSeconds)
        request.setValue("bytes=0-\(wanted - 1)", forHTTPHeaderField: "Range")
        let meter = LinkMeter(wanted: wanted, window: Self.linkProbeSeconds)
        let session = URLSession(configuration: .ephemeral, delegate: meter, delegateQueue: nil)
        session.dataTask(with: request).resume()
        _ = meter.done.wait(timeout: .now() + Self.linkProbeStartSeconds + Self.linkProbeSeconds + 0.5)
        session.invalidateAndCancel()
        finishLinkProbe(meter.bitsPerSecond(), reporting: reporting)
    }

    private func finishLinkProbe(_ bps: Double?, reporting: Bool) {
        stateLock.lock()
        // A later probe that read nothing keeps the reading it has; only the first one may be nil.
        if bps != nil || !reporting { measuredLinkBps = bps }
        linkProbeDone = true
        if let bps { pacedLinkBps = bps }
        let listedCopy = masterListedCopy
        let moved = reporting && bps != nil && (reportedLinkBps == nil || abs(bps! - reportedLinkBps!) > (reportedLinkBps! * 0.15))
        if moved { reportedLinkBps = bps }
        stateLock.unlock()
        if !reporting || bps != nil {
            NSLog("[LocalRemuxer] Slipstream: link measured %@", bps.map { String(format: "%.1f Mb/s", $0 / 1_000_000) } ?? "nothing (reads as slow)")
        }
        if moved, let bps { onLink?(["token": token, "bps": bps, "copyListed": listedCopy]) }
    }

    /// Re-reads the link while a rung is playing, so a recovery is seen even though every byte the
    /// session pulls comes from the server's transcoder. Ends with the session.
    func watchLinkWhileRidingTier() {
        guard !config.tiers.isEmpty, testLinkBps == nil else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while true {
                Thread.sleep(forTimeInterval: Self.linkRepeatSeconds)
                guard let self else { return }
                self.stateLock.lock()
                let over = self.cancelled || self.failed
                let riding = self.ridingTierLocked()
                self.stateLock.unlock()
                if over { return }
                guard riding else { continue }
                self.probeLink(reporting: true)
            }
        }
    }

    /// Blocks (bounded by the master budget) until the link probe has an answer.
    func awaitLinkProbe() {
        guard !config.tiers.isEmpty, testLinkBps == nil else { return }
        _ = waitUntil(deadline: masterBudgetLeft()) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.linkProbeDone || self.failed || self.cancelled
        }
    }
}

extension RemuxSession {
    /// Window the link rate is measured over: long enough to average a segment's bursts, short
    /// enough to follow a link that drops mid-playback.
    static let linkWindowSeconds = 8.0

    /// Folds one measured transfer into the session's link rate. Every source of server bytes feeds
    /// it (the engine's reads, the rung and audio fetches, the startup probe) and the rate is their
    /// SUM over the time any of them was in flight: one consumer's share is not the link, and
    /// pacing on a share is self-reinforcing (measured: it fell to 0.77 Mb/s on a 1.5 Mb/s link).
    func noteLinkSample(bytes: Int64, seconds: Double) {
        guard bytes > 0, seconds > 0 else { return }
        stateLock.lock()
        let now = Date()
        if now.timeIntervalSince(linkWindowStart) > Self.linkWindowSeconds {
            // Carry half of the closing window so one quiet moment cannot halve the rate.
            linkWindowBytes /= 2
            linkWindowBusySeconds /= 2
            linkWindowStart = now
        }
        linkWindowBytes += bytes
        linkWindowBusySeconds += seconds
        // Half a megabyte is enough to be a rate and not a burst (a thin early sample read
        // 0.152 Mb/s on a 0.6 Mb/s link, below every variant). The busy guard is only against
        // dividing by nothing: samples time the transfer alone, so a fast link's brief reads are
        // as true as a slow link's long ones.
        if linkWindowBytes > 512 * 1024, linkWindowBusySeconds > 0.05 {
            pacedLinkBps = Double(linkWindowBytes) * 8 / linkWindowBusySeconds
        }
        let rate = pacedLinkBps
        let listedCopy = masterListedCopy
        let moved = rate != nil && (reportedLinkBps == nil || abs(rate! - reportedLinkBps!) > (reportedLinkBps! * 0.15))
        if moved { reportedLinkBps = rate }
        stateLock.unlock()
        if moved, let rate { onLink?(["token": token, "bps": rate, "copyListed": listedCopy]) }
    }

}

/// A fetch's body transfer alone: the server's think time before the first byte is not the link.
final class TransferMeter: NSObject, URLSessionTaskDelegate {
    private let lock = NSLock()
    private var bytes: Int64 = 0
    private var seconds: Double = 0

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let transaction = metrics.transactionMetrics.last,
              let start = transaction.responseStartDate,
              let end = transaction.responseEndDate else { return }
        lock.lock()
        bytes = transaction.countOfResponseBodyBytesReceived
        seconds = end.timeIntervalSince(start)
        lock.unlock()
    }

    func read() -> (bytes: Int64, seconds: Double) {
        lock.lock()
        defer { lock.unlock() }
        return (bytes, seconds)
    }
}

/// Counts body bytes from the first one on and ends the transfer at the byte target or the window.
final class LinkMeter: NSObject, URLSessionDataDelegate {
    let done = DispatchSemaphore(value: 0)
    private let wanted: Int
    private let window: Double
    private let lock = NSLock()
    private var firstByteAt: Date?
    private var lastByteAt: Date?
    private var bytes = 0
    private var finished = false

    init(wanted: Int, window: Double) {
        self.wanted = wanted
        self.window = window
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let now = Date()
        // The first chunk's time is the server's response, not the link: rate counts what follows it.
        if firstByteAt == nil { firstByteAt = now } else { bytes += data.count }
        lastByteAt = now
        let enough = bytes >= wanted || now.timeIntervalSince(firstByteAt ?? now) >= window
        let shouldFinish = enough && !finished
        if shouldFinish { finished = true }
        lock.unlock()
        if shouldFinish {
            dataTask.cancel()
            done.signal()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let first = !finished
        finished = true
        lock.unlock()
        if first { done.signal() }
    }

    /// Body rate over the time bytes flowed; nil when too little arrived to say (reads as slow).
    func bitsPerSecond() -> Double? {
        lock.lock()
        defer { lock.unlock() }
        guard let first = firstByteAt, let last = lastByteAt, bytes > 0, last > first else { return nil }
        return Double(bytes) * 8 / last.timeIntervalSince(first)
    }
}
