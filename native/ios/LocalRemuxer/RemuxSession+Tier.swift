//
//  RemuxSession+Tier.swift
//  TomoTV
//
//  Slipstream tier serving: adopting the server's segment grid, probing and
//  materializing rung segments, and retiring the tier when the server stops
//  delivering.
//

import Foundation

extension RemuxSession {
    // MARK: - Slipstream tier serving

    func tierSegmentRemoteURL(rung: Int, _ n: Int) -> URL? {
        stateLock.lock()
        let segments = tierSegments[rung] ?? []
        stateLock.unlock()
        guard n >= 0, n < segments.count, rung >= 0, rung < config.tiers.count, let base = URL(string: config.tiers[rung].playlistUrl) else { return nil }
        // Playlist segment URLs are relative to the rung's main.m3u8.
        return URL(string: segments[n].url, relativeTo: base)?.absoluteURL
    }

    /// Fetch + rewrap tier segment n into the session dir (blocking; runs on
    /// the uncapped serving queue behind chunked early headers). The rewrap is
    /// stateless — the server transcodes on demand and predicts sequential
    /// access itself, so there is no tier producer to manage.
    /// Records one structural failure; past the limit the tier is dead for the
    /// session and every tier/audio-lo route answers .notFound instantly.
    func recordTierFailure(_ reason: String) {
        stateLock.lock()
        tierRewrapFailures += 1
        lastTierFailure = reason
        let dead = tierRewrapFailures >= Self.tierFailureLimit
        stateLock.unlock()
        if dead { dropTier("\(reason), after \(Self.tierFailureLimit) failures") }
    }

    /// Whether a fetch that returned nothing was the server saying no. A 2xx whose body never
    /// finished is a transfer that broke off, most often the player giving the segment up: two of
    /// those in a row are an ordinary drop, not a dead ladder.
    static func refused(_ status: Int) -> Bool { status > 0 && !(200..<300).contains(status) }

    /// Retires the tier for the session and stops the server transcodes it started.
    func dropTier(_ reason: String) {
        stateLock.lock()
        guard !tierDisabled else { return stateLock.unlock() }
        tierDisabled = true
        tierDropReason = reason
        let listed = tierListed
        stateLock.unlock()
        NSLog("[LocalRemuxer] Slipstream: tier %@: %@", listed ? "dropped" : "declined", reason)
        killTierTranscode()
        if listed { onTier?(["token": token, "state": "dropped", "reason": reason]) }
    }

    /// Fetches the tier's opening segment in the background: a server whose playlist parses but
    /// whose transcoder fails or times out is retired here (dropTier), which disarms the tier for
    /// the session. The master lists the rung on grid adoption, so this runs concurrent with the
    /// player's startup rather than gating the first frame.
    func probeTier() {
        defer {
            stateLock.lock()
            tierProbeResolved = true
            stateLock.unlock()
        }
        guard tierActive, !isTierDisabled else { return }
        let target = segmentIndex(atSeconds: config.startOffsetSeconds)
        let started = Date()
        // Prove the canonical rung (0) with its opening segment, fetched once for both things
        // AVPlayer is about to ask for: the init is cut from the head as soon as it lands (an init
        // that waits out the whole segment misses AVPlayer's 6s watchdog at 0.6 Mb/s, measured:
        // -12889 "No response for map"), and the segment is written when the rest arrives.
        let produced = materializeOpeningSegment(rung: 0, target)
        probeSeconds = Date().timeIntervalSince(started)
        if produced != nil {
            NSLog("[LocalRemuxer] Slipstream: rung proved, opening segment %d took %.2fs for %.1fs of video", target, probeSeconds, segmentDurationSeconds(target))
        }
        guard produced == nil, !isTierDisabled else { return }
        stateLock.lock()
        let failure = lastTierFailure
        stateLock.unlock()
        dropTier("opening segment \(target) \(failure ?? "timed out")")
    }

    /// One server fetch for the tier: the body on 2xx, else the status (0 for a timeout or transport error).
    /// `counted` marks a fetch made for player requests (withFetchInterest): when they have all
    /// left before it starts, it does not start.
    func fetchTier(_ url: URL, key: String? = nil, counted: Bool = false) -> (data: Data?, status: Int, seconds: Double) {
        let request = URLRequest(url: url, timeoutInterval: 30)
        let semaphore = DispatchSemaphore(value: 0)
        var result: Data? = nil
        var status = 0
        let meter = TransferMeter()
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse { status = http.statusCode }
            if let data, (200..<300).contains(status) { result = data }
            semaphore.signal()
        }
        task.delegate = meter
        transfers.begin(task)
        if let key {
            // One lock with the release that cancels: it either finds this task or has already run.
            fetchLock.lock()
            let unwanted = counted && fetchInterest[key] == nil
            if !unwanted { fetchTasks[key] = task }
            fetchLock.unlock()
            if unwanted {
                task.cancel()
                transfers.end(task)
                return (nil, 0, 0)
            }
        }
        task.resume()
        // The request timeout is an idle one: a transfer that trickles runs past it, so it ends here.
        if semaphore.wait(timeout: .now() + 35) == .timedOut { task.cancel() }
        if let key {
            fetchLock.lock()
            fetchTasks[key] = nil
            fetchLock.unlock()
        }
        transfers.end(task)
        let transfer = meter.read()
        if result != nil, let transfer { noteFloorSample(bytes: transfer.bytes, from: transfer.start, to: transfer.end) }
        return (result, status, transfer.map { $0.end.timeIntervalSince($0.start) } ?? 0)
    }

    var isTierDisabled: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return tierDisabled
    }

    /// One materialization per segment key at a time; losers wait, then find
    /// the winner's file on disk via the fast path inside `work`.
    func dedupedMaterialization<T>(_ key: String, _ work: () -> T?) -> T? {
        inFlightCondition.lock()
        while inFlightKeys.contains(key) { inFlightCondition.wait() }
        inFlightKeys.insert(key)
        inFlightCondition.unlock()
        defer {
            inFlightCondition.lock()
            inFlightKeys.remove(key)
            inFlightCondition.broadcast()
            inFlightCondition.unlock()
        }
        return work()
    }

    /// `demand` false is the probe: it must not read as the player living on the tier, or the
    /// producer holds before the preflight has segment 0.
    func materializeTierSegment(rung: Int, _ n: Int, demand: Bool = true, request: SegmentRequest? = nil) -> URL? {
        let key = "t\(rung)-\(n)"
        return withFetchInterest(key, request) {
            dedupedMaterialization(key) { materializeTierSegmentLocked(rung: rung, n, demand: demand, counted: request != nil) }
        }
    }

    /// Counts a player's request as wanting `key` while `work` runs. When the last one wanting it
    /// goes away, the transfer behind it is cancelled: after a drop, a segment AVPlayer gave up
    /// would otherwise keep the thin link from the small one it asked for instead.
    func withFetchInterest<T>(_ key: String, _ request: SegmentRequest?, _ work: () -> T) -> T {
        guard let request else { return work() }
        let once = NSLock()
        var released = false
        let release = { [weak self] in
            once.lock()
            let first = !released
            released = true
            once.unlock()
            guard first, let self else { return }
            self.fetchLock.lock()
            let left = (self.fetchInterest[key] ?? 1) - 1
            self.fetchInterest[key] = left > 0 ? left : nil
            let task = left > 0 ? nil : self.fetchTasks[key]
            self.fetchLock.unlock()
            task?.cancel()
        }
        fetchLock.lock()
        fetchInterest[key, default: 0] += 1
        fetchLock.unlock()
        request.onAbandon(release)
        defer {
            request.settle()
            release()
        }
        return work()
    }

    func materializeTierSegmentLocked(rung: Int, _ n: Int, demand: Bool, counted: Bool = false) -> URL? {
        if isTierDisabled { return nil }
        let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
        guard adoptRung(rung), let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
        let fetched = fetchTier(remote, key: "t\(rung)-\(n)", counted: counted)
        guard let ts = fetched.data else {
            NSLog("[LocalRemuxer] Slipstream: rung %d segment %d fetch failed (HTTP %d)", rung, n, fetched.status)
            if Self.refused(fetched.status) { recordTierFailure("HTTP \(fetched.status)") }
            return nil
        }
        // A segment that took most of its own length to arrive cannot be played from for long:
        // the link is read again now rather than at the next thirty-second mark.
        if demand, fetched.seconds > segmentDurationSeconds(n) * 0.8 { requestLinkReprobe() }
        let start = segmentStartSeconds(n)
        guard let rewrapped = TierRewrapper.rewrap(tsData: ts, targetStartSeconds: start) else {
            recordTierFailure("rewrap failed")
            return nil
        }
        do {
            try rewrapped.mediaSegment.write(to: mediaFile)
            let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
            if !FileManager.default.fileExists(atPath: initFile.path) {
                try rewrapped.initSegment.write(to: initFile)
            }
        } catch {
            return nil
        }
        stateLock.lock()
        tierMaterialized[rung, default: []].insert(n)
        // The limit is on failures in a row: two bad answers across a whole film are not a dead tier.
        tierRewrapFailures = 0
        // The playhead marker follows tier requests too: AVPlayer playing the
        // tier variant must still steer the primary producer's window (it can
        // switch back any moment) and the prune window.
        if demand {
            lastRequestedSegment = n
            lastTierDemandAt = Date()
        }
        let producerGone = sourceReleased
        stateLock.unlock()
        // The producer prunes as it finishes segments; a session without one prunes here, or the
        // rungs of a whole film pile up on disk.
        if demand, producerGone { pruneSegments(outside: (n - keepWindow)...(n + keepWindow)) }
        return mediaFile
    }

    func tierInitResponse(rung: Int) -> LocalHTTPResponse {
        guard tierActive, !isTierDisabled else { return .notFound }
        stateLock.lock()
        let retired = rungsUnavailable.contains(rung)
        stateLock.unlock()
        if retired { return .notFound }
        let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
        if FileManager.default.fileExists(atPath: initFile.path) { return .file(initFile, contentType: "video/mp4") }
        // The init falls out of materializing any segment (byte-stable across
        // all of them — bitexact muxing). Use the playhead's segment so a
        // mid-film switch doesn't spin the server transcode up at zero.
        stateLock.lock()
        let target = lastRequestedSegment
        stateLock.unlock()
        return .streamed(contentType: "video/mp4") { [weak self] in
            guard let self else { return nil }
            let file = self.dir.appendingPathComponent("t\(rung)-init.mp4")
            // AVPlayer asks for the opening segment the moment it has the init, and starts on one
            // segment when that segment arrives at once but waits for two when it has to watch it
            // download (measured at 0.6 Mb/s: 8.2s against 10.2s to a first frame). So the init is
            // held for the opening fetch, never near the 6s AVPlayer allows a map request.
            self.stateLock.lock()
            let opens = rung == (self.openingRung ?? 0)
            self.stateLock.unlock()
            if opens {
                let opening = self.dir.appendingPathComponent("t\(rung)-seg\(self.segmentIndex(atSeconds: self.config.startOffsetSeconds)).m4s")
                _ = self.waitUntil(deadline: Self.openingInitHoldSeconds) { [weak self] in
                    guard let self else { return true }
                    if FileManager.default.fileExists(atPath: opening.path) { return true }
                    self.stateLock.lock()
                    defer { self.stateLock.unlock() }
                    return (rung == 0 ? self.tierProbeResolved : self.openingRungResolved) || self.failed || self.cancelled
                }
            }
            // The head of a segment carries the whole init (measured: 32KB of a 3.2MB 720p segment
            // gives identical bytes), so a cold rung starts without fetching the full segment.
            if self.materializeTierInit(rung: rung, from: target) == nil {
                _ = self.materializeTierSegment(rung: rung, target)
            }
            return FileManager.default.fileExists(atPath: file.path) ? file : nil
        }
    }

    /// Bytes of a segment's head fetched for its init; twice the measured need.
    static let tierInitHeadBytes = 64 * 1024
    /// How long the opening rung's init waits for the opening segment to land.
    static let openingInitHoldSeconds = 4.0

    func materializeTierInit(rung: Int, from n: Int) -> URL? {
        dedupedMaterialization("t\(rung)-init") {
            let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
            if FileManager.default.fileExists(atPath: initFile.path) { return initFile }
            if isTierDisabled { return nil }
            guard adoptRung(rung), let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
            let fetched = TierHeadFetcher.fetch(remote, bytes: Self.tierInitHeadBytes, timeout: 30, ledger: transfers)
            guard let head = fetched.data else {
                NSLog("[LocalRemuxer] Slipstream: rung %d segment %d head fetch failed (HTTP %d)", rung, n, fetched.status)
                if Self.refused(fetched.status) { recordTierFailure("HTTP \(fetched.status)") }
                return nil
            }
            let aligned = head.prefix(head.count / 188 * 188)
            guard let rewrapped = TierRewrapper.rewrap(tsData: aligned, targetStartSeconds: segmentStartSeconds(n)) else {
                recordTierFailure("rewrap failed")
                return nil
            }
            do {
                try rewrapped.initSegment.write(to: initFile)
            } catch {
                return nil
            }
            return initFile
        }
    }

    /// The opening rung's segment `n` from one transfer: the init from its head, the segment from the whole.
    /// Both keys are held while it runs, so the player's own requests wait on it instead of
    /// fetching the same bytes again.
    func materializeOpeningSegment(rung: Int, _ n: Int) -> URL? {
        dedupedMaterialization("t\(rung)-\(n)") {
            let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
            if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
            guard !isTierDisabled, adoptRung(rung), let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
            let fetch = TierSegmentFetch(url: remote, headBytes: Self.tierInitHeadBytes, timeout: 30, ledger: transfers)
            let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
            _ = dedupedMaterialization("t\(rung)-init") { () -> URL? in
                if FileManager.default.fileExists(atPath: initFile.path) { return initFile }
                guard let head = fetch.head() else { return nil }
                let aligned = head.prefix(head.count / 188 * 188)
                guard let rewrapped = TierRewrapper.rewrap(tsData: aligned, targetStartSeconds: segmentStartSeconds(n)) else { return nil }
                try? rewrapped.initSegment.write(to: initFile)
                return initFile
            }
            let whole = fetch.whole()
            if let span = whole.span { noteFloorSample(bytes: span.bytes, from: span.start, to: span.end) }
            guard let ts = whole.data else {
                NSLog("[LocalRemuxer] Slipstream: rung %d segment %d fetch failed (HTTP %d)", rung, n, whole.status)
                if Self.refused(whole.status) { recordTierFailure("HTTP \(whole.status)") }
                return nil
            }
            guard let rewrapped = TierRewrapper.rewrap(tsData: ts, targetStartSeconds: segmentStartSeconds(n)) else {
                recordTierFailure("rewrap failed")
                return nil
            }
            do {
                try rewrapped.mediaSegment.write(to: mediaFile)
                if !FileManager.default.fileExists(atPath: initFile.path) { try rewrapped.initSegment.write(to: initFile) }
            } catch {
                return nil
            }
            stateLock.lock()
            tierMaterialized[rung, default: []].insert(n)
            stateLock.unlock()
            return mediaFile
        }
    }

    /// Starts the opening fetch of a rung above the canonical one, which probeTier does not cover.
    func fetchOpeningSegment(rung: Int) {
        let target = segmentIndex(atSeconds: config.startOffsetSeconds)
        if audioLoActive {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self, let segments = self.adoptAudioLo(0) else { return }
                _ = self.materializeAudioLoSegment(position: 0, n: self.audioLoIndex(segments, at: self.config.startOffsetSeconds))
            }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.awaitGrid()
            _ = self?.materializeOpeningSegment(rung: rung, target)
            self?.stateLock.lock()
            self?.openingRungResolved = true
            self?.stateLock.unlock()
        }
    }

    /// What the producer does while AVPlayer plays a rung the link has room beside.
    enum Follow: Equatable { case run, hold, seek(Int) }

    /// Segments of the copy kept ready past AVPlayer's latest rung fetch.
    static let followSegments = 2

    /// Whether the copy is worth keeping ready under a rung: a master that names it and a wire that
    /// carries it beside the rung being played. Caller holds stateLock.
    func copyFollowsLocked() -> Bool {
        guard copyAnnounced, !followDisabled, !sourceReleased, !config.isLive, config.bandwidth > 0, let wire = wireLinkBps else { return false }
        let rung = config.tiers.indices.contains(lastTierRung) ? config.tiers[lastTierRung].bandwidth : 0
        return wire >= Double(config.bandwidth) * 1.2 + Double(rung)
    }

    /// Runs while the producer is inside the span past AVPlayer's latest rung fetch, moves to the
    /// first segment of it still missing, and holds once it is full. Caller holds stateLock.
    func followLocked() -> Follow {
        let head = lastRequestedSegment
        let last = min(head + Self.followSegments, segmentCount - 1)
        let completed = renditions.first?.completed ?? []
        guard head <= last, let next = (head...last).first(where: { !completed.contains($0) }) else { return .hold }
        if (head...last).contains(producingSegment), !completed.contains(producingSegment) { return .run }
        // One move per segment length: AVPlayer filling its buffer runs the head past the producer
        // many times a second, and each move is a new request of the server.
        guard Date().timeIntervalSince(lastFollowSeekAt) >= Self.segmentDuration else { return .hold }
        lastFollowSeekAt = Date()
        return .seek(next)
    }

    /// A rung's opening segment has the link to itself: the copy is not pulled beside it. Caller holds stateLock.
    func openingHoldLocked() -> Bool {
        rungLeads && !((openingRung ?? 0) == 0 ? tierProbeResolved : openingRungResolved)
    }

    func tierSegmentResponse(rung: Int, _ n: Int) -> LocalHTTPResponse {
        guard tierActive, !isTierDisabled else { return .notFound }
        stateLock.lock()
        let dead = failed || cancelled || rungsUnavailable.contains(rung)
        stateLock.unlock()
        if dead { return .notFound }
        // Marked at the request, a segment already on disk included: where AVPlayer is on the ladder
        // steers the producer.
        stateLock.lock()
        lastRequestedSegment = n
        lastTierDemandAt = Date()
        lastTierRung = rung
        stateLock.unlock()
        let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return .file(mediaFile, contentType: "video/iso.segment") }
        return .segment(contentType: "video/iso.segment", lead: Self.stypBox, padding: Self.freeBox) { [weak self] request in self?.materializeTierSegment(rung: rung, n, request: request) }
    }

}

/// The first `bytes` of a response, then the transfer is cancelled. nil on an error status or a timeout.
final class TierHeadFetcher: NSObject, URLSessionDataDelegate {
    private let wanted: Int
    private let done = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var data = Data()
    private var ok = false
    private var finished = false
    fileprivate var status = 0

    private init(wanted: Int) {
        self.wanted = wanted
    }

    /// The shared session with a per-task delegate, not a session of its own: the rung's other
    /// fetches go through the shared pool, and a session built here reuses none of it.
    static func fetch(_ url: URL, bytes: Int, timeout: Double, ledger: TransferLedger) -> (data: Data?, status: Int) {
        let fetcher = TierHeadFetcher(wanted: bytes)
        let task = URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: timeout))
        task.delegate = fetcher
        ledger.begin(task)
        task.resume()
        _ = fetcher.done.wait(timeout: .now() + timeout + 1)
        task.cancel()
        ledger.end(task)
        fetcher.lock.lock()
        defer { fetcher.lock.unlock() }
        let usable = fetcher.ok && !fetcher.data.isEmpty
        return (usable ? fetcher.data : nil, fetcher.status)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        lock.lock()
        status = code
        ok = (200..<300).contains(code)
        let allow = ok
        lock.unlock()
        completionHandler(allow ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        lock.lock()
        data.append(chunk)
        let enough = data.count >= wanted && !finished
        if enough { finished = true }
        lock.unlock()
        if enough {
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
}

/// One transfer of a whole segment that also hands over its head as soon as that much has landed.
final class TierSegmentFetch: NSObject, URLSessionDataDelegate {
    private let headBytes: Int
    private let timeout: Double
    private let ledger: TransferLedger
    private let headReady = DispatchSemaphore(value: 0)
    private let finished = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var data = Data()
    private var status = 0
    private var headSignalled = false
    private var complete = false
    private var span: (bytes: Int64, start: Date, end: Date)?
    private var task: URLSessionDataTask?

    init(url: URL, headBytes: Int, timeout: Double, ledger: TransferLedger) {
        self.headBytes = headBytes
        self.timeout = timeout
        self.ledger = ledger
        super.init()
        let task = URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: timeout))
        task.delegate = self
        self.task = task
        ledger.begin(task)
        task.resume()
    }

    /// The first `headBytes` of the body (or all of a shorter one); nil on an error status or a timeout.
    func head() -> Data? {
        _ = headReady.wait(timeout: .now() + timeout + 1)
        lock.lock()
        defer { lock.unlock() }
        return (200..<300).contains(status) && !data.isEmpty ? data.prefix(headBytes) : nil
    }

    /// The whole body once the transfer ends, with the span its bytes arrived over.
    func whole() -> (data: Data?, status: Int, span: (bytes: Int64, start: Date, end: Date)?) {
        _ = finished.wait(timeout: .now() + timeout + 5)
        lock.lock()
        defer { lock.unlock() }
        if !complete { task?.cancel() }
        return (complete && (200..<300).contains(status) && !data.isEmpty ? data : nil, status, span)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        lock.lock()
        status = code
        lock.unlock()
        completionHandler((200..<300).contains(code) ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        lock.lock()
        data.append(chunk)
        let ready = data.count >= headBytes && !headSignalled
        if ready { headSignalled = true }
        lock.unlock()
        if ready { headReady.signal() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let transaction = metrics.transactionMetrics.last, let start = transaction.responseStartDate, let end = transaction.responseEndDate, end > start else { return }
        lock.lock()
        span = (transaction.countOfResponseBodyBytesReceived, start, end)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        ledger.end(task)
        lock.lock()
        complete = error == nil
        let wake = !headSignalled
        headSignalled = true
        lock.unlock()
        if wake { headReady.signal() }
        finished.signal()
    }
}
