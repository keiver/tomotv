import Foundation

/// Server WebVTT as the cue source for engine text tracks the read loop cannot serve in time.
/// Cues sit interleaved with the video bytes, so a link slower than the source reaches the cue for
/// time T well after T, and a session held on the server rungs never reads at all.
extension RemuxSession {
    /// A text window's wait for the read loop: under AVPlayer's measured 6s media-file timeout
    /// ("No response for media file in 6s", which fails the whole item).
    static let engineTextWaitSeconds = 4.0

    /// Whether AVPlayer is living on the server rungs, so the producer holds source reads. Caller holds stateLock.
    func ridingTierLocked() -> Bool {
        lastTierDemandAt > lastPrimaryDemandAt
            && (Date().timeIntervalSince(lastPrimaryDemandAt) > 10 || copyAbandonedAt >= lastPrimaryDemandAt)
    }

    /// The track's server cues, fetched once per session; nil when the track has no server source
    /// or the fetch did not finish inside `deadline`.
    func serverCues(streamIndex: Int, deadline: Double) -> [ServerCue]? {
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex }), let url = URL(string: sub.serverVttUrl), !sub.serverVttUrl.isEmpty else { return nil }
        stateLock.lock()
        if let cached = serverCues[streamIndex] {
            stateLock.unlock()
            return cached
        }
        let owner = serverCueFetches.insert(streamIndex).inserted
        stateLock.unlock()
        if owner { fetchServerCues(streamIndex: streamIndex, url: url) }
        var found: [ServerCue]?
        _ = waitUntil(deadline: deadline) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            found = self.serverCues[streamIndex]
            let pending = self.serverCueFetches.contains(streamIndex)
            self.stateLock.unlock()
            return found != nil || !pending
        }
        return found
    }

    /// Starts the fetches for the tracks AVPlayer selects on its own, so their first window is ready.
    func prefetchServerCues() {
        for sub in config.subtitles where sub.isEngineText && !sub.serverVttUrl.isEmpty && (sub.isDefault || sub.isForced) {
            guard let url = URL(string: sub.serverVttUrl) else { continue }
            stateLock.lock()
            let owner = serverCues[sub.index] == nil && serverCueFetches.insert(sub.index).inserted
            stateLock.unlock()
            if owner { fetchServerCues(streamIndex: sub.index, url: url) }
        }
    }

    private func fetchServerCues(streamIndex: Int, url: URL) {
        var task: URLSessionDataTask?
        task = URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: 30)) { [weak self] data, response, _ in
            guard let self else { return }
            if let task { self.transfers.end(task) }
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            let cues = ok ? data.flatMap { String(data: $0, encoding: .utf8) }.map(Self.parseWebVTT) : nil
            self.stateLock.lock()
            if let cues { self.serverCues[streamIndex] = cues }
            self.serverCueFetches.remove(streamIndex)
            self.stateLock.unlock()
            NSLog("[LocalRemuxer] server subtitles for stream %d: %@", streamIndex, cues.map { "\($0.count) cues" } ?? "unavailable")
        }
        if let task {
            transfers.begin(task)
            task.resume()
        }
    }

    /// Cues of a WebVTT body. Timestamps are hh:mm:ss.mmm or mm:ss.mmm; settings after the end time are dropped.
    static func parseWebVTT(_ body: String) -> [ServerCue] {
        func seconds(_ stamp: Substring) -> Double? {
            let parts = stamp.split(separator: ":")
            guard (2...3).contains(parts.count), let last = Double(parts[parts.count - 1].replacingOccurrences(of: ",", with: ".")) else { return nil }
            let head = parts.dropLast().compactMap { Double($0) }
            guard head.count == parts.count - 1 else { return nil }
            return head.reduce(0) { $0 * 60 + $1 } * 60 + last
        }
        var cues: [ServerCue] = []
        let blocks = body.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n")
        for block in blocks {
            let lines = block.split(separator: "\n", omittingEmptySubsequences: false)
            guard let timing = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let sides = lines[timing].components(separatedBy: "-->")
            guard sides.count == 2,
                  let start = seconds(Substring(sides[0].trimmingCharacters(in: .whitespaces))),
                  let endStamp = sides[1].trimmingCharacters(in: .whitespaces).split(separator: " ").first,
                  let end = seconds(endStamp) else { continue }
            let text = lines[(timing + 1)...].joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !text.isEmpty { cues.append(ServerCue(start: start, end: end, text: text)) }
        }
        return cues
    }
}
