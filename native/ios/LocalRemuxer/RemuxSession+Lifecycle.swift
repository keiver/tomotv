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
        urls += config.audioTracks.flatMap { [$0.serverAudioUrl, $0.serverAudioHiUrl] }.filter { !$0.isEmpty }
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

    /// What every link report tells the app under `copyListed`: false only while a rebuild could
    /// reach a copy, which is what the app rebuilds for.
    var reportsCopyListed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return copyVerdict != .withheld || sourceUnusable
    }

    /// Tracks only the demuxer can serve: an image subtitle with no raw server stream, and an
    /// engine text track with no server WebVTT. Either one keeps the source open.
    var demuxerOwesTracks: Bool {
        config.subtitles.contains { ($0.isImage && $0.serverSupUrl.isEmpty) || ($0.isEngineText && $0.serverVttUrl.isEmpty) }
    }

    /// Lets the source go and runs the session on the server's rungs alone, when they can carry
    /// all of it: a ladder on the adopted grid, every audio track from the server, no track the
    /// demuxer owes, and no master out that names the copy. False leaves the session as it was.
    func releaseSource(because reason: String, unusable: Bool = false) -> Bool {
        guard !config.isLive, !config.tiers.isEmpty, !demuxerOwesTracks else { return false }
        // The grid first: the ladder and its audio group exist only once it is adopted.
        awaitGrid()
        guard tierOffered, audioLoActive else { return false }
        stateLock.lock()
        let free = !copyAnnounced && !cancelled && !failed
        if free {
            copyVerdict = .withheld
            sourceReleased = true
            sourceUnusable = unusable
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
            sourceReleased = true
            sourceUnusable = true
            lastTierDemandAt = Date()
        }
        stateLock.unlock()
        guard free else { return false }
        NSLog("[LocalRemuxer] Slipstream: the source is lost (%@), the rungs carry the session from here", message)
        startServerImageSubtitles()
        return true
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
