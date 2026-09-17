import Foundation

/// The link rate the master orders its variants by: a timed read of the source itself, since
/// AVPlayer measures only the loopback and the engine's own read loop starts after the grid.
extension RemuxSession {
    /// Time allowed for bytes to flow once the first one arrives, and before any arrives at all.
    static let linkProbeSeconds = 1.5
    static let linkProbeStartSeconds = 3.0

    func probeLink() {
        guard let url = URL(string: config.inputUrl) else { return finishLinkProbe(nil) }
        // Four seconds of source: enough on a fast link to leave TCP slow start behind.
        let wanted = max(512 * 1024, config.bandwidth / 2)
        var request = URLRequest(url: url, timeoutInterval: Self.linkProbeStartSeconds + Self.linkProbeSeconds)
        request.setValue("bytes=0-\(wanted - 1)", forHTTPHeaderField: "Range")
        let meter = LinkMeter(wanted: wanted, window: Self.linkProbeSeconds)
        let session = URLSession(configuration: .ephemeral, delegate: meter, delegateQueue: nil)
        session.dataTask(with: request).resume()
        _ = meter.done.wait(timeout: .now() + Self.linkProbeStartSeconds + Self.linkProbeSeconds + 0.5)
        session.invalidateAndCancel()
        finishLinkProbe(meter.bitsPerSecond())
    }

    private func finishLinkProbe(_ bps: Double?) {
        stateLock.lock()
        measuredLinkBps = bps
        linkProbeDone = true
        if let bps { pacedLinkBps = bps }
        stateLock.unlock()
        NSLog("[LocalRemuxer] Slipstream: link measured %@", bps.map { String(format: "%.1f Mb/s", $0 / 1_000_000) } ?? "nothing (reads as slow)")
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
        // Enough of both to be a rate and not a burst: a thin early sample read 0.152 Mb/s on a
        // 0.6 Mb/s link, which is below every variant.
        if linkWindowBusySeconds > 0.5, linkWindowBytes > 512 * 1024 {
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
