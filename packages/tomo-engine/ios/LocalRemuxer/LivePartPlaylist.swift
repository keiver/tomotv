import Foundation

/// LL-HLS serving for a session whose parts are cut (`lowLatencyInput`): the playlist with parts, the blocking
/// reload (draft-pantos-hls-rfc8216bis 6.2.5.2) and the part files.
extension RemuxSession {
    /// TARGETDURATION before the source's keyframe gap is known: the first answer comes at the first part, before a second keyframe.
    static let lowLatencyTargetSeed = 1

    var servesParts: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return lowLatencyInput
    }

    func signalParts() {
        partSignal.lock()
        partSignal.broadcast()
        partSignal.unlock()
    }

    /// Waits until `condition` (which takes stateLock itself) holds, woken by every cut part and landed segment.
    func waitForParts(deadline seconds: Double, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        partSignal.lock()
        defer { partSignal.unlock() }
        while !condition() {
            if !partSignal.wait(until: end) { return condition() }
        }
        return true
    }

    /// "seg{n}.{k}.m4s" or "aN-seg{n}.{k}.m4s": the segment and part a part name points at.
    static func partIndices(_ name: Substring) -> (segment: Int, part: Int)? {
        guard name.hasPrefix("seg"), name.hasSuffix(".m4s") else { return nil }
        let fields = name.dropFirst(3).dropLast(4).split(separator: ".", omittingEmptySubsequences: false)
        guard fields.count == 2, let n = Int(fields[0]), let k = Int(fields[1]), n >= 0, k >= 0 else { return nil }
        return (n, k)
    }

    /// Segments closed on `rendition`: cut, landed or landing (under stateLock).
    func closedLocked(_ n: Int, _ rendition: Rendition) -> Bool {
        rendition.completed.contains(n) || rendition.writing.contains(n)
    }

    /// Whether the playlist already holds what a blocking reload asks for: part `part` of segment `msn`, or
    /// the whole segment when no part is named. A segment closed with fewer parts moves the ask to the next one.
    func holdsLocked(_ rendition: Rendition, msn: Int, part: Int?) -> Bool {
        if msn < firstRetainedSegment { return true }
        guard let part else { return closedLocked(msn, rendition) }
        if part < (rendition.liveParts[msn]?.count ?? 0) { return true }
        guard closedLocked(msn, rendition) else { return false }
        return !(rendition.liveParts[msn + 1] ?? []).isEmpty || closedLocked(msn + 1, rendition)
    }

    /// The newest segment that has a part on `rendition`, and that part's index (under stateLock).
    func lastPartLocked(_ rendition: Rendition) -> (msn: Int, part: Int)? {
        guard let msn = rendition.liveParts.filter({ !$0.value.isEmpty }).keys.max() else { return nil }
        return (msn, rendition.liveParts[msn]!.count - 1)
    }

    func lowLatencyPlaylistResponse(prefix: String, query: [String: String]) -> LocalHTTPResponse {
        let m3u8 = "application/vnd.apple.mpegurl"
        guard let rendition = rendition(withPrefix: prefix) else { return .notFound }
        let msn = query["_HLS_msn"].map { Int($0) }
        let part = query["_HLS_part"].map { Int($0) }
        if msn == .some(nil) || part == .some(nil) || (part != nil && msn == nil) { return .badRequest }
        _ = waitForParts(deadline: liveFirstAnswerDeadline) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.lastPartLocked(rendition) != nil || self.failed || self.cancelled
        }
        if let msn = msn ?? nil {
            stateLock.lock()
            let newest = lastPartLocked(rendition)?.msn ?? firstRetainedSegment
            stateLock.unlock()
            if msn > newest + 2 { return .badRequest }
            let target = max(liveTarget(), Self.lowLatencyTargetSeed)
            _ = waitForParts(deadline: Double(target) * 3) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return self.holdsLocked(rendition, msn: msn, part: part ?? nil) || self.failed || self.cancelled
            }
        }
        return .data(Data(lowLatencyPlaylist(rendition).utf8), contentType: m3u8)
    }

    func lowLatencyPlaylist(_ rendition: Rendition) -> String {
        let target = max(liveTarget(), Self.lowLatencyTargetSeed)
        stateLock.lock()
        let first = firstRetainedSegment
        let closed = rendition.completed.union(rendition.writing).filter { $0 >= first }.sorted()
        let open = rendition.liveParts.keys.filter { $0 > (closed.last ?? first - 1) && !(rendition.liveParts[$0] ?? []).isEmpty }.min()
        let parts = rendition.liveParts
        let durations = liveDurations
        let dates = liveDates
        let starts = liveGenerationStarts
        let removed = liveDiscontinuitiesRemoved
        let reports = renditions.filter { $0 !== rendition && $0.active }.compactMap { other in
            lastPartLocked(other).map { (uri: other.prefix.isEmpty ? "media.m3u8" : "\(other.prefix).m3u8", msn: $0.msn, part: $0.part) }
        }
        stateLock.unlock()
        let prefix = rendition.prefix
        return Self.renderLowLatencyPlaylist(
            target: target, partTarget: config.livePartSeconds, closed: closed, open: open, parts: parts, durations: durations,
            generationStarts: starts, discontinuitiesRemoved: removed, dates: dates, fallbackDuration: config.liveSegmentSeconds,
            initName: { Self.liveInitName(prefix: prefix, generation: $0) },
            segmentName: { prefix.isEmpty ? "seg\($0).m4s" : "\(prefix)-seg\($0).m4s" },
            partName: { prefix.isEmpty ? "seg\($0).\($1).m4s" : "\(prefix)-seg\($0).\($1).m4s" },
            reports: reports)
    }

    /// The LL-HLS playlist text from a snapshot (pure, host-testable). `open` is the segment still being cut, listed by its parts only.
    static func renderLowLatencyPlaylist(
        target: Int, partTarget: Double, closed: [Int], open: Int?, parts: [Int: [LivePart]], durations: [Int: Double],
        generationStarts: [Int: Int], discontinuitiesRemoved: Int, dates: [Int: Date], fallbackDuration: Double,
        initName: (Int) -> String, segmentName: (Int) -> String, partName: (Int, Int) -> String,
        reports: [(uri: String, msn: Int, part: Int)]
    ) -> String {
        func generation(of n: Int) -> Int { generationStarts.filter { $0.key <= n }.values.max() ?? 0 }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let listed = closed + (open.map { [$0] } ?? [])
        let sequence = listed.first ?? 0

        var out = "#EXTM3U\n#EXT-X-VERSION:9\n"
        out += "#EXT-X-TARGETDURATION:\(target)\n"
        out += String(format: "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=%.3f\n", partTarget * 3)
        out += String(format: "#EXT-X-PART-INF:PART-TARGET=%.3f\n", partTarget)
        out += "#EXT-X-MEDIA-SEQUENCE:\(sequence)\n"
        out += "#EXT-X-DISCONTINUITY-SEQUENCE:\(discontinuitiesRemoved + generationStarts.keys.filter { $0 > 0 && $0 <= sequence }.count)\n"

        // Parts are listed for the segments within three target durations of the live edge.
        var partsFrom = listed.last ?? 0
        var span = 0.0
        for n in listed.reversed() {
            partsFrom = n
            span += n == open ? (parts[n] ?? []).reduce(0) { $0 + $1.duration } : durations[n] ?? fallbackDuration
            if span >= Double(target) * 3 { break }
        }

        var listedGeneration: Int? = nil
        for n in listed {
            let gen = generation(of: n)
            if listedGeneration != gen {
                if listedGeneration != nil { out += "#EXT-X-DISCONTINUITY\n" }
                out += "#EXT-X-MAP:URI=\"\(initName(gen))\"\n"
                if let date = dates[n] { out += "#EXT-X-PROGRAM-DATE-TIME:\(formatter.string(from: date))\n" }
                listedGeneration = gen
            }
            if n >= partsFrom {
                for (k, part) in (parts[n] ?? []).enumerated() {
                    out += String(format: "#EXT-X-PART:DURATION=%.5f,URI=\"%@\"", min(part.duration, partTarget), partName(n, k))
                    out += part.independent ? ",INDEPENDENT=YES\n" : "\n"
                }
            }
            if n != open {
                out += String(format: "#EXTINF:%.6f,\n", durations[n] ?? fallbackDuration)
                out += segmentName(n) + "\n"
            }
        }
        if let last = listed.last {
            let next = last == open ? partName(last, parts[last]?.count ?? 0) : partName(last + 1, 0)
            out += "#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"\(next)\"\n"
        }
        for report in reports {
            out += "#EXT-X-RENDITION-REPORT:URI=\"\(report.uri)\",LAST-MSN=\(report.msn),LAST-PART=\(report.part)\n"
        }
        return out
    }

    /// One part's bytes: held in memory until its segment lands, then read from the segment file. Counts as demand, as a segment request does.
    func partResponse(_ n: Int, part k: Int, prefix: String = "") -> LocalHTTPResponse {
        // The hinted part is asked for before it is cut: held until it is, or until its segment closes without it.
        if let rendition = rendition(withPrefix: prefix) {
            let target = max(liveTarget(), Self.lowLatencyTargetSeed)
            _ = waitForParts(deadline: Double(target) * 3) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return k < (rendition.liveParts[n]?.count ?? 0) || self.closedLocked(n, rendition) || n < self.firstRetainedSegment
                    || self.failed || self.cancelled
            }
        }
        stateLock.lock()
        let rendition = renditions.first { $0.prefix == prefix }
        let list = rendition?.liveParts[n] ?? []
        let dead = failed || cancelled
        if k < list.count {
            lastRequestedSegment = n
            firstMediaRequestSeen = true
            if !sourceReleased { lastPrimaryDemandAt = Date() }
        }
        stateLock.unlock()
        guard !dead, let rendition, k < list.count else { return .notFound }
        if let data = list[k].data { return .data(data, contentType: "video/iso.segment") }
        let offset = Self.stypBox.count + list[..<k].reduce(0) { $0 + $1.size }
        guard let handle = try? FileHandle(forReadingFrom: dir.appendingPathComponent(rendition.segmentName(n))) else { return .notFound }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: UInt64(offset))) != nil, let data = try? handle.read(upToCount: list[k].size),
              data.count == list[k].size else { return .notFound }
        return .data(data, contentType: "video/iso.segment")
    }
}
