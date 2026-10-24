import Foundation

extension RemuxSession {
    /// The loopback URL of a live HLS master cut to its top variant and renditions, or nil to open the input as
    /// given. The first read checks the master for DRM, and the variant beside the open; either fails the session.
    func trimmedLiveSource(_ urlString: String, headers: [String: String]) -> String? {
        // A request to a raw stream is one more connection the provider counts beside the open.
        guard config.isLive, let base = loopbackBase, let url = URL(string: urlString), url.scheme == "http" || url.scheme == "https",
              config.livePlaylist || ["m3u8", "m3u"].contains(url.pathExtension.lowercased()) else { return nil }
        guard case .status(let code, let finalURL, let body) = EndpointProbe.request(url, headers: headers, keepBody: true, timeout: 5),
              (200..<300).contains(code), let text = body.flatMap({ String(data: $0, encoding: .utf8) }) else { return nil }
        stateLock.lock()
        let firstRead = sourcePlaylist == nil
        stateLock.unlock()
        if firstRead, let system = LiveVariantPicker.drmKeyFormat(text) {
            fail("channel is DRM protected (\(system))")
            return nil
        }
        guard text.contains("#EXT-X-STREAM-INF"),
              let trimmed = LiveVariantPicker.trimmedMaster(text, base: (finalURL ?? url).absoluteString, audioLanguage: config.liveAudioLanguage),
              let variant = trimmed.split(separator: "\n").last.flatMap({ URL(string: String($0)) }) else { return nil }
        if firstRead {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard case .status(let code, _, let body) = EndpointProbe.request(variant, headers: headers, keepBody: true, timeout: 5),
                      (200..<300).contains(code), let system = body.flatMap({ String(data: $0, encoding: .utf8) }).flatMap(LiveVariantPicker.drmKeyFormat) else { return }
                self?.fail("channel is DRM protected (\(system))")
            }
        }
        // Subtitle renditions stay out of what FFmpeg opens; the engine reads them itself.
        let subtitles = trimmed.split(separator: "\n").map(String.init).filter { $0.hasPrefix("#EXT-X-MEDIA:") && $0.contains("TYPE=SUBTITLES") }
        let opened = trimmed.split(separator: "\n").map(String.init).filter { !subtitles.contains($0) }
            .map { $0.hasPrefix("#EXT-X-STREAM-INF:") ? "#EXT-X-STREAM-INF:" + LiveVariantPicker.removing("SUBTITLES", from: String($0.dropFirst("#EXT-X-STREAM-INF:".count))) : $0 }
            .joined(separator: "\n") + "\n"
        // A variant whose CODECS names IMSC and no WebVTT has subtitles the engine cannot read.
        let codecs = trimmed.split(separator: "\n").first { $0.hasPrefix("#EXT-X-STREAM-INF:") }
            .flatMap { LiveVariantPicker.attribute("CODECS", in: String($0.dropFirst("#EXT-X-STREAM-INF:".count))) } ?? ""
        let webVtt = !codecs.contains("stpp") || codecs.contains("wvtt")
        let refreshed = webVtt ? subtitles.map { String($0.dropFirst("#EXT-X-MEDIA:".count)) } : []
        let identity = { (rendition: String) in
            ["GROUP-ID", "NAME", "LANGUAGE", "ASSOC-LANGUAGE", "FORCED", "CHARACTERISTICS"].map { LiveVariantPicker.attribute($0, in: rendition) }
        }
        stateLock.lock()
        sourcePlaylist = opened
        if firstRead {
            liveSubtitleRenditions = refreshed
        } else {
            // Keep the track indices the player knows, even if the renewed master reorders its renditions.
            // A missing rendition loses its URL until it reappears, retaining its identity for that read.
            liveSubtitleRenditions = liveSubtitleRenditions.map { previous in
                refreshed.first { identity($0) == identity(previous) } ?? LiveVariantPicker.removing("URI", from: previous)
            }
        }
        for (position, rendition) in liveSubtitleRenditions.enumerated() {
            liveSubtitleURIs[Self.liveTextIndexBase + position] = LiveVariantPicker.attribute("URI", in: rendition)
        }
        stateLock.unlock()
        let lines = trimmed.split(separator: "\n").map(String.init)
        let bandwidth = lines.first { $0.hasPrefix("#EXT-X-STREAM-INF:") }.flatMap { LiveVariantPicker.attribute("BANDWIDTH", in: String($0.dropFirst("#EXT-X-STREAM-INF:".count))) } ?? "?"
        let renditions = lines.filter { $0.hasPrefix("#EXT-X-MEDIA:") }.count
        NSLog("[LocalRemuxer] live source trimmed to one variant (%@ bps) with %d rendition(s)", bandwidth, renditions)
        return "\(base)/source.m3u8"
    }

    /// First index of a live text track: past any stream FFmpeg numbers.
    static let liveTextIndexBase = 10_000

    /// The live text tracks of the trimmed master's subtitle renditions, each with its playlist URI recorded.
    func liveTextTracks() -> [RemuxSubtitle] {
        stateLock.lock()
        let renditions = liveSubtitleRenditions
        stateLock.unlock()
        var tracks: [RemuxSubtitle] = []
        for (position, rendition) in renditions.enumerated() {
            guard LiveVariantPicker.attribute("URI", in: rendition) != nil else { continue }
            let index = Self.liveTextIndexBase + position
            let language = LiveVariantPicker.attribute("LANGUAGE", in: rendition) ?? ""
            var track = RemuxSubtitle(index: index, name: LiveVariantPicker.attribute("NAME", in: rendition) ?? language, language: language, vttUrl: "", localVtt: "",
                                      isDefault: LiveVariantPicker.attribute("DEFAULT", in: rendition) == "YES", isForced: LiveVariantPicker.attribute("FORCED", in: rendition) == "YES",
                                      isImage: false, isEngineText: true)
            track.isHearingImpaired = (LiveVariantPicker.attribute("CHARACTERISTICS", in: rendition) ?? "").contains("public.accessibility.transcribes-spoken-dialog")
            tracks.append(track)
        }
        return tracks
    }

    /// Follows each live text track's WebVTT rendition in the background for the session's life: each new
    /// segment is read until it is read whole, and its cues are placed once the video has reached them.
    func followLiveSubtitles(_ tracks: [RemuxSubtitle], headers: [String: String]) {
        for track in tracks {
            let streamIndex = Int32(track.index)
            DispatchQueue.global(qos: .utility).async { [weak self] in
                var read = Set<String>()
                var waiting: [(cue: TextSubtitleCue, since: Date)] = []
                while let self, !self.isCancelled, !self.hasFailed {
                    var wait = 2.0
                    let began = Date()
                    self.stateLock.lock()
                    let uri = self.liveSubtitleURIs[track.index]
                    self.stateLock.unlock()
                    if let uri, let playlistURL = URL(string: uri), self.liveAnchorSeconds() != nil,
                       case .status(200..<300, let landed, let body) = EndpointProbe.request(playlistURL, headers: headers, keepBody: true, timeout: 5),
                       let playlist = body.flatMap({ String(data: $0, encoding: .utf8) }) {
                        let lines = playlist.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
                        let target = lines.first { $0.hasPrefix("#EXT-X-TARGETDURATION:") }.flatMap { Double($0.dropFirst("#EXT-X-TARGETDURATION:".count)) }
                        wait = max(1, (target ?? 4) / 2)
                        let segments = lines.filter { !$0.isEmpty && !$0.hasPrefix("#") }
                            .compactMap { URL(string: $0, relativeTo: landed ?? playlistURL)?.absoluteString }
                        for segment in segments.suffix(10) where !read.contains(segment) && !self.isCancelled {
                            guard let url = URL(string: segment),
                                  case .status(200..<300, _, let data) = EndpointProbe.request(url, headers: headers, keepBody: true, timeout: 5),
                                  let text = data.flatMap({ String(data: $0, encoding: .utf8) }) else { continue }
                            read.insert(segment)
                            waiting += self.liveSourceCues(text).map { ($0, Date()) }
                        }
                        read.formIntersection(segments)
                    }
                    let unplaced = Set(self.placeLiveCues(waiting.map(\.cue), streamIndex: streamIndex))
                    waiting = waiting.filter { unplaced.contains($0.cue) && Date().timeIntervalSince($0.since) < 60 }
                    self.stateLock.lock()
                    self.liveSubtitlePolledAt[streamIndex] = began
                    self.stateLock.unlock()
                    let until = Date().addingTimeInterval(wait)
                    while Date() < until, !self.isCancelled, !self.hasFailed { usleep(100_000) }
                }
            }
        }
    }

    /// The live generation's anchor, nil before the first keyframe.
    func liveAnchorSeconds() -> Double? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return sessionAnchorSeconds
    }

    /// A live WebVTT segment's cues in source time: WebVTT time plus the segment's map, the 33-bit MPEG-TS
    /// clock unwrapped to the turn nearest the video's.
    func liveSourceCues(_ vtt: String) -> [TextSubtitleCue] {
        stateLock.lock()
        let videoSource = sessionAnchorSeconds.map { $0 + (liveSegmentStarts.values.max() ?? 0) }
        stateLock.unlock()
        guard let videoSource else { return [] }
        let cues = Self.webVttCues(vtt)
        let turn = 8_589_934_592.0 / 90_000
        var map = Self.webVttTimeMapOffset(vtt) ?? 0
        if let first = cues.first {
            map += (((videoSource - (first.start + map)) / turn).rounded()) * turn
        }
        return cues.map { TextSubtitleCue(start: $0.start + map, end: $0.end + map, text: $0.text) }
    }

    /// Stores the source-time cues the current generation has read up to, on the output timeline; returns the rest.
    func placeLiveCues(_ cues: [TextSubtitleCue], streamIndex: Int32) -> [TextSubtitleCue] {
        stateLock.lock()
        let decoder = textSubtitles[streamIndex]
        let anchor = sessionAnchorSeconds
        let opened = liveGenerationStarts.keys.max().flatMap { liveSegmentStarts[$0] } ?? liveSegmentStarts.values.min()
        let newest = liveSegmentStarts.values.max()
        stateLock.unlock()
        guard let decoder, let anchor, let opened, let newest else { return cues }
        let reach = newest + 2 * config.liveSegmentSeconds
        return cues.filter { cue in
            let start = cue.start - anchor
            guard start >= opened - 1, start <= reach else { return true }
            decoder.add(TextSubtitleCue(start: start, end: cue.end - anchor, text: cue.text))
            return false
        }
    }

    /// A WebVTT body's cues at their WebVTT time; cue settings after the end time are dropped.
    static func webVttCues(_ vtt: String) -> [TextSubtitleCue] {
        var cues: [TextSubtitleCue] = []
        let blocks = vtt.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n")
        for block in blocks {
            let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            guard let timing = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let ends = lines[timing].components(separatedBy: "-->")
            guard ends.count == 2, let start = webVttSeconds(ends[0]),
                  let end = webVttSeconds(String(ends[1].trimmingCharacters(in: .whitespaces).split(separator: " ").first ?? "")) else { continue }
            let text = lines[(timing + 1)...].filter { !$0.isEmpty }.joined(separator: "\n")
            guard !text.isEmpty, end > start else { continue }
            cues.append(TextSubtitleCue(start: start, end: end, text: text))
        }
        return cues
    }

    /// `hh:mm:ss.ttt` or `mm:ss.ttt` in seconds.
    static func webVttSeconds(_ stamp: String) -> Double? {
        let fields = stamp.trimmingCharacters(in: .whitespaces).split(separator: ":").map { Double($0) }
        guard (2...3).contains(fields.count), fields.allSatisfy({ $0 != nil }) else { return nil }
        return fields.compactMap { $0 }.reduce(0) { $0 * 60 + $1 }
    }

    /// Seconds a WebVTT segment's cue times sit behind the source clock, off its X-TIMESTAMP-MAP; nil without one.
    static func webVttTimeMapOffset(_ vtt: String) -> Double? {
        guard let line = vtt.split(whereSeparator: \.isNewline).first(where: { $0.hasPrefix("X-TIMESTAMP-MAP=") }) else { return nil }
        var ticks: Double?
        var local: Double?
        for pair in line.dropFirst("X-TIMESTAMP-MAP=".count).split(separator: ",") {
            let parts = pair.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2 else { continue }
            if parts[0] == "MPEGTS" { ticks = Double(parts[1]) }
            if parts[0] == "LOCAL" {
                let fields = parts[1].split(separator: ":").compactMap { Double($0) }
                local = fields.reduce(0) { $0 * 60 + $1 }
            }
        }
        guard let ticks, let local else { return nil }
        return ticks / 90_000 - local
    }

    /// The loopback URL of the trimmed master an earlier read built, or nil when none was built.
    func heldTrimmedSource() -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard sourcePlaylist != nil, let base = loopbackBase else { return nil }
        return "\(base)/source.m3u8"
    }

    func sourcePlaylistResponse() -> LocalHTTPResponse {
        stateLock.lock()
        let text = sourcePlaylist
        stateLock.unlock()
        guard let text else { return .notFound }
        return .data(Data(text.utf8), contentType: "application/vnd.apple.mpegurl")
    }
}
