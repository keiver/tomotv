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
        // Prove the canonical rung (0); higher rungs are validated at adoption.
        let produced = materializeTierSegment(rung: 0, target, demand: false)
        probeSeconds = Date().timeIntervalSince(started)
        let plays = segmentDurationSeconds(target)
        if produced != nil {
            NSLog("[LocalRemuxer] Slipstream: rung proved, opening segment %d took %.2fs for %.1fs of video", target, probeSeconds, plays)
        }
        guard produced == nil, !isTierDisabled else { return }
        stateLock.lock()
        let failure = lastTierFailure
        stateLock.unlock()
        dropTier("opening segment \(target) \(failure ?? "timed out")")
    }

    /// One server fetch for the tier: the body on 2xx, else the status (0 for a timeout or transport error).
    func fetchTier(_ url: URL) -> (data: Data?, status: Int) {
        let request = URLRequest(url: url, timeoutInterval: 30)
        let semaphore = DispatchSemaphore(value: 0)
        var result: Data? = nil
        var status = 0
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse { status = http.statusCode }
            if let data, (200..<300).contains(status) { result = data }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 35)
        return (result, status)
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
    func materializeTierSegment(rung: Int, _ n: Int, demand: Bool = true) -> URL? {
        dedupedMaterialization("t\(rung)-\(n)") { materializeTierSegmentLocked(rung: rung, n, demand: demand) }
    }

    func materializeTierSegmentLocked(rung: Int, _ n: Int, demand: Bool) -> URL? {
        if isTierDisabled { return nil }
        let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
        guard let remote = tierSegmentRemoteURL(rung: rung, n) else { return nil }
        let fetched = fetchTier(remote)
        guard let ts = fetched.data else {
            NSLog("[LocalRemuxer] Slipstream: rung %d segment %d fetch failed (HTTP %d)", rung, n, fetched.status)
            if fetched.status > 0 { recordTierFailure("HTTP \(fetched.status)") }
            return nil
        }
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
        // The playhead marker follows tier requests too: AVPlayer playing the
        // tier variant must still steer the primary producer's window (it can
        // switch back any moment) and the prune window.
        if demand {
            lastRequestedSegment = n
            lastTierDemandAt = Date()
        }
        stateLock.unlock()
        return mediaFile
    }

    func tierInitResponse(rung: Int) -> LocalHTTPResponse {
        guard tierActive, !isTierDisabled else { return .notFound }
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
            _ = self.materializeTierSegment(rung: rung, target)
            let file = self.dir.appendingPathComponent("t\(rung)-init.mp4")
            return FileManager.default.fileExists(atPath: file.path) ? file : nil
        }
    }

    func tierSegmentResponse(rung: Int, _ n: Int) -> LocalHTTPResponse {
        guard tierActive, !isTierDisabled else { return .notFound }
        stateLock.lock()
        let dead = failed || cancelled
        stateLock.unlock()
        if dead { return .notFound }
        let mediaFile = dir.appendingPathComponent("t\(rung)-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return .file(mediaFile, contentType: "video/iso.segment") }
        return .streamed(contentType: "video/iso.segment") { [weak self] in self?.materializeTierSegment(rung: rung, n) }
    }

}
