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
        prefetchServerCues()
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
        stateLock.unlock()
        frames?.stop()
        killTierTranscode()
        // The pipeline thread notices `cancelled` between packets (or through
        // the AVIO interrupt callback during a blocking read) and exits; the
        // directory is removed on the next session's init as well.
        try? FileManager.default.removeItem(at: dir)
    }

    /// Fire-and-forget kill of the server transcodes this session started —
    /// the video tier and every audio-lo rendition. Jellyfin keys each job by
    /// PlaySessionId, which rides the playlist URL along with the ApiKey —
    /// DELETE /Videos/ActiveEncodings is the public route (M1: 204).
    func killTierTranscode() {
        var urls = config.tiers.map(\.playlistUrl)
        urls += config.audioTracks.map(\.serverAudioUrl).filter { !$0.isEmpty }
        for urlString in urls {
            guard let components = URLComponents(string: urlString),
                  let apiKey = components.queryItems?.first(where: { $0.name == "ApiKey" })?.value,
                  let playSessionId = components.queryItems?.first(where: { $0.name == "PlaySessionId" })?.value,
                  let scheme = components.scheme, let host = components.host
            else { continue }
            let port = components.port.map { ":\($0)" } ?? ""
            guard let url = URL(string: "\(scheme)://\(host)\(port)/Videos/ActiveEncodings?deviceId=tomo-slipstream&playSessionId=\(playSessionId)&ApiKey=\(apiKey)") else { continue }
            var request = URLRequest(url: url, timeoutInterval: 5)
            request.httpMethod = "DELETE"
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
        guard tierOffered, audioLoActive else { return false }
        stateLock.lock()
        let free = !cancelled && !failed
        if free {
            copyVerdict = .withheld
            sourceState = unusable ? .unavailable : .dormant
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

    /// A source lost after the master named the copy. That master lists the rungs too, so the
    /// copy's routes answer 410 from here and AVPlayer carries on with them: the session lives
    /// where it used to end and leave for the server's single stream. Same test as releaseSource.
    func handOverToRungs(because message: String) -> Bool {
        guard !config.isLive, !config.tiers.isEmpty, !demuxerOwesTracks, tierOffered, audioLoActive else { return false }
        stateLock.lock()
        let free = copyAnnounced && !sourceReleased && !cancelled && !failed
        if free {
            copyVerdict = .withheld
            sourceState = .unavailable
            lastTierDemandAt = Date()
        }
        stateLock.unlock()
        guard free else { return false }
        NSLog("[LocalRemuxer] Slipstream: the source is lost (%@), the rungs carry the session from here", message)
        startServerImageSubtitles()
        return true
    }

    func wakeSourceIfAffordable() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard sourceState == .dormant, !cancelled, !failed else { return false }
        let wire = testLinkBps ?? wireLinkBps ?? 0
        let rung = config.tiers.indices.contains(lastTierRung) ? config.tiers[lastTierRung].bandwidth : 0
        guard wire >= Double(config.bandwidth) * 1.2 + Double(rung) else { return false }
        sourceState = .warming
        pendingSeekSegment = lastRequestedSegment
        return true
    }

    func copyResponseDeferral() -> LocalHTTPResponse? {
        stateLock.lock()
        defer { stateLock.unlock() }
        if failed || cancelled { return .notFound }
        if sourceState == .unavailable { return .gone }
        guard !config.tiers.isEmpty, !tierDisabled, !adoptedStarts.isEmpty else { return nil }
        if sourceState == .dormant || !sourceReady { return .temporarilyUnavailable }
        let wire = testLinkBps ?? wireLinkBps ?? 0
        if config.bandwidth > 0 && wire < Double(config.bandwidth) * 1.2 { return .temporarilyUnavailable }
        return nil
    }

    func rungResponseDeferral(_ rung: Int) -> LocalHTTPResponse? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard config.tiers.indices.contains(rung), !cancelled, !failed, !tierDisabled, !rungsUnavailable.contains(rung) else { return .notFound }
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
        let pooled = ChapterFramePool.directory(for: config.itemId)
        let grabber = frameGrabber ?? FrameGrabber(inputUrl: config.inputUrl, directory: pooled ?? dir, pool: pooled == nil ? nil : ChapterFramePool.root, epoch: poolEpoch)
        frameGrabber = grabber
        stateLock.unlock()
        return grabber.chapterFrame(atMilliseconds: ms)
    }

}
