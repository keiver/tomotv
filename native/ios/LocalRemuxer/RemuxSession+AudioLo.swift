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

    /// The second server group, for the rungs with room for the track's own channels: every track
    /// names a hi rendition and some rung rides it.
    var audioHiActive: Bool {
        audioLoActive && config.tiers.contains { $0.audioHi } && config.audioTracks.allSatisfy { !$0.serverAudioHiUrl.isEmpty }
    }

    /// Both groups share this file's state and code; a hi rendition's entries sit past this offset.
    static let audioHiKey = 1000

    func audioKey(_ position: Int, hi: Bool) -> Int { hi ? position + Self.audioHiKey : position }

    /// File and route prefix of a server rendition: "a0s" for track 0 of audio-lo, "a0h" of audio-hi.
    func serverAudioPrefix(key: Int) -> String {
        key >= Self.audioHiKey ? "a\(key - Self.audioHiKey)h" : "a\(key)s"
    }

    func serverAudioUrl(_ position: Int, hi: Bool) -> String {
        guard position >= 0, position < config.audioTracks.count else { return "" }
        return hi ? config.audioTracks[position].serverAudioHiUrl : config.audioTracks[position].serverAudioUrl
    }

    /// Adopt the server audio-only playlist for track `position` (one fetch,
    /// cached). Returns the segment list, or nil when the rendition is
    /// unavailable this session. Concurrent segment requests share one fetch.
    func adoptAudioLo(_ position: Int, hi: Bool = false) -> [TierSegment]? {
        let key = audioKey(position, hi: hi)
        stateLock.lock()
        if let cached = audioLoSegments[key] {
            stateLock.unlock()
            return cached.isEmpty ? nil : cached
        }
        stateLock.unlock()
        return dedupedMaterialization("adopt-\(serverAudioPrefix(key: key))") { adoptAudioLoLocked(position, hi: hi) }
    }

    func adoptAudioLoLocked(_ position: Int, hi: Bool) -> [TierSegment]? {
        let key = audioKey(position, hi: hi)
        // The winner's result: losers re-read it here instead of refetching.
        stateLock.lock()
        if let cached = audioLoSegments[key] {
            stateLock.unlock()
            return cached.isEmpty ? nil : cached
        }
        stateLock.unlock()
        guard let url = URL(string: serverAudioUrl(position, hi: hi)) else { return nil }
        // The server spins up a fresh audio-only transcode on this request; on a
        // slow link that start plus the playlist body can outrun a short timeout,
        // and a miss 404s the rung's audio group and stalls the tier. Match the
        // tier segment budget (30s) so the audio rung survives the spin-up.
        let request = URLRequest(url: url, timeoutInterval: 30)
        let semaphore = DispatchSemaphore(value: 0)
        var body: String? = nil
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            if let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                body = String(decoding: data, as: UTF8.self)
            }
            semaphore.signal()
        }
        transfers.begin(task)
        task.resume()
        _ = semaphore.wait(timeout: .now() + 32)
        transfers.end(task)
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
        audioLoSegments[key] = segments
        if let initRemote { audioLoInitRemote[key] = initRemote }
        stateLock.unlock()
        return segments.isEmpty ? nil : segments
    }

    /// Media playlist for the audio-lo rendition of track `position`. The
    /// server's declared EXTINFs are served as-is (its own frame-aligned
    /// grid); timestamps are rebuilt by the rewrapper, which is what must
    /// match across renditions (RFC 8216 §6.2.4), not the cut points.
    func audioLoPlaylist(position: Int, hi: Bool = false) -> String? {
        guard hi ? audioHiActive : audioLoActive, let segments = adoptAudioLo(position, hi: hi) else { return nil }
        let prefix = serverAudioPrefix(key: audioKey(position, hi: hi))
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n" + startTag
        out += "#EXT-X-TARGETDURATION:\(sessionTargetDuration())\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"\(prefix)-init.mp4\"\n"
        for (n, seg) in segments.enumerated() {
            out += String(format: "#EXTINF:%.6f,\n", seg.duration)
            out += "\(prefix)-seg\(n).m4s\n"
        }
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// Fetch + rewrap audio-lo segment n for track `position` (blocking; runs
    /// behind chunked early headers like the tier). The server's own tfdt is
    /// untrustworthy (restart rebasing, measured garbage), so every segment is
    /// rebuilt onto the session timeline: sequential requests chain exact
    /// accumulated durations, a seek re-anchors to the declared grid.
    func materializeAudioLoSegment(position: Int, n: Int, hi: Bool = false, request: SegmentRequest? = nil) -> URL? {
        let key = "\(serverAudioPrefix(key: audioKey(position, hi: hi)))-\(n)"
        return withFetchInterest(key, request) {
            dedupedMaterialization(key) { materializeAudioLoSegmentLocked(position: position, n: n, hi: hi, fetchKey: key, counted: request != nil) }
        }
    }

    /// The segment of a server audio grid that holds `seconds`. The grid is the server's own, cut
    /// on codec frames, so a session index does not name the same stretch of it.
    func audioLoIndex(_ segments: [TierSegment], at seconds: Double) -> Int {
        var reached = 0.0
        return segments.firstIndex { segment in
            reached += segment.duration
            return reached > seconds
        } ?? 0
    }

    func materializeAudioLoSegmentLocked(position: Int, n: Int, hi: Bool, fetchKey: String, counted: Bool) -> URL? {
        if isTierDisabled { return nil }
        let key = audioKey(position, hi: hi)
        let prefix = serverAudioPrefix(key: key)
        let mediaFile = dir.appendingPathComponent("\(prefix)-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return mediaFile }
        guard let segments = adoptAudioLo(position, hi: hi), n >= 0, n < segments.count,
              let playlistUrl = URL(string: serverAudioUrl(position, hi: hi)),
              let remote = URL(string: segments[n].url, relativeTo: playlistUrl)?.absoluteURL
        else { return nil }
        stateLock.lock()
        lastTierDemandAt = Date()
        let initRemote = audioLoInitRemote[key]
        let chain = audioLoChain[key]
        let heldInit = audioLoInitData[key]
        stateLock.unlock()
        guard let initRemote else { return nil }
        // The init is the same bytes for every segment of the rendition: one fetch a session, not
        // one a segment, which on a 150 ms link was a round trip ahead of every audio segment.
        let initFetch = heldInit.map { (data: Optional($0), status: 200, seconds: 0.0) } ?? fetchTier(initRemote)
        let segFetch = initFetch.data == nil ? initFetch : fetchTier(remote, key: fetchKey, counted: counted)
        if heldInit == nil, let fresh = initFetch.data {
            stateLock.lock()
            audioLoInitData[key] = fresh
            stateLock.unlock()
        }
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
            let initFile = dir.appendingPathComponent("\(prefix)-init.mp4")
            if !FileManager.default.fileExists(atPath: initFile.path) {
                try rewrapped.initSegment.write(to: initFile)
            }
        } catch { return nil }
        stateLock.lock()
        audioLoChain[key] = (next: n + 1, start: target + rewrapped.durationSeconds)
        audioLoMaterialized[key, default: []].insert(n)
        stateLock.unlock()
        return mediaFile
    }

    func audioLoInitResponse(position: Int, hi: Bool = false) -> LocalHTTPResponse {
        guard hi ? audioHiActive : audioLoActive, !isTierDisabled else { return .notFound }
        let prefix = serverAudioPrefix(key: audioKey(position, hi: hi))
        let initFile = dir.appendingPathComponent("\(prefix)-init.mp4")
        if FileManager.default.fileExists(atPath: initFile.path) { return .file(initFile, contentType: "audio/mp4") }
        return .streamed(contentType: "audio/mp4") { [weak self] in
            guard let self else { return nil }
            // The init falls out of any segment: the one AVPlayer asks for next, not the film's first.
            self.stateLock.lock()
            let head = self.lastRequestedSegment
            self.stateLock.unlock()
            let playhead = head > 0 ? self.segmentStartSeconds(head) : self.config.startOffsetSeconds
            let n = self.adoptAudioLo(position, hi: hi).map { self.audioLoIndex($0, at: playhead) } ?? 0
            _ = self.materializeAudioLoSegment(position: position, n: n, hi: hi)
            let file = self.dir.appendingPathComponent("\(prefix)-init.mp4")
            return FileManager.default.fileExists(atPath: file.path) ? file : nil
        }
    }

    func audioLoSegmentResponse(position: Int, n: Int, hi: Bool = false) -> LocalHTTPResponse {
        guard hi ? audioHiActive : audioLoActive, !isTierDisabled else { return .notFound }
        stateLock.lock()
        let dead = failed || cancelled
        stateLock.unlock()
        if dead { return .notFound }
        let mediaFile = dir.appendingPathComponent("\(serverAudioPrefix(key: audioKey(position, hi: hi)))-seg\(n).m4s")
        if FileManager.default.fileExists(atPath: mediaFile.path) { return .file(mediaFile, contentType: "audio/iso.segment") }
        return .segment(contentType: "audio/iso.segment", lead: Self.stypBox, padding: Self.freeBox) { [weak self] request in self?.materializeAudioLoSegment(position: position, n: n, hi: hi, request: request) }
    }

}
