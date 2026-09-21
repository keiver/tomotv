//
//  RemuxSession+Tier.swift
//  TomoTV
//
//  Slipstream tier serving: adopting the server's segment grid, probing and
//  materializing rung segments, and retiring the tier when the server stops
//  delivering.
//

import Foundation

enum SlipstreamSupplier: Hashable {
    case source
    case rung(Int)
    case audio(Int)
}

enum SupplierFailure: Equatable {
    case transport
    case http(Int)
    case invalidMedia
    case unsupported
}

struct SupplierRecoveryState {
    private(set) var failures = 0
    private(set) var failure: SupplierFailure?
    private(set) var retryAt = Date.distantPast

    mutating func record(_ failure: SupplierFailure, now: Date) {
        failures = min(failures + 1, 6)
        self.failure = failure
        let delays: [Double] = [1, 2, 4, 8, 15, 30]
        retryAt = failure == .unsupported ? .distantFuture : now.addingTimeInterval(delays[failures - 1])
    }
}

extension RemuxSession {
    // MARK: - Slipstream tier serving

    func serverRungInitData(_ data: Data) -> Data {
        guard config.videoRange == "PQ" || config.videoRange == "HLG" else { return data }
        return InitSegmentSdr.normalise(data) ?? data
    }

    func tierSegmentRemoteURL(rung: Int, _ n: Int) -> URL? {
        stateLock.lock()
        let segments = tierSegments[rung] ?? []
        stateLock.unlock()
        guard n >= 0, n < segments.count, rung >= 0, rung < config.tiers.count, let base = URL(string: config.tiers[rung].playlistUrl) else { return nil }
        // Playlist segment URLs are relative to the rung's main.m3u8.
        return URL(string: segments[n].url, relativeTo: base)?.absoluteURL
    }

    func recordSupplierFailure(_ supplier: SlipstreamSupplier, failure: SupplierFailure, now: Date = Date()) {
        stateLock.lock()
        guard !cancelled, !failed else { return stateLock.unlock() }
        supplierRecovery[supplier, default: SupplierRecoveryState()].record(failure, now: now)
        stateLock.unlock()
    }

    func recordSupplierSuccess(_ supplier: SlipstreamSupplier) {
        stateLock.lock()
        supplierRecovery[supplier] = nil
        stateLock.unlock()
    }

    func supplierResponseDeferral(_ supplier: SlipstreamSupplier, now: Date = Date()) -> LocalHTTPResponse? {
        stateLock.lock()
        defer { stateLock.unlock() }
        if failed || cancelled { return .notFound }
        guard let recovery = supplierRecovery[supplier] else { return nil }
        if recovery.failure == .unsupported { return .notFound }
        if now < recovery.retryAt { return .temporarilyUnavailable }
        return nil
    }

    func awaitSupplierRetry(_ supplier: SlipstreamSupplier, request: SegmentRequest? = nil, key: String? = nil, counted: Bool = false) -> Bool {
        let deadline = Date().addingTimeInterval(30)
        while true {
            stateLock.lock()
            let dead = cancelled || failed
            let recovery = supplierRecovery[supplier]
            stateLock.unlock()
            if dead || request?.isAbandoned == true || recovery?.failure == .unsupported { return false }
            if counted, let key {
                fetchLock.lock()
                let abandoned = fetchInterest[key] == nil
                fetchLock.unlock()
                if abandoned { return false }
            }
            let now = Date()
            if now >= (recovery?.retryAt ?? .distantPast) { return true }
            if now >= deadline { return false }
            usleep(100_000)
        }
    }

    func recordSupplierFetchFailure(_ supplier: SlipstreamSupplier, status: Int, key: String? = nil, counted: Bool = false) {
        if counted, let key {
            fetchLock.lock()
            let abandoned = fetchInterest[key] == nil
            fetchLock.unlock()
            if abandoned { return }
        }
        recordSupplierFailure(supplier, failure: status > 0 && !(200..<300).contains(status) ? .http(status) : .transport)
    }

    func probeTier() {
        var probedRung: Int?
        defer {
            stateLock.lock()
            tierProbeResolved = true
            if let probedRung, openingRung == probedRung { openingRungResolved = true }
            stateLock.unlock()
        }
        guard tierActive else { return }
        awaitLinkProbe()
        stateLock.lock()
        let copyLeads = copyLeadsLocked(linkBps: testLinkBps ?? measuredLinkBps ?? 0)
        let canonicalRung = tierSegments.keys.sorted().first { !rungsUnavailable.contains($0) }
        stateLock.unlock()
        guard !copyLeads, let canonicalRung else { return }
        probedRung = canonicalRung
        let target = segmentIndex(atSeconds: config.startOffsetSeconds)
        let started = Date()
        let produced = materializeOpeningSegment(rung: canonicalRung, target)
        probeSeconds = Date().timeIntervalSince(started)
        if produced != nil {
            NSLog("[LocalRemuxer] Slipstream: rung proved, opening segment %d took %.2fs for %.1fs of video", target, probeSeconds, segmentDurationSeconds(target))
        }
    }

    /// One server fetch for the tier: the body on 2xx, else the status (0 for a timeout or transport error).
    /// `counted` marks a fetch made for player requests (withFetchInterest): when they have all
    /// left before it starts, it does not start.
    func fetchTier(_ url: URL, key: String? = nil, counted: Bool = false) -> (data: Data?, status: Int, seconds: Double) {
        let request = URLRequest(url: url, timeoutInterval: 30)
        let semaphore = DispatchSemaphore(value: 0)
        let resultLock = NSLock()
        var result: Data? = nil
        var status = 0
        var completed = false
        let meter = TransferMeter()
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            resultLock.lock()
            if let http = response as? HTTPURLResponse { status = http.statusCode }
            if error == nil, let data, !data.isEmpty, (200..<300).contains(status) { result = data }
            completed = true
            resultLock.unlock()
            semaphore.signal()
        }
        task.delegate = meter
        transfers.begin(task)
        if let key, counted {
            // One lock with the release that cancels: it either finds this task or has already run.
            fetchLock.lock()
            let unwanted = fetchInterest[key] == nil
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
        let timedOut = semaphore.wait(timeout: .now() + 35) == .timedOut
        if timedOut { task.cancel() }
        if let key, counted {
            fetchLock.lock()
            fetchTasks[key] = nil
            fetchLock.unlock()
        }
        transfers.end(task)
        let transfer = meter.read()
        resultLock.lock()
        let body = completed && !timedOut ? result : nil
        let responseStatus = status
        resultLock.unlock()
        if body != nil, let transfer { noteFloorSample(bytes: transfer.bytes, from: transfer.start, to: transfer.end) }
        return (body, responseStatus, transfer.map { $0.end.timeIntervalSince($0.start) } ?? 0)
    }

    func tierPlaylistResponse(rung: Int) -> LocalHTTPResponse {
        guard config.tiers.indices.contains(rung) else { return .notFound }
        stateLock.lock()
        let unavailable = failed || cancelled || adoptedStarts.isEmpty || rungsUnavailable.contains(rung)
        let cached = !(tierSegments[rung]?.isEmpty ?? true)
        stateLock.unlock()
        if unavailable { return .notFound }
        if !cached, let deferred = supplierResponseDeferral(.rung(rung)) { return deferred }
        guard let playlist = tierPlaylist(rung: rung) else {
            stateLock.lock()
            let retired = rungsUnavailable.contains(rung)
            stateLock.unlock()
            return retired ? .notFound : supplierResponseDeferral(.rung(rung)) ?? .temporarilyUnavailable
        }
        return .data(Data(playlist.utf8), contentType: "application/vnd.apple.mpegurl")
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
            dedupedMaterialization(key) { materializeTierSegmentLocked(rung: rung, n, demand: demand, counted: request != nil, request: request) }
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

    func materializeTierSegmentLocked(rung: Int, _ n: Int, demand: Bool, counted: Bool = false, request: SegmentRequest? = nil) -> URL? {
        stateLock.lock()
        let dead = cancelled || failed || rungsUnavailable.contains(rung)
        stateLock.unlock()
        if dead { return nil }
        let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
        guard awaitSupplierRetry(.rung(rung), request: request),
              awaitRungAdmission(rung, request: request) else { return nil }
        guard adoptRung(rung), let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
        let fetched = fetchTier(remote, key: "t\(rung)-\(n)", counted: counted)
        guard let ts = fetched.data else {
            NSLog("[LocalRemuxer] Slipstream: rung %d segment %d fetch failed (HTTP %d)", rung, n, fetched.status)
            recordSupplierFetchFailure(.rung(rung), status: fetched.status, key: "t\(rung)-\(n)", counted: counted)
            return nil
        }
        // A segment that took most of its own length to arrive cannot be played from for long:
        // the link is read again now rather than at the next thirty-second mark.
        if demand, fetched.seconds > segmentDurationSeconds(n) * 0.8 { requestLinkReprobe() }
        let start = segmentStartSeconds(n)
        guard let rewrapped = TierRewrapper.rewrap(tsData: ts, targetStartSeconds: start) else {
            recordSupplierFailure(.rung(rung), failure: .invalidMedia)
            return nil
        }
        do {
            try rewrapped.mediaSegment.write(to: mediaFile, options: .atomic)
            let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
            if !FileManager.default.fileExists(atPath: initFile.path) {
                try serverRungInitData(rewrapped.initSegment).write(to: initFile, options: .atomic)
            }
        } catch {
            return nil
        }
        recordSupplierSuccess(.rung(rung))
        stateLock.lock()
        tierMaterialized[rung, default: []].insert(n)
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
        stateLock.lock()
        let retired = cancelled || failed || rungsUnavailable.contains(rung)
        stateLock.unlock()
        if retired || !config.tiers.indices.contains(rung) { return .notFound }
        let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
        if FileManager.default.fileExists(atPath: initFile.path) { return .file(initFile, contentType: "video/mp4") }
        guard tierActive else { return .notFound }
        if let deferred = supplierResponseDeferral(.rung(rung)) { return deferred }
        if let deferred = rungResponseDeferral(rung) { return deferred }
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
            let opens = self.openingRung == rung
            self.stateLock.unlock()
            if opens {
                let opening = self.dir.appendingPathComponent("t\(rung)-seg\(self.segmentIndex(atSeconds: self.config.startOffsetSeconds)).m4s")
                _ = self.waitUntil(deadline: Self.openingInitHoldSeconds) { [weak self] in
                    guard let self else { return true }
                    if FileManager.default.fileExists(atPath: opening.path) { return true }
                    self.stateLock.lock()
                    defer { self.stateLock.unlock() }
                    return self.openingRung != rung || self.openingRungResolved || self.failed || self.cancelled
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
            stateLock.lock()
            let dead = cancelled || failed || rungsUnavailable.contains(rung)
            stateLock.unlock()
            if dead { return nil }
            let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
            if FileManager.default.fileExists(atPath: initFile.path) { return initFile }
            guard awaitSupplierRetry(.rung(rung)), awaitRungAdmission(rung) else { return nil }
            guard adoptRung(rung), let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
            let fetched = TierHeadFetcher.fetch(remote, bytes: Self.tierInitHeadBytes, timeout: 30, ledger: transfers)
            guard let head = fetched.data else {
                NSLog("[LocalRemuxer] Slipstream: rung %d segment %d head fetch failed (HTTP %d)", rung, n, fetched.status)
                recordSupplierFetchFailure(.rung(rung), status: fetched.status)
                return nil
            }
            let aligned = head.prefix(head.count / 188 * 188)
            guard let rewrapped = TierRewrapper.rewrap(tsData: aligned, targetStartSeconds: segmentStartSeconds(n)) else {
                return nil
            }
            do {
                try serverRungInitData(rewrapped.initSegment).write(to: initFile, options: .atomic)
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
            stateLock.lock()
            let dead = cancelled || failed || rungsUnavailable.contains(rung)
            stateLock.unlock()
            if dead { return nil }
            let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
            if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
            guard awaitSupplierRetry(.rung(rung)), awaitRungAdmission(rung) else { return nil }
            guard adoptRung(rung), let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
            let fetch = TierSegmentFetch(url: remote, headBytes: Self.tierInitHeadBytes, timeout: 30, ledger: transfers)
            let initFile = dir.appendingPathComponent("t\(rung)-init.mp4")
            _ = dedupedMaterialization("t\(rung)-init") { () -> URL? in
                if FileManager.default.fileExists(atPath: initFile.path) { return initFile }
                guard let head = fetch.head() else { return nil }
                let aligned = head.prefix(head.count / 188 * 188)
                guard let rewrapped = TierRewrapper.rewrap(tsData: aligned, targetStartSeconds: segmentStartSeconds(n)) else { return nil }
                try? serverRungInitData(rewrapped.initSegment).write(to: initFile, options: .atomic)
                return initFile
            }
            let whole = fetch.whole()
            guard let ts = whole.data else {
                NSLog("[LocalRemuxer] Slipstream: rung %d segment %d fetch failed (HTTP %d)", rung, n, whole.status)
                recordSupplierFetchFailure(.rung(rung), status: whole.status)
                return nil
            }
            if let span = whole.span { noteFloorSample(bytes: span.bytes, from: span.start, to: span.end) }
            guard let rewrapped = TierRewrapper.rewrap(tsData: ts, targetStartSeconds: segmentStartSeconds(n)) else {
                recordSupplierFailure(.rung(rung), failure: .invalidMedia)
                return nil
            }
            do {
                try rewrapped.mediaSegment.write(to: mediaFile, options: .atomic)
                if !FileManager.default.fileExists(atPath: initFile.path) { try serverRungInitData(rewrapped.initSegment).write(to: initFile, options: .atomic) }
            } catch {
                return nil
            }
            recordSupplierSuccess(.rung(rung))
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
            guard let self else { return }
            self.awaitGrid()
            _ = self.materializeOpeningSegment(rung: rung, target)
            self.stateLock.lock()
            if self.openingRung == rung { self.openingRungResolved = true }
            self.stateLock.unlock()
        }
    }

    /// What the producer does while AVPlayer plays a rung the link has room beside.
    enum Follow: Equatable { case run, hold, seek(Int) }

    /// Segments of the copy kept ready past AVPlayer's latest rung fetch.
    static let followSegments = 2

    /// Whether the copy is worth keeping ready under a rung: a master that names it and a wire that
    /// carries it beside the rung being played. Caller holds stateLock.
    func copyFollowsLocked() -> Bool {
        guard copyAnnounced, !followDisabled, !sourceReleased, !config.isLive, sourceBandwidth > 0, let wire = wireLinkBps else { return false }
        let rung = config.tiers.indices.contains(lastTierRung) ? config.tiers[lastTierRung].bandwidth : 0
        return wire >= Double(sourceBandwidth) * 1.2 + Double(rung)
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
        rungLeads && !openingRungResolved
    }

    func tierSegmentResponse(rung: Int, _ n: Int) -> LocalHTTPResponse {
        guard config.tiers.indices.contains(rung), n >= 0, n < segmentCount else { return .notFound }
        stateLock.lock()
        let dead = failed || cancelled || rungsUnavailable.contains(rung)
        stateLock.unlock()
        if dead { return .notFound }
        let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
        let cached = FileManager.default.fileExists(atPath: mediaFile.path)
        if !cached {
            guard tierActive else { return .notFound }
            if let deferred = supplierResponseDeferral(.rung(rung)) { return deferred }
            if let deferred = rungResponseDeferral(rung) { return deferred }
        }
        // Marked at the request, a segment already on disk included: where AVPlayer is on the ladder
        // steers the producer.
        stateLock.lock()
        lastRequestedSegment = n
        lastTierDemandAt = Date()
        lastTierRung = rung
        stateLock.unlock()
        if cached { return .file(mediaFile, contentType: "video/iso.segment") }
        return .segment(contentType: "video/iso.segment", lead: Self.stypBox, padding: Self.freeBox) { [weak self] request in self?.materializeTierSegment(rung: rung, n, request: request) }
    }

    func awaitRungAdmission(_ rung: Int, request: SegmentRequest? = nil) -> Bool {
        let deadline = Date().addingTimeInterval(30)
        while let deferral = rungResponseDeferral(rung) {
            guard case .temporarilyUnavailable = deferral,
                  request?.isAbandoned != true, Date() < deadline else { return false }
            usleep(100_000)
        }
        return request?.isAbandoned != true
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
