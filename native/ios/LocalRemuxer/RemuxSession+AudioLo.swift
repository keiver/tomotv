//
//  RemuxSession+AudioLo.swift
//  TomoTV
//
//  The tier's server-fed "audio-lo" rendition: adopting each track's audio-only
//  playlist, rewrapping its segments, and serving them so the survival rung
//  never depends on the engine's own source pull.
//

import Foundation

extension RemuxSession {
    // MARK: - Slipstream audio-lo rendition serving

    /// Whether the tier variant gets its own server-fed audio group: every
    /// track must carry a server rendition URL, or the tier keeps sharing the
    /// engine group (RFC 8216 §4.3.4.1.1 — groups of one TYPE must expose the
    /// same member set).
    var audioLoActive: Bool {
        tierActive && !config.audioTracks.isEmpty && config.audioTracks.allSatisfy { !$0.serverAudioUrl.isEmpty }
    }

    /// Adopt the server audio-only playlist for track `position` (one fetch,
    /// cached). Returns the segment list, or nil when the rendition is
    /// unavailable this session. Concurrent segment requests share one fetch.
    func adoptAudioLo(_ position: Int) -> [TierSegment]? {
        stateLock.lock()
        if let cached = audioLoSegments[position] {
            stateLock.unlock()
            return cached.isEmpty ? nil : cached
        }
        stateLock.unlock()
        return dedupedMaterialization("adopt-a\(position)") { adoptAudioLoLocked(position) }
    }

    func adoptAudioLoLocked(_ position: Int) -> [TierSegment]? {
        // The winner's result: losers re-read it here instead of refetching.
        stateLock.lock()
        if let cached = audioLoSegments[position] {
            stateLock.unlock()
            return cached.isEmpty ? nil : cached
        }
        stateLock.unlock()
        guard position >= 0, position < config.audioTracks.count,
              let url = URL(string: config.audioTracks[position].serverAudioUrl) else { return nil }
        // The server spins up a fresh audio-only transcode on this request; on a
        // slow link that start plus the playlist body can outrun a short timeout,
        // and a miss 404s the rung's audio group and stalls the tier. Match the
        // tier segment budget (30s) so the audio rung survives the spin-up.
        let request = URLRequest(url: url, timeoutInterval: 30)
        let semaphore = DispatchSemaphore(value: 0)
        var body: String? = nil
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                body = String(decoding: data, as: UTF8.self)
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 32)
        // A fetch failure is the link being slow, and on a slow link the tier is
        // the one variant that fits: leave it uncached so the next request
        // retries. Only a playlist that arrived and is unusable is cached below.
        guard let text = body else {
            NSLog("[LocalRemuxer] Slipstream: audio-lo playlist fetch failed for track %d, will retry", position)
            return nil
        }
        var segments: [TierSegment] = []
        var initRemote: URL? = nil
        var pendingDuration: Double? = nil
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXT-X-MAP:") {
                if let range = line.range(of: "URI=\"") {
                    let rest = line[range.upperBound...]
                    if let end = rest.firstIndex(of: "\"") {
                        initRemote = URL(string: String(rest[..<end]), relativeTo: url)?.absoluteURL
                    }
                }
            } else if line.hasPrefix("#EXTINF:") {
                pendingDuration = Double(line.dropFirst(8).split(separator: ",").first ?? "")
            } else if !line.hasPrefix("#"), !line.isEmpty, let duration = pendingDuration {
                segments.append(TierSegment(duration: duration, url: line))
                pendingDuration = nil
            }
        }
        if segments.isEmpty || initRemote == nil {
            NSLog("[LocalRemuxer] Slipstream: audio-lo adoption failed for track %d", position)
            segments = []
        }
        stateLock.lock()
        audioLoSegments[position] = segments
        if let initRemote { audioLoInitRemote[position] = initRemote }
        stateLock.unlock()
        return segments.isEmpty ? nil : segments
    }

    /// Media playlist for the audio-lo rendition of track `position`. The
    /// server's declared EXTINFs are served as-is (its own frame-aligned
    /// grid); timestamps are rebuilt by the rewrapper, which is what must
    /// match across renditions (RFC 8216 §6.2.4), not the cut points.
    func audioLoPlaylist(position: Int) -> String? {
        guard audioLoActive, let segments = adoptAudioLo(position) else { return nil }
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n" + startTag
        out += "#EXT-X-TARGETDURATION:\(sessionTargetDuration())\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"a\(position)s-init.mp4\"\n"
        for (n, seg) in segments.enumerated() {
            out += String(format: "#EXTINF:%.6f,\n", seg.duration)
            out += "a\(position)s-seg\(n).m4s\n"
        }
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// Fetch + rewrap audio-lo segment n for track `position` (blocking; runs
    /// behind chunked early headers like the tier). The server's own tfdt is
    /// untrustworthy (restart rebasing, measured garbage), so every segment is
    /// rebuilt onto the session timeline: sequential requests chain exact
    /// accumulated durations, a seek re-anchors to the declared grid.
    func materializeAudioLoSegment(position: Int, n: Int) -> URL? {
        dedupedMaterialization("a\(position)-\(n)") { materializeAudioLoSegmentLocked(position: position, n: n) }
    }

    func materializeAudioLoSegmentLocked(position: Int, n: Int) -> URL? {
        if isTierDisabled { return nil }
        let mediaFile = dir.appendingPathComponent("a\(position)s-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
        guard let segments = adoptAudioLo(position), n >= 0, n < segments.count,
              let playlistUrl = URL(string: config.audioTracks[position].serverAudioUrl),
              let remote = URL(string: segments[n].url, relativeTo: playlistUrl)?.absoluteURL
        else { return nil }
        stateLock.lock()
        lastTierDemandAt = Date()
        let initRemote = audioLoInitRemote[position]
        let chain = audioLoChain[position]
        stateLock.unlock()
        guard let initRemote else { return nil }
        let initFetch = fetchTier(initRemote)
        let segFetch = initFetch.data == nil ? initFetch : fetchTier(remote)
        guard let initData = initFetch.data, let segData = segFetch.data else {
            NSLog("[LocalRemuxer] Slipstream: audio-lo segment %d fetch failed (HTTP %d)", n, segFetch.status)
            if segFetch.status > 0 { recordTierFailure("audio HTTP \(segFetch.status)") }
            return nil
        }
        // Anchor: chained when sequential, declared grid on a jump.
        let target: Double
        if let chain, chain.next == n {
            target = chain.start
        } else {
            target = segments.prefix(n).reduce(0) { $0 + $1.duration }
        }
        guard let rewrapped = TierRewrapper.rewrapAudio(initData: initData, segmentData: segData, targetStartSeconds: target) else {
            recordTierFailure("audio rewrap failed")
            return nil
        }
        do {
            try rewrapped.mediaSegment.write(to: mediaFile)
            let initFile = dir.appendingPathComponent("a\(position)s-init.mp4")
            if !FileManager.default.fileExists(atPath: initFile.path) {
                try rewrapped.initSegment.write(to: initFile)
            }
        } catch { return nil }
        stateLock.lock()
        audioLoChain[position] = (next: n + 1, start: target + rewrapped.durationSeconds)
        audioLoMaterialized[position, default: []].insert(n)
        stateLock.unlock()
        return mediaFile
    }

    func audioLoInitResponse(position: Int) -> LocalHTTPResponse {
        guard audioLoActive, !isTierDisabled else { return .notFound }
        let initFile = dir.appendingPathComponent("a\(position)s-init.mp4")
        if FileManager.default.fileExists(atPath: initFile.path) { return .file(initFile, contentType: "audio/mp4") }
        return .streamed(contentType: "audio/mp4") { [weak self] in
            guard let self else { return nil }
            _ = self.materializeAudioLoSegment(position: position, n: 0)
            let file = self.dir.appendingPathComponent("a\(position)s-init.mp4")
            return FileManager.default.fileExists(atPath: file.path) ? file : nil
        }
    }

    func audioLoSegmentResponse(position: Int, n: Int) -> LocalHTTPResponse {
        guard audioLoActive, !isTierDisabled else { return .notFound }
        stateLock.lock()
        let dead = failed || cancelled
        stateLock.unlock()
        if dead { return .notFound }
        let mediaFile = dir.appendingPathComponent("a\(position)s-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return .file(mediaFile, contentType: "audio/iso.segment") }
        return .streamed(contentType: "audio/iso.segment") { [weak self] in self?.materializeAudioLoSegment(position: position, n: n) }
    }

}
