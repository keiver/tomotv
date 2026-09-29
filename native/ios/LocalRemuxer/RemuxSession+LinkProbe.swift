import Foundation

enum LinkProbeFailure: Equatable {
    case transient(Int)
    case authentication(Int)
    case unavailable(Int)
    case rangeUnsupported(Int)

    var usesServerTransferFallback: Bool {
        switch self {
        case .transient: return false
        case .authentication, .unavailable, .rangeUnsupported: return true
        }
    }

    static func classify(status: Int) -> LinkProbeFailure? {
        switch status {
        case 200..<300: return nil
        case 401, 403: return .authentication(status)
        case 404, 410: return .unavailable(status)
        case 405, 416: return .rangeUnsupported(status)
        default: return .transient(status)
        }
    }
}

/// The session's one link rate, with what read it and when.
struct LinkEstimate {
    enum Source: String { case probe, reads, rungs, playlist }
    let bps: Double
    let source: Source
    /// The probe's RateMeter verdict; nil for the other sources.
    let confidence: RateMeter.Kind?
    let at: Date
}

/// The link rate the master orders its variants by: a timed read of the source itself, since
/// AVPlayer measures only the loopback and the engine's own read loop starts after the grid.
extension RemuxSession {
    /// A probe runs this long after its first byte unless its RateMeter reads steady first.
    static let linkProbeSeconds = 1.5
    /// Probe readings the link is the median of (ExoPlayer's sliding median): one probe that caught
    /// a stall (95 Mb/s between 209 and 225, measured) moves nothing until the next one agrees.
    static let linkProbeReadingsKept = 3
    /// How long a first byte may take before the link reads as slow.
    static let linkProbeStartSeconds = 3.0

    /// How often the link is re-read while the session rides a rung. A rung's body is small and
    /// rides TCP's ramp, so it reads under a fast wire: a link that recovered to 30 Mb/s read
    /// 2.59 Mb/s from rungs, under a 6.3 Mb/s copy it could carry twice over.
    static let linkRepeatSeconds = 30.0
    /// The shortest gap between two probes, however many slow deliveries ask for one.
    static let linkReprobeGapSeconds = 8.0
    /// Buffer AVPlayer holds on the copy before a link reading may take the copy from it: a rung
    /// took 3.1 to 4.55s to start (measured), plus the 6s copy segment already in flight.
    static let copyReservoirSeconds = 12.0
    /// A buffer report older than this no longer describes the player.
    static let playerReportStaleSeconds = 3.0

    func probeLink(reporting: Bool = false) {
        guard let url = URL(string: config.inputUrl) else { return finishLinkProbe(nil, reporting: reporting) }
        var request = URLRequest(url: url, timeoutInterval: Self.linkProbeStartSeconds + Self.linkProbeSeconds)
        for (name, value) in config.httpHeaders { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue("bytes=0-", forHTTPHeaderField: "Range")
        let probe = RateProbe(request: request, budget: Self.linkProbeSeconds, firstByteWithin: Self.linkProbeStartSeconds,
                              beside: { [transfers] in transfers.carried() })
        transfers.probeStarted()
        let outcome = probe.run()
        transfers.probeEnded()
        if let reading = outcome.reading {
            NSLog("[LocalRemuxer] Slipstream: link probe read %.2f Mb/s (%@, %.2f to %.2f) over %.2fs",
                  reading.bps / 1_000_000, "\(reading.kind)", reading.lowBps / 1_000_000, reading.highBps / 1_000_000, reading.seconds)
        }
        // Under a window a mid-session probe timed mostly the producer's bytes beside it
        // (measured: 0.01 to 0.26s probes read 275 to 752 Mb/s on a 150 to 237 Mb/s link).
        if reporting, outcome.reading?.kind == .short {
            NSLog("[LocalRemuxer] Slipstream: link probe too short to read, the link reading stands")
            return discardLinkProbe()
        }
        let reading = outcome.reading.flatMap { $0.bps > 0 ? $0 : nil }
        finishLinkProbe(reading?.bps, reporting: reporting, failure: outcome.failure ?? (reading == nil ? .transient(0) : nil),
                        confidence: reading?.kind ?? .steady)
    }

    /// A probe that measured nothing usable: the reading stands, only the probe clock moves.
    func discardLinkProbe() {
        stateLock.lock()
        lastLinkProbeAt = Date()
        stateLock.unlock()
    }

    func finishLinkProbe(_ bps: Double?, reporting: Bool, failure: LinkProbeFailure? = nil, confidence: RateMeter.Kind = .steady) {
        stateLock.lock()
        guard !cancelled, !failed else { return stateLock.unlock() }
        sourceProbeFailure = failure
        linkProbeDone = true
        lastLinkProbeAt = Date()
        var median: Double?
        var confirm = false
        if let bps {
            probeReadings = Array((probeReadings + [bps]).suffix(Self.linkProbeReadingsKept))
            // Two readings have no median: the held one stands until a third decides.
            let held = probeReadings.count == 2 ? probeReadings[0] : probeReadings.sorted()[probeReadings.count / 2]
            median = held
            confirm = abs(bps - held) > held * 0.25
            setLinkLocked(held, .probe, confidence: confidence)
            linkWindowBytes = 0
            linkWindowBusySeconds = 0
            linkWindowStart = Date()
        } else if usesServerCapacityLocked,
                  let fallback = floorLinkBps.map({ ($0, LinkEstimate.Source.rungs) }) ?? playlistLinkBps.map({ ($0, .playlist) }) {
            setLinkLocked(fallback.0, fallback.1)
        }
        let listedCopy = copyAnnounced
        let readings = probeReadings.count
        let rate = wireLinkBps
        let moved = reporting && rate != nil && (reportedLinkBps == nil || abs(rate! - reportedLinkBps!) > (reportedLinkBps! * 0.15))
        if moved { reportedLinkBps = rate }
        stateLock.unlock()
        if let bps, let median {
            NSLog("[LocalRemuxer] Slipstream: link measured %.1f Mb/s, the link is %.1f Mb/s (median of %d)", bps / 1_000_000, median / 1_000_000, readings)
        } else if !reporting {
            NSLog("[LocalRemuxer] Slipstream: link measured nothing (reads as slow)")
        }
        if moved, let rate { onLink?(["token": token, "bps": rate, "copyListed": listedCopy]) }
        if confirm { requestLinkReprobe() }
        // The opening rung's server transcode starts the moment the link is known, not at the master.
        if !reporting, let rate, !config.isLive { chooseOpeningRung(linkBps: testLinkBps ?? rate) }
    }

    private var usesServerCapacityLocked: Bool {
        sourceUnusable || sourceState == .retryWait || sourceProbeFailure?.usesServerTransferFallback == true
    }

    private func setLinkLocked(_ bps: Double, _ source: LinkEstimate.Source, confidence: RateMeter.Kind? = nil) {
        guard bps.isFinite, bps > 0 else { return }
        link = LinkEstimate(bps: bps, source: source, confidence: confidence, at: Date())
    }

    func notePlaylistTransfer(bytes: Int64, from start: Date, to end: Date) {
        guard bytes > 0, end > start else { return }
        let rate = Double(bytes) * 8 / end.timeIntervalSince(start)
        stateLock.lock()
        guard !cancelled, !failed else { return stateLock.unlock() }
        if playlistLinkBps == nil { playlistLinkBps = rate }
        if usesServerCapacityLocked, wireLinkBps == nil { setLinkLocked(rate, .playlist) }
        reportLinkLocked()
    }

    /// Re-reads the link while a rung is playing, so a recovery is seen even though every byte the
    /// session pulls comes from the server's transcoder. Ends with the session.
    func watchLinkWhileRidingTier() {
        guard !config.tiers.isEmpty, testLinkBps == nil else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while true {
                guard let signal = self?.reprobeSignal else { return }
                let delay: Double
                if let session = self {
                    session.stateLock.lock()
                    delay = session.reprobeAsked ? max(0, Self.linkReprobeGapSeconds - Date().timeIntervalSince(session.lastLinkProbeAt)) : Self.linkRepeatSeconds
                    session.stateLock.unlock()
                } else {
                    return
                }
                _ = signal.wait(timeout: .now() + delay)
                guard let self else { return }
                self.stateLock.lock()
                let over = self.cancelled || self.failed
                let riding = self.ridingTierLocked()
                let tooSoon = Date().timeIntervalSince(self.lastLinkProbeAt) < Self.linkReprobeGapSeconds
                // Rungs arriving at the pace the wire last read are the wire, measured for free. A
                // probe there learns nothing and takes half a thin link for its length (measured
                // at 750 kb/s: the segment beside it ran past its own 6s and AVPlayer stepped down).
                let fresh = Date().timeIntervalSince(self.floorSeenAt) < Self.linkWindowSeconds
                let wire = self.wireLinkBps ?? .infinity
                let floor = self.floorLinkBps ?? 0
                let saturated = !self.usesServerCapacityLocked && fresh && floor >= wire * 0.75 && floor <= wire * 1.25
                let asked = self.reprobeAsked
                let shouldProbe = !tooSoon && (asked || (riding && !saturated))
                if shouldProbe { self.reprobeAsked = false }
                self.stateLock.unlock()
                if over { return }
                guard shouldProbe else { continue }
                self.probeLink(reporting: true)
            }
        }
    }

    /// A rung segment that took most of its own length to arrive is a link in trouble, and the next
    /// scheduled probe is up to thirty seconds away: ask for one now.
    func requestLinkReprobe() {
        stateLock.lock()
        let due = !cancelled && !failed && !reprobeAsked
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
            let linkBps = testLinkBps ?? wireLinkBps ?? 0
            let fits = linkBps > 0 && (sourceBandwidth <= 0 || Double(sourceBandwidth) * 1.2 <= linkBps)
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
        // A probe is not in the ledger's bytes, so its overlap is read off the probe mark.
        let mark = transfers.probeMark()
        let besideProbe = mark != probeMarkAtLinkSample || mark % 2 == 1
        if beside > 0 || besideProbe {
            noteFloorSample(bytes: bytesSinceLinkSample, from: linkSampleStartedAt, to: now, serverTransfer: false, asksReprobe: !besideProbe)
        } else {
            noteLinkSample(bytes: bytesSinceLinkSample, seconds: readSecondsSinceLinkSample)
        }
        restartLinkSample(now: now)
    }

    /// Starts the next sample from here: after one is taken, after the producer sat out a hold, and
    /// after a restart moved the read to a new connection.
    func restartLinkSample(now: Date = Date()) {
        besideAtLinkSample = transfers.carried()
        probeMarkAtLinkSample = transfers.probeMark()
        linkSampleStartedAt = now
        bytesSinceLinkSample = 0
        readSecondsSinceLinkSample = 0
    }

    /// AVPlayer's buffer past the playhead, from the app; a report after a seek starts filling again.
    func notePlayerBuffer(aheadSeconds: Double, sinceSeek: Bool) {
        stateLock.lock()
        playerAheadSeconds = max(0, aheadSeconds)
        playerAheadAt = Date()
        if sinceSeek { playerBufferFilled = false }
        if aheadSeconds >= Self.copyReservoirSeconds { playerBufferFilled = true }
        stateLock.unlock()
    }

    /// The copy's declared bandwidth while the copy may be served, else 0: the app keeps its
    /// variant cap at or above it so AVPlayer is never capped off a copy the engine admits.
    func copyCapFloor() -> Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let bandwidth = announcedCopyBandwidth, copyAnnounced, !sourceReleased, !sourceUnusable else { return 0 }
        let wire = testLinkBps ?? wireLinkBps ?? 0
        let affordable = sourceBandwidth <= 0 || wire >= Double(sourceBandwidth) * 1.2
        return affordable || copyBufferHoldsLocked() ? bandwidth : 0
    }

    private func freshPlayerAheadLocked() -> Double? {
        guard let ahead = playerAheadSeconds, Date().timeIntervalSince(playerAheadAt) <= Self.playerReportStaleSeconds else { return nil }
        return ahead
    }

    /// AVPlayer plays the copy with the reservoir full: the buffer keeps the copy, not a link reading.
    func copyBufferHoldsLocked() -> Bool {
        guard !ridingTierLocked(), let ahead = freshPlayerAheadLocked() else { return false }
        return ahead >= Self.copyReservoirSeconds
    }

    /// Whether the producer's reads may lower the link. On the copy they may not until its buffer has
    /// filled and drained back into the reservoir: before it fills the probe decides, above it the buffer.
    /// Riding a rung the probe decides (T106: reads of 92 to 141 Mb/s beside probes of 165 to 284 capped the copy out).
    private func sourceReadsLowerLinkLocked() -> Bool {
        guard !ridingTierLocked() else { return false }
        // No report yet is the start of a ladder session: the player has not loaded, the probe decides.
        guard playerAheadSeconds != nil else { return config.tiers.isEmpty || config.isLive }
        guard let ahead = freshPlayerAheadLocked() else { return true }
        return playerBufferFilled && ahead < Self.copyReservoirSeconds
    }

    /// Folds one read of the SOURCE into the link rate. The source is paced by nothing but the
    /// wire, and its reads come off one connection, so their times add without overlapping.
    func noteLinkSample(bytes: Int64, seconds: Double) {
        guard bytes > 0, seconds > 0 else { return }
        stateLock.lock()
        guard !cancelled, !failed else { return stateLock.unlock() }
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
            let rate = Double(linkWindowBytes) * 8 / linkWindowBusySeconds
            if wireLinkBps == nil || (rate < wireLinkBps! && sourceReadsLowerLinkLocked()) {
                setLinkLocked(rate, .reads)
                // A drained buffer is the link now: older probes must not outvote it.
                probeReadings = []
            }
            let outran = rate > (wireLinkBps ?? .infinity) * 1.25
            reportLinkLocked()
            if outran { requestLinkReprobe() }
            return
        }
        reportLinkLocked()
    }

    func noteFloorSample(bytes: Int64, from start: Date, to end: Date, serverTransfer: Bool = true, asksReprobe: Bool = true) {
        guard bytes > 0, end > start else { return }
        stateLock.lock()
        guard !cancelled, !failed else { return stateLock.unlock() }
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
            if serverTransfer, usesServerCapacityLocked { setLinkLocked(floor, .rungs) }
            outran = asksReprobe && (wireLinkBps == nil || floor > (wireLinkBps ?? .infinity) * 1.25)
        }
        reportLinkLocked()
        if outran { requestLinkReprobe() }
    }

    /// Tells the app when the rate has moved by more than 15%. Called with stateLock held; releases it.
    private func reportLinkLocked() {
        let rate = wireLinkBps
        let listedCopy = copyAnnounced
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
    private var closed = false
    /// Bumped as each source probe starts and ends, so odd means one is running.
    private var probes = 0

    func probeStarted() {
        lock.lock()
        probes += 1
        lock.unlock()
    }

    func probeEnded() {
        lock.lock()
        probes += 1
        lock.unlock()
    }

    /// Compared with the mark a sample began under, it says whether a probe overlapped the sample.
    func probeMark() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return probes
    }

    /// A closed ledger cancels the task before it can resume: a stopped session starts nothing on the server.
    func begin(_ task: URLSessionTask) {
        lock.lock()
        let refused = closed
        if !refused { inFlight[ObjectIdentifier(task)] = task }
        lock.unlock()
        if refused { task.cancel() }
    }

    func close() {
        lock.lock()
        closed = true
        let tasks = Array(inFlight.values)
        lock.unlock()
        tasks.forEach { $0.cancel() }
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
