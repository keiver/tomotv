import Foundation

/// The link rate the master orders its variants by: a timed read of the source itself, since
/// AVPlayer measures only the loopback and the engine's own read loop starts after the grid.
extension RemuxSession {
    /// A probe runs this long after its first byte while the rate is still climbing, and may stop at
    /// the settled mark once it is level: a link-bound read is level from the start, a TCP ramp is not.
    static let linkProbeSeconds = 1.5
    static let linkProbeSettledSeconds = 0.75
    /// How long a first byte may take before the link reads as slow.
    static let linkProbeStartSeconds = 3.0

    /// How often the link is re-read while the session rides a rung. A rung's body is small and
    /// rides TCP's ramp, so it reads under a fast wire: a link that recovered to 30 Mb/s read
    /// 2.59 Mb/s from rungs, under a 6.3 Mb/s copy it could carry twice over.
    static let linkRepeatSeconds = 30.0
    /// The shortest gap between two probes, however many slow deliveries ask for one.
    static let linkReprobeGapSeconds = 8.0

    func probeLink(reporting: Bool = false) {
        guard let url = URL(string: config.inputUrl) else { return finishLinkProbe(nil, reporting: reporting) }
        // Four seconds of source: enough on a fast link to leave TCP slow start behind.
        let wanted = max(512 * 1024, config.bandwidth / 2)
        var request = URLRequest(url: url, timeoutInterval: Self.linkProbeStartSeconds + Self.linkProbeSeconds)
        request.setValue("bytes=0-\(wanted - 1)", forHTTPHeaderField: "Range")
        // A link already reading what the copy needs to LEAD the master has answered the last
        // question a fast link is asked, and every further probe byte is one the first copy
        // segment waits behind.
        let plenty = config.bandwidth > 0 ? Double(config.bandwidth) * Self.copyLeadsMargin : 0
        let meter = LinkMeter(wanted: wanted, window: Self.linkProbeSeconds, settled: Self.linkProbeSettledSeconds, plentyBps: plenty, beside: transfers)
        let session = URLSession(configuration: .ephemeral, delegate: meter, delegateQueue: nil)
        session.dataTask(with: request).resume()
        _ = meter.done.wait(timeout: .now() + Self.linkProbeStartSeconds + Self.linkProbeSeconds + 0.5)
        session.invalidateAndCancel()
        let reading = meter.reading()
        if meter.refused, !reporting {
            stateLock.lock()
            sourceRefused = true
            stateLock.unlock()
        }
        if let reading {
            NSLog("[LocalRemuxer] Slipstream: link probe read %.2f Mb/s alone, %.2f Mb/s with the %lld bytes carried beside it, over %.2fs",
                  reading.ownBps / 1_000_000, reading.linkBps / 1_000_000, reading.besideBytes, reading.seconds)
        }
        finishLinkProbe(reading?.linkBps, reporting: reporting)
    }

    private func finishLinkProbe(_ bps: Double?, reporting: Bool) {
        stateLock.lock()
        // A later probe that read nothing keeps the reading it has; only the first one may be nil.
        if bps != nil || !reporting { measuredLinkBps = bps }
        linkProbeDone = true
        lastLinkProbeAt = Date()
        if let bps {
            pacedLinkBps = bps
            wireLinkBps = bps
        }
        let listedCopy = copyVerdict != .withheld || sourceUnusable
        let moved = reporting && bps != nil && (reportedLinkBps == nil || abs(bps! - reportedLinkBps!) > (reportedLinkBps! * 0.15))
        if moved { reportedLinkBps = bps }
        stateLock.unlock()
        if !reporting || bps != nil {
            NSLog("[LocalRemuxer] Slipstream: link measured %@", bps.map { String(format: "%.1f Mb/s", $0 / 1_000_000) } ?? "nothing (reads as slow)")
        }
        if moved, let bps { onLink?(["token": token, "bps": bps, "copyListed": listedCopy]) }
        // The opening rung's server transcode starts the moment the link is known, not at the master.
        if !reporting, let bps, !config.isLive { chooseOpeningRung(linkBps: testLinkBps ?? bps) }
    }

    /// Re-reads the link while a rung is playing, so a recovery is seen even though every byte the
    /// session pulls comes from the server's transcoder. Ends with the session.
    func watchLinkWhileRidingTier() {
        guard !config.tiers.isEmpty, testLinkBps == nil else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while true {
                guard let signal = self?.reprobeSignal else { return }
                _ = signal.wait(timeout: .now() + Self.linkRepeatSeconds)
                guard let self else { return }
                self.stateLock.lock()
                let over = self.cancelled || self.failed
                let riding = self.ridingTierLocked()
                let tooSoon = Date().timeIntervalSince(self.lastLinkProbeAt) < Self.linkReprobeGapSeconds
                // Rungs arriving at the pace the wire last read are the wire, measured for free. A
                // probe there learns nothing and takes half a thin link for its length (measured
                // at 750 kb/s: the segment beside it ran past its own 6s and AVPlayer stepped down).
                let fresh = Date().timeIntervalSince(self.floorSeenAt) < Self.linkWindowSeconds
                let saturated = fresh && (self.floorLinkBps ?? 0) >= (self.wireLinkBps ?? .infinity) * 0.75
                let asked = self.reprobeAsked
                self.reprobeAsked = false
                self.stateLock.unlock()
                if over { return }
                guard riding, !tooSoon, asked || !saturated else { continue }
                self.probeLink(reporting: true)
            }
        }
    }

    /// A rung segment that took most of its own length to arrive is a link in trouble, and the next
    /// scheduled probe is up to thirty seconds away: ask for one now.
    func requestLinkReprobe() {
        stateLock.lock()
        let due = Date().timeIntervalSince(lastLinkProbeAt) >= Self.linkReprobeGapSeconds && !reprobeAsked
        if due { reprobeAsked = true }
        stateLock.unlock()
        if due { reprobeSignal.signal() }
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

    /// Whether the master lists the copy, decided once: the pipeline lets the source go on the same
    /// answer the master is written from. A probe that read nothing is a slow link, never an
    /// unlimited one, and a session with no ladder has only the copy to list.
    func decideCopy() -> Bool {
        guard !config.tiers.isEmpty, !config.isLive else { return true }
        awaitLinkProbe()
        stateLock.lock()
        defer { stateLock.unlock() }
        if copyVerdict == .undecided {
            let linkBps = testLinkBps ?? measuredLinkBps ?? 0
            let fits = linkBps > 0 && (config.bandwidth <= 0 || Double(config.bandwidth) * 1.2 <= linkBps)
            copyVerdict = fits ? .listed : .withheld
        }
        return copyVerdict == .listed
    }
}

extension RemuxSession {
    /// Window the link rate is measured over: long enough to average a segment's bursts, short
    /// enough to follow a link that drops mid-playback.
    static let linkWindowSeconds = 8.0

    /// One packet read off the source, by the pipeline thread alone. Sampled inside the segment too:
    /// a 4 MB segment on a slow link takes 20s, and the rate has to follow a link that drops in it.
    /// Alone on the link a source read IS the wire. Beside a rung or an audio transfer it is a share,
    /// noted as a floor of its own bytes: each transfer beside it notes itself, and the floor sums them.
    func noteSourceRead(bytes: Int64, seconds: Double, now: Date = Date()) {
        bytesSinceLinkSample += bytes
        readSecondsSinceLinkSample += seconds
        // The ledger carries the producer's bytes as they are read, so a probe beside it counts them.
        transfers.note(bytes: bytes)
        guard bytesSinceLinkSample >= 512 * 1024 else { return }
        let beside = transfers.carried() - besideAtLinkSample - bytesSinceLinkSample
        if beside > 0 {
            noteFloorSample(bytes: bytesSinceLinkSample, from: linkSampleStartedAt, to: now)
        } else {
            noteLinkSample(bytes: bytesSinceLinkSample, seconds: readSecondsSinceLinkSample)
        }
        restartLinkSample(now: now)
    }

    /// Starts the next sample from here: after one is taken, and after the producer sat out a hold.
    func restartLinkSample(now: Date = Date()) {
        besideAtLinkSample = transfers.carried()
        linkSampleStartedAt = now
        bytesSinceLinkSample = 0
        readSecondsSinceLinkSample = 0
    }

    /// Folds one read of the SOURCE into the link rate. The source is paced by nothing but the
    /// wire, and its reads come off one connection, so their times add without overlapping.
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
            wireLinkBps = pacedLinkBps
        }
        reportLinkLocked()
    }

    /// Folds one server rendition's transfer in. The server sends a segment whole once it is encoded
    /// (measured: 3.2 MB in 2 ms after a 1.06 s wait), and only the body is timed, so the pace is the
    /// wire's; a short body still reads under it on TCP's ramp. So it is a floor: it may raise the
    /// rate and never lowers it. Transfers overlap, a rung beside its audio, so the time is their union.
    func noteFloorSample(bytes: Int64, from start: Date, to end: Date) {
        guard bytes > 0, end > start else { return }
        stateLock.lock()
        floorSamples.append((start: start, end: end, bytes: bytes))
        let horizon = end.addingTimeInterval(-Self.linkWindowSeconds)
        floorSamples.removeAll { $0.end < horizon }
        let total = floorSamples.reduce(Int64(0)) { $0 + $1.bytes }
        var busy = 0.0
        var reach = Date.distantPast
        for sample in floorSamples.sorted(by: { $0.start < $1.start }) {
            let from = max(sample.start, reach)
            if sample.end > from { busy += sample.end.timeIntervalSince(from) }
            reach = max(reach, sample.end)
        }
        var outran = false
        if total > 512 * 1024, busy > 0.05 {
            let floor = Double(total) * 8 / busy
            floorLinkBps = floor
            floorSeenAt = end
            if floor > (pacedLinkBps ?? 0) { pacedLinkBps = floor }
            // Rungs outrunning the wire's last reading is a link that has recovered: read it now.
            outran = floor > (wireLinkBps ?? .infinity) * 1.25
        }
        reportLinkLocked()
        if outran { requestLinkReprobe() }
    }

    /// Tells the app when the rate has moved by more than 15%. Called with stateLock held; releases it.
    private func reportLinkLocked() {
        let rate = pacedLinkBps
        // An unusable source leaves no copy to climb back to, so the app is not asked to rebuild for one.
        let listedCopy = copyVerdict != .withheld || sourceUnusable
        let moved = rate != nil && (reportedLinkBps == nil || abs(rate! - reportedLinkBps!) > (reportedLinkBps! * 0.15))
        if moved { reportedLinkBps = rate }
        stateLock.unlock()
        if moved, let rate { onLink?(["token": token, "bps": rate, "copyListed": listedCopy]) }
    }
}

/// Every server transfer in flight, so a probe can count what the link carried beside it: a probe
/// reads its own share of a busy link, and the link is the sum.
final class TransferLedger {
    private let lock = NSLock()
    private var inFlight: [ObjectIdentifier: URLSessionTask] = [:]
    private var settled: Int64 = 0

    func begin(_ task: URLSessionTask) {
        lock.lock()
        inFlight[ObjectIdentifier(task)] = task
        lock.unlock()
    }

    func end(_ task: URLSessionTask) {
        lock.lock()
        if inFlight.removeValue(forKey: ObjectIdentifier(task)) != nil { settled += task.countOfBytesReceived }
        lock.unlock()
    }

    /// Bytes that arrived outside URLSession: the producer's own reads of the source.
    func note(bytes: Int64) {
        lock.lock()
        settled += bytes
        lock.unlock()
    }

    /// Body bytes received so far across every transfer this session has made.
    func carried() -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        return inFlight.values.reduce(settled) { $0 + $1.countOfBytesReceived }
    }
}

/// A fetch's body transfer alone: the server's think time before the first byte is not the link.
final class TransferMeter: NSObject, URLSessionTaskDelegate {
    private let lock = NSLock()
    private var bytes: Int64 = 0
    private var started: Date?
    private var ended: Date?

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let transaction = metrics.transactionMetrics.last,
              let start = transaction.responseStartDate,
              let end = transaction.responseEndDate else { return }
        lock.lock()
        bytes = transaction.countOfResponseBodyBytesReceived
        started = start
        ended = end
        lock.unlock()
    }

    /// The body's bytes and the span they arrived over; nil until the metrics land.
    func read() -> (bytes: Int64, start: Date, end: Date)? {
        lock.lock()
        defer { lock.unlock() }
        guard let started, let ended, bytes > 0, ended > started else { return nil }
        return (bytes, started, ended)
    }
}

/// Times a range read of the source from its first byte and ends it at the byte target, at a rate
/// that already settles the question, or at the window.
final class LinkMeter: NSObject, URLSessionDataDelegate {
    let done = DispatchSemaphore(value: 0)
    private let wanted: Int
    private let window: Double
    private let settled: Double
    private let plentyBps: Double
    private let beside: TransferLedger
    private let lock = NSLock()
    private var firstByteAt: Date?
    private var lastByteAt: Date?
    private var bytes = 0
    private var marks: [(elapsed: Double, link: Int)] = []
    private var besideAtFirst: Int64 = 0
    private var besideAtLast: Int64 = 0
    private var finished = false
    /// The server answered the read with an error status: a source that is not there, not a slow link.
    private(set) var refused = false

    /// Bytes that make a rate and not a burst, before a fast link may end the probe early.
    private static let plentyBytes = 1024 * 1024

    init(wanted: Int, window: Double, settled: Double, plentyBps: Double, beside: TransferLedger) {
        self.wanted = wanted
        self.window = window
        self.settled = settled
        self.plentyBps = plentyBps
        self.beside = beside
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        guard !(200..<300).contains(status) else { return completionHandler(.allow) }
        lock.lock()
        refused = true
        let first = !finished
        finished = true
        lock.unlock()
        completionHandler(.cancel)
        if first { done.signal() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let carried = beside.carried()
        lock.lock()
        let now = Date()
        // The first chunk's time is the server's response, not the link: rate counts what follows it.
        if firstByteAt == nil {
            firstByteAt = now
            besideAtFirst = carried
        } else {
            bytes += data.count
        }
        lastByteAt = now
        besideAtLast = carried
        let elapsed = now.timeIntervalSince(firstByteAt ?? now)
        // The link is this read plus what ran beside it; the read alone is a share that grows as
        // its neighbours finish, which reads as a ramp when the wire is level.
        let link = bytes + Int(besideAtLast - besideAtFirst)
        marks.append((elapsed, link))
        let plenty = plentyBps > 0 && link >= Self.plentyBytes && elapsed > 0 && Double(link) * 8 / elapsed >= plentyBps
        // Level means the second half of the span so far carried no more than half again the
        // first: a TCP ramp doubles, a link-bound read does not. A thin link delivers a chunk every
        // half second, so the halfway mark is the last one at or before it, not a clock tick.
        let atHalf = marks.last { $0.elapsed <= elapsed / 2 }?.link ?? 0
        let level = elapsed >= settled && atHalf > 0 && Double(link - atHalf) <= Double(atHalf) * 1.5
        let enough = bytes >= wanted || plenty || level || elapsed >= window
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

    /// The link over the time bytes flowed: this read plus what every other transfer carried
    /// beside it. nil when too little arrived to say (reads as slow).
    func reading() -> (linkBps: Double, ownBps: Double, besideBytes: Int64, seconds: Double)? {
        lock.lock()
        defer { lock.unlock() }
        guard let first = firstByteAt, let last = lastByteAt, bytes > 0, last > first else { return nil }
        let seconds = last.timeIntervalSince(first)
        let besideBytes = max(0, besideAtLast - besideAtFirst)
        return (Double(Int64(bytes) + besideBytes) * 8 / seconds, Double(bytes) * 8 / seconds, besideBytes, seconds)
    }
}
