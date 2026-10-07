//
//  RemuxSession+Lifecycle.swift
//  TomoTV
//
//  Session lifecycle: start, stop, cancellation, and directory cleanup.
//

import Foundation

extension RemuxSession {
    // MARK: - Lifecycle

    func start() {
        stateLock.lock()
        pipelineStarted = true
        stateLock.unlock()
        let thread = Thread { [weak self] in
            self?.runPipeline()
        }
        thread.name = "tv.tomo.localremux"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    func stop() {
        stateLock.lock()
        cancelled = true
        let frames = frameGrabber
        let iframeFrames = iframeGrabber
        let iframes = iframeStore
        stateLock.unlock()
        frames?.stop()
        iframeFrames?.stop()
        iframes?.stop()
        // Before the stop requests, so no request of this session reaches the server after them.
        transfers.close()
        fireStopRequests()
        // The pipeline thread notices `cancelled` between packets (or through
        // the AVIO interrupt callback during a blocking read) and exits; the
        // directory is removed on the next session's init as well.
        try? FileManager.default.removeItem(at: dir)
    }

    /// Fire-and-forget: the app names what ends its server-side work (a transcode keyed by the
    /// session it started) and the engine sends it as the session goes.
    func fireStopRequests() {
        for stopRequest in config.stopRequests {
            guard let url = URL(string: stopRequest.url) else { continue }
            var request = URLRequest(url: url, timeoutInterval: 5)
            request.httpMethod = stopRequest.method
            URLSession.shared.dataTask(with: request).resume()
        }
    }

    var isCancelled: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cancelled
    }

    /// A failure from any thread also ends a blocking open or read.
    var hasFailed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return failed
    }

    var isSourceReleased: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return sourceReleased
    }

    var reportsCopyListed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return copyAnnounced
    }

    /// Tracks only the demuxer can serve: an image subtitle with no raw server stream, and an
    /// engine text track with no server WebVTT. Either one keeps the source open.
    var demuxerOwesTracks: Bool {
        config.subtitles.contains { ($0.isImage && $0.serverSupUrl.isEmpty) || ($0.isEngineText && $0.serverVttUrl.isEmpty) }
    }

    func releaseSource(because reason: String, unusable: Bool = false) -> Bool {
        guard !config.isLive, !config.tiers.isEmpty, !demuxerOwesTracks else { return false }
        // The grid first: the ladder and its audio group exist only once it is adopted.
        awaitGrid()
        guard tierOffered, config.audioTracks.isEmpty || audioLoActive else { return false }
        stateLock.lock()
        // A copy-only master listed no rungs to carry the session, so the copy is never let go to them.
        let free = !cancelled && !failed && !copyOnlyMaster
        if free {
            copyVerdict = .withheld
            sourceState = unusable ? .unavailable : .dormant
            sourceReady = false
            sourceTakeoverSegment = nil
            recovering = false
            lastTierDemandAt = Date()
        }
        stateLock.unlock()
        guard free else { return false }
        NSLog("[LocalRemuxer] Slipstream: source let go, the rungs carry the session (%@)", reason)
        startServerImageSubtitles()
        // The opening audio segment costs a server spin-up of its own; overlap it with the rung's.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, let segments = self.adoptAudioLo(0) else { return }
            _ = self.materializeAudioLoSegment(position: 0, n: self.audioLoIndex(segments, at: self.config.startOffsetSeconds))
        }
        return true
    }

    /// A source lost after the master named the copy beside the rungs: the copy's routes answer 410
    /// from here and AVPlayer carries on with the rungs. A copy-only master has none, so it fails
    /// and the app moves to the server. Same test as releaseSource.
    func handOverToRungs(because message: String) -> Bool {
        guard !config.isLive, !config.tiers.isEmpty, !demuxerOwesTracks, tierOffered, config.audioTracks.isEmpty || audioLoActive else { return false }
        stateLock.lock()
        let free = copyAnnounced && !copyOnlyMaster && !sourceReleased && !cancelled && !failed
        if free {
            copyVerdict = .withheld
            sourceState = .unavailable
            sourceReady = false
            sourceTakeoverSegment = nil
            recovering = false
            lastTierDemandAt = Date()
        }
        stateLock.unlock()
        guard free else { return false }
        NSLog("[LocalRemuxer] Slipstream: the source is lost (%@), the rungs carry the session from here", message)
        startServerImageSubtitles()
        return true
    }

    func retrySource(because message: String, now: Date = Date()) {
        stateLock.lock()
        guard !cancelled, !failed else { return stateLock.unlock() }
        sourceRetryAttempts = min(sourceRetryAttempts + 1, 6)
        sourceRetryAt = now.addingTimeInterval(min(30, pow(2, Double(sourceRetryAttempts - 1))))
        sourceState = .retryWait
        sourceReady = false
        sourceTakeoverSegment = nil
        recovering = true
        let rungsListed = ladderListed
        stateLock.unlock()
        NSLog("[LocalRemuxer] source will retry in this session: %@", message)
        // Only rungs carry the session through the retry; without them the copy comes back on its own.
        if rungsListed { startServerImageSubtitles() }
    }

    func wakeSourceIfAffordable(now: Date = Date()) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard sourceState == .dormant || sourceState == .retryWait,
              !cancelled, !failed, now >= sourceRetryAt else { return false }
        let hasAlternative = !copyOnlyMaster && !adoptedStarts.isEmpty && config.tiers.indices.contains { !rungsUnavailable.contains($0) }
        let wire = testLinkBps ?? wireLinkBps ?? playlistLinkBps ?? 0
        guard !hasAlternative || sourceBandwidth <= 0 || wire >= Double(sourceBandwidth) * 1.2 else { return false }
        sourceState = .warming
        sourceTakeoverSegment = lastRequestedSegment
        pendingSeekSegment = lastRequestedSegment
        return true
    }

    func copyResponseDeferral() -> LocalHTTPResponse? {
        stateLock.lock()
        defer { stateLock.unlock() }
        if failed || cancelled { return .notFound }
        if sourceState == .unavailable { return .gone }
        guard !config.tiers.isEmpty, !adoptedStarts.isEmpty else { return nil }
        if sourceState == .dormant || sourceState == .retryWait || !sourceReady { return .temporarilyUnavailable }
        if copyOnlyMaster { return nil }
        let wire = testLinkBps ?? wireLinkBps ?? 0
        if sourceBandwidth > 0 && wire < Double(sourceBandwidth) * 1.2 && !copyBufferHoldsLocked() { return .temporarilyUnavailable }
        return nil
    }

    func rungResponseDeferral(_ rung: Int) -> LocalHTTPResponse? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard config.tiers.indices.contains(rung), !cancelled, !failed, !rungsUnavailable.contains(rung) else { return .notFound }
        let available = config.tiers.indices.filter { !rungsUnavailable.contains($0) }
        let wire = testLinkBps ?? wireLinkBps ?? playlistLinkBps ?? 0
        let fitting = available.filter { Double(config.tiers[$0].bandwidth) <= wire * 0.8 }
        let headroom = fitting.last.flatMap { last in available.first { $0 > last } } ?? available.first
        if fitting.contains(rung) || rung == headroom { return nil }
        return .temporarilyUnavailable
    }

    /// The keyframe at or before `ms` of source time, as a JPEG in the frame pool (the session directory without an item id).
    func chapterFrame(atMilliseconds ms: Int64) -> URL? {
        stateLock.lock()
        if cancelled {
            stateLock.unlock()
            return nil
        }
        let grabber = frameGrabberLocked()
        stateLock.unlock()
        return grabber.chapterFrame(atMilliseconds: ms)
    }

    /// The chapter frames' grabber. Caller holds stateLock.
    func frameGrabberLocked() -> FrameGrabber {
        if let frameGrabber { return frameGrabber }
        let pooled = ChapterFramePool.directory(for: config.itemId)
        let grabber = FrameGrabber(inputUrl: config.inputUrl, directory: pooled ?? dir, pool: pooled == nil ? nil : ChapterFramePool.root, epoch: poolEpoch)
        grabber.byteMap = byteMap
        frameGrabber = grabber
        return grabber
    }

    /// The I-frame rendition's grabber: one queue each, since a chapter frame decodes several 4K
    /// pictures while an I-frame request copies one keyframe. Caller holds stateLock.
    func iframeGrabberLocked() -> FrameGrabber {
        if let iframeGrabber { return iframeGrabber }
        let grabber = FrameGrabber(inputUrl: config.inputUrl, directory: dir, pool: nil, epoch: poolEpoch)
        grabber.byteMap = byteMap
        iframeGrabber = grabber
        return grabber
    }

}
