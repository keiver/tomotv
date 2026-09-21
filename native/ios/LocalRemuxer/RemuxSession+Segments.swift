//
//  RemuxSession+Segments.swift
//  TomoTV
//
//  Serving the primary/alternate-audio fMP4 segments and init to AVPlayer:
//  the bounded wait that drives seek-restarts when the player jumps outside
//  the producer's window, and the init/segment HTTP responses.
//

import Foundation

extension RemuxSession {
    // MARK: - Segment serving

    /// A completed segment goes out as a plain file; one still in production
    /// gets chunked early headers so AVPlayer's short no-response-headers
    /// watchdog (-12889) never fires while the provider waits.
    func segmentResponse(_ n: Int, prefix: String = "") -> LocalHTTPResponse {
        guard n >= 0 else { return .notFound }
        stateLock.lock()
        let rendition = renditions.first { $0.prefix == prefix }
        lastRequestedSegment = n
        // A copy that is gone is not demand on the source: AVPlayer asking after it again must not
        // read as leaving the rungs.
        let inRange = config.isLive ? n >= firstRetainedSegment : n < segmentCount
        let done = rendition?.completed.contains(n) == true
        let dead = failed || cancelled
        let pastEnd = reachedEnd && n > lastProducedSegment
        stateLock.unlock()
        if dead || !inRange || (pastEnd && !done) { return .notFound }
        if done, let rendition {
            let file = dir.appendingPathComponent(rendition.segmentName(n))
            if FileManager.default.fileExists(atPath: file.path) {
                stateLock.lock()
                if !sourceReleased { lastPrimaryDemandAt = Date() }
                stateLock.unlock()
                return .file(file, contentType: "video/iso.segment")
            }
        }
        if let deferred = mediaResponseDeferral(prefix: prefix) { return deferred }
        // A copy segment is megabytes, and on a link that only just carries it the whole of one
        // takes most of the 6s AVPlayer allows a silent response; live keeps the plain shape.
        if config.isLive { return .streamed(contentType: "video/iso.segment") { [weak self] in self?.segmentURL(n, prefix: prefix) } }
        return .segment(contentType: "video/iso.segment", lead: Self.stypBox, padding: Self.freeBox) { [weak self] request in self?.segmentURL(n, prefix: prefix, request: request) }
    }

    func initResponse(prefix: String = "", generation: Int = 0) -> LocalHTTPResponse {
        let url = dir.appendingPathComponent(Self.liveInitName(prefix: prefix, generation: generation))
        stateLock.lock()
        let dead = failed || cancelled
        stateLock.unlock()
        if dead { return .notFound }
        if FileManager.default.fileExists(atPath: url.path) {
            stateLock.lock()
            if !sourceReleased { lastPrimaryDemandAt = Date() }
            stateLock.unlock()
            return .file(url, contentType: "video/mp4")
        }
        if let deferred = mediaResponseDeferral(prefix: prefix) { return deferred }
        return .streamed(contentType: "video/mp4") { [weak self] in self?.initSegmentURL(prefix: prefix, generation: generation) }
    }

    func initSegmentURL(prefix: String = "", generation: Int = 0) -> URL? {
        let url = dir.appendingPathComponent(Self.liveInitName(prefix: prefix, generation: generation))
        // Written when the rendition's muxer is built, which happens as the
        // pipeline starts. AVPlayer asks for it before any segment. A failed
        // session (e.g. the video transcoder refusing the pixel format)
        // answers immediately instead of running out the clock, so the player
        // reaches its server fallback in milliseconds rather than 25s.
        _ = waitUntil(deadline: 25) { [weak self] in
            guard let self else { return true }
            if FileManager.default.fileExists(atPath: url.path) { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.failed || self.cancelled || (prefix.isEmpty && self.sourceUnusable)
        }
        stateLock.lock()
        let dead = failed || cancelled
        stateLock.unlock()
        return !dead && FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Blocking (bounded) fetch of a segment file, driving seek-restarts when
    /// the player jumps outside the producer's window. `prefix` selects the
    /// rendition ("" = primary, "aN" = alternate audio).
    func segmentURL(_ n: Int, prefix: String = "", request: SegmentRequest? = nil) -> URL? {
        guard n >= 0 else { return nil }
        defer {
            if prefix.isEmpty, request?.isAbandoned == true {
                stateLock.lock()
                copyAbandonedAt = Date()
                stateLock.unlock()
            }
        }
        let deadline = Date().addingTimeInterval(20)
        var availableRendition = rendition(withPrefix: prefix)
        while availableRendition == nil {
            stateLock.lock()
            let dead = failed || cancelled || (prefix.isEmpty && sourceUnusable)
            stateLock.unlock()
            if dead || request?.isAbandoned == true || Date() >= deadline { return nil }
            usleep(100_000)
            availableRendition = rendition(withPrefix: prefix)
        }
        guard let rendition = availableRendition else { return nil }

        stateLock.lock()
        lastRequestedSegment = n
        let inRange = config.isLive ? n >= firstRetainedSegment : n < segmentCount
        let done = rendition.completed.contains(n)
        let producing = producingSegment
        let sessionFailed = failed || cancelled
        // Past the real end of the stream: nothing will ever produce this, so
        // answer immediately instead of waiting out the segment timeout.
        let pastEnd = reachedEnd && n > lastProducedSegment
        stateLock.unlock()
        if sessionFailed || !inRange || (pastEnd && !done) { return nil }

        let url = dir.appendingPathComponent(rendition.segmentName(n))
        if done, FileManager.default.fileExists(atPath: url.path) { return url }

        if prefix.isEmpty, !awaitCopyAdmission(until: deadline, request: request) { return nil }
        stateLock.lock()
        if !sourceReleased { lastPrimaryDemandAt = Date() }
        stateLock.unlock()

        // Behind the producer, or more than a step ahead of it: restart the pipeline at this
        // segment. The step is small and fixed, not the read-ahead depth: a request 10 segments
        // ahead of a producer with a 20-segment window used to wait for the 10 between to be
        // pulled at link speed (measured: 13.8s for a rebuild at 63s on a 30 Mb/s link).
        // A live source cannot seek; its playlist only lists produced segments.
        if !config.isLive && (n < producing || n > producing + Self.seekAheadSegments) {
            stateLock.lock()
            pendingSeekSegment = n
            stateLock.unlock()
        }

        // Register as an active waiter for the duration of the wait: the
        // producer never throttles while an uncompleted segment inside its
        // window has one (see the control block in runPipeline), so this
        // request can't starve because the playhead marker was dragged
        // backwards by another request in the meantime.
        stateLock.lock()
        activeWaiters[n, default: 0] += 1
        stateLock.unlock()
        defer {
            stateLock.lock()
            if let count = activeWaiters[n], count > 1 { activeWaiters[n] = count - 1 } else { activeWaiters[n] = nil }
            stateLock.unlock()
        }

        // Bounded wait that re-asserts the seek when stranded.
        // pendingSeekSegment is last-writer-wins and consumed once, and the
        // HTTP server routes requests concurrently, so two racing requests can
        // overwrite each other's restart; the loser would otherwise wait out
        // the full deadline and 404 a segment the VOD playlist promises —
        // AVPlayer answers that by abandoning the seek position and snapping
        // back to its buffer (this shipped once: a resume at 226s snapped to
        // ~0s and the back-out's Stopped report wiped the server resume
        // point). Only a waiter near the playhead re-asserts, so an obsolete
        // request left over from a scrub can't drag the producer around.
        // The 20s deadline stretches to a hard ceiling while input recovery is
        // live: 404ing a promised segment mid-recovery would demote the whole
        // session to the server over a stall the pipeline is already healing.
        let recoveryDeadline = Date().addingTimeInterval(60)
        var ticks = 0
        while true {
            stateLock.lock()
            let completed = renditions.first { $0.prefix == prefix }?.completed.contains(n) == true
            let dead = failed || cancelled || (prefix.isEmpty && sourceUnusable)
            let ended = reachedEnd && n > lastProducedSegment
            let producingNow = producingSegment
            let inRecovery = recovering
            if !config.isLive && !completed && !dead && !ended && ticks >= 20 && ticks % 10 == 0
                && pendingSeekSegment == nil
                && (n < producingNow || n > producingNow + Self.seekAheadSegments)
                && abs(n - lastRequestedSegment) <= aheadWindow {
                pendingSeekSegment = n
                NSLog("[LocalRemuxer] Re-asserting seek for stranded segment %d (producing %d)", n, producingNow)
            }
            stateLock.unlock()
            if completed || dead || ended { break }
            if request?.isAbandoned == true {
                break
            }
            let now = Date()
            if now >= deadline && !(inRecovery && now < recoveryDeadline) { break }
            ticks += 1
            usleep(100_000)
        }

        stateLock.lock()
        let completed = renditions.first { $0.prefix == prefix }?.completed.contains(n) == true
        let ok = !failed && !cancelled && completed
        let producingAtEnd = producingSegment
        let playheadAtEnd = lastRequestedSegment
        stateLock.unlock()
        if !ok {
            NSLog("[LocalRemuxer] Segment request %d%@ unserved (producing %d, playhead %d)",
                  n, prefix.isEmpty ? "" : " [\(prefix)]", producingAtEnd, playheadAtEnd)
        }
        return ok && FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func awaitCopyAdmission(until deadline: Date, request: SegmentRequest? = nil) -> Bool {
        while true {
            stateLock.lock()
            let dead = failed || cancelled || sourceUnusable
            let hasAlternative = !adoptedStarts.isEmpty && config.tiers.indices.contains { !rungsUnavailable.contains($0) }
            let wire = testLinkBps ?? wireLinkBps ?? 0
            let affordable = !hasAlternative || sourceBandwidth <= 0 || wire >= Double(sourceBandwidth) * 1.2
            let ready = !sourceReleased && affordable
            stateLock.unlock()
            if dead || request?.isAbandoned == true { return false }
            if ready { return true }
            if Date() >= deadline { return false }
            usleep(100_000)
        }
    }

    private func mediaResponseDeferral(prefix: String) -> LocalHTTPResponse? {
        if prefix.isEmpty { return copyResponseDeferral() }
        stateLock.lock()
        defer { stateLock.unlock() }
        if failed || cancelled { return .notFound }
        if sourceUnusable { return .gone }
        if sourceReleased || !sourceReady { return .temporarilyUnavailable }
        return nil
    }

    func rendition(withPrefix prefix: String) -> Rendition? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return renditions.first { $0.prefix == prefix }
    }

    func waitUntil(deadline seconds: Double, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            usleep(100_000)
        }
        return condition()
    }

}
