import Foundation

/// LL-HLS serving for a session whose parts are cut (`lowLatencyInput`), per draft-pantos-hls-rfc8216bis-22: the playlist
/// with parts (4.4.4.9), Blocking Playlist Reload (6.2.5.2), Playlist Delta Updates (6.2.5.1), the preload hint (6.2.6)
/// and the rendition reports of the Low-Latency Server Configuration Profile (Appendix B.1).
extension RemuxSession {
    /// One EXT-X-RENDITION-REPORT: another media playlist of the master, with its last part when it has parts.
    typealias RenditionReport = (uri: String, msn: Int, part: Int?)

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

    /// Waits until `condition` (which takes stateLock itself) holds, woken by every cut part, landed segment, failure and stop.
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

    /// A delivery directive's value: a decimal-integer (4.2), so no sign; nil when absent, .some(nil) when malformed.
    static func directiveValue(_ query: [String: String], _ name: String) -> Int?? {
        guard let text = query[name] else { return nil }
        guard !text.isEmpty, text.allSatisfy(\.isASCII), text.allSatisfy(\.isNumber), let value = Int(text) else { return .some(nil) }
        return .some(value)
    }

    /// How far behind the live edge the player starts, in seconds: room for the real-time input to wobble without a stall.
    static let liveHoldBackSeconds = 4.0

    /// PART-HOLD-BACK: `liveHoldBackSeconds`, and never under three Part Target Durations (4.4.3.8 asks for at least three).
    static func partHoldBack(partTarget: Double) -> Double {
        max(partTarget * 3, liveHoldBackSeconds)
    }

    /// The Advance Part Limit of 6.2.5.2: three divided by the Part Target Duration below one second, three otherwise.
    static func advancePartLimit(partTarget: Double) -> Double {
        partTarget < 1 ? 3 / partTarget : 3
    }

    /// Whether a blocking reload asks too far ahead (6.2.5.2): past the last full segment plus two, or past the last part
    /// by the Advance Part Limit. The part distance into a later segment counts only that segment's parts, a lower bound.
    static func reloadTooFarAhead(msn: Int, part: Int?, lastSegment: Int, lastPart: (msn: Int, part: Int)?, partTarget: Double) -> Bool {
        if msn > lastSegment + 2 { return true }
        guard let part, let lastPart else { return false }
        let ahead = msn == lastPart.msn ? part - lastPart.part : (msn > lastPart.msn ? part + 1 : 0)
        return Double(ahead) > advancePartLimit(partTarget: partTarget)
    }

    /// Segments closed on `rendition`: cut, landed or landing (under stateLock).
    func closedLocked(_ n: Int, _ rendition: Rendition) -> Bool {
        rendition.completed.contains(n) || rendition.writing.contains(n)
    }

    /// Whether the playlist already holds what a blocking reload asks for: part `part` of segment `msn`, or
    /// the whole segment when no part is named. A part index past a closed segment's last is part 0 of the next one.
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

    /// The newest closed segment of `rendition` in the window (under stateLock).
    func lastClosedLocked(_ rendition: Rendition) -> Int? {
        rendition.completed.union(rendition.writing).filter { $0 >= firstRetainedSegment }.max()
    }

    /// The part the playlist hints next: after the open segment's last part, or the first part of the segment after the last closed one.
    func hintedPartLocked(_ rendition: Rendition) -> (segment: Int, part: Int)? {
        guard let last = lastPartLocked(rendition) else { return nil }
        if let closed = lastClosedLocked(rendition), closed >= last.msn { return (closed + 1, 0) }
        return (last.msn, last.part + 1)
    }

    /// A report for every media playlist the master lists except `excluding` (Appendix B.1): the renditions with
    /// their last part, and the subtitle playlists with the primary's last closed segment, which they list (under stateLock).
    func renditionReportsLocked(excluding uri: String, subtitles: [RemuxSubtitle]) -> [RenditionReport] {
        var reports: [RenditionReport] = []
        for other in renditions {
            let otherURI = other.prefix.isEmpty ? "media.m3u8" : "\(other.prefix).m3u8"
            guard otherURI != uri else { continue }
            if let last = lastPartLocked(other) {
                reports.append((otherURI, last.msn, last.part))
            } else if let closed = lastClosedLocked(other) {
                reports.append((otherURI, closed, nil))
            }
        }
        if let primary = renditions.first(where: { $0.prefix.isEmpty }),
           let listed = primary.completed.filter({ $0 >= firstRetainedSegment }).max() {
            for sub in subtitles where "sub\(sub.index).m3u8" != uri {
                reports.append(("sub\(sub.index).m3u8", listed, nil))
            }
        }
        return reports
    }

    func lowLatencyPlaylistResponse(prefix: String, query: [String: String]) -> LocalHTTPResponse {
        let m3u8 = "application/vnd.apple.mpegurl"
        guard let rendition = rendition(withPrefix: prefix) else { return .notFound }
        let msnValue = Self.directiveValue(query, "_HLS_msn")
        let partValue = Self.directiveValue(query, "_HLS_part")
        if msnValue == .some(nil) || partValue == .some(nil) || (partValue != nil && msnValue == nil) { return .badRequest }
        let skip = query["_HLS_skip"].flatMap { $0 == "YES" || $0 == "v2" ? $0 : nil }
        // An empty media playlist is a player error: the first answer waits for the first part, or with no least target
        // set, for the first full segment, whose keyframe interval fixes the target (6.2.1: it MUST NOT change).
        let learnsTarget = config.liveLowLatencyTargetSeconds <= 0
        _ = waitForParts(deadline: liveFirstAnswerDeadline) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            let ready = learnsTarget ? self.lastClosedLocked(rendition) != nil : self.lastPartLocked(rendition) != nil
            return ready || self.failed || self.cancelled
        }
        if let msn = msnValue ?? nil {
            let part = partValue ?? nil
            stateLock.lock()
            let lastSegment = lastClosedLocked(rendition) ?? (firstRetainedSegment - 1)
            let lastPart = lastPartLocked(rendition)
            stateLock.unlock()
            if Self.reloadTooFarAhead(msn: msn, part: part, lastSegment: lastSegment, lastPart: lastPart, partTarget: config.livePartSeconds) {
                return .badRequest
            }
            let held = waitForParts(deadline: Double(liveTarget()) * 3) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return self.holdsLocked(rendition, msn: msn, part: part) || self.failed || self.cancelled
            }
            stateLock.lock()
            let dead = failed || cancelled
            stateLock.unlock()
            if dead { return .notFound }
            if !held { return .temporarilyUnavailable }
        }
        return .data(Data(lowLatencyPlaylist(rendition, skip: skip).utf8), contentType: m3u8)
    }

    func lowLatencyPlaylist(_ rendition: Rendition, skip: String? = nil) -> String {
        let target = liveTarget(fixing: true)
        let subtitles = sessionSubtitles()
        stateLock.lock()
        let first = firstRetainedSegment
        let closed = rendition.completed.union(rendition.writing).filter { $0 >= first }.sorted()
        let open = rendition.liveParts.keys.filter { $0 > (closed.last ?? first - 1) && !(rendition.liveParts[$0] ?? []).isEmpty }.min()
        let parts = rendition.liveParts
        let durations = liveDurations
        let dates = liveDates
        let starts = liveGenerationStarts
        let removed = liveDiscontinuitiesRemoved
        let prefix = rendition.prefix
        let reports = renditionReportsLocked(excluding: prefix.isEmpty ? "media.m3u8" : "\(prefix).m3u8", subtitles: subtitles)
        stateLock.unlock()
        return Self.renderLowLatencyPlaylist(
            target: target, partTarget: config.livePartSeconds, closed: closed, open: open, parts: parts, durations: durations,
            generationStarts: starts, discontinuitiesRemoved: removed, dates: dates, fallbackDuration: config.liveSegmentSeconds,
            initName: { Self.liveInitName(prefix: prefix, generation: $0) },
            segmentName: { prefix.isEmpty ? "seg\($0).m4s" : "\(prefix)-seg\($0).m4s" },
            partName: { prefix.isEmpty ? "seg\($0).\($1).m4s" : "\(prefix)-seg\($0).\($1).m4s" },
            reports: reports, skip: skip)
    }

    /// The LL-HLS playlist text from a snapshot (pure, host-testable). `open` is the segment still being cut, listed by its
    /// parts only. `skip` ("YES" or "v2") answers an _HLS_skip directive with a Playlist Delta Update.
    static func renderLowLatencyPlaylist(
        target: Int, partTarget: Double, closed: [Int], open: Int?, parts: [Int: [LivePart]], durations: [Int: Double],
        generationStarts: [Int: Int], discontinuitiesRemoved: Int, dates: [Int: Date], fallbackDuration: Double,
        initName: (Int) -> String, segmentName: (Int) -> String, partName: (Int, Int) -> String,
        reports: [RenditionReport], skip: String? = nil
    ) -> String {
        func generation(of n: Int) -> Int { generationStarts.filter { $0.key <= n }.values.max() ?? 0 }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let listed = closed + (open.map { [$0] } ?? [])
        let sequence = listed.first ?? 0
        // 4.4.3.8: the Skip Boundary is at least six Target Durations.
        let skipBoundary = Double(target) * 6

        // 6.2.5.1: the delta skips the segments further than the Skip Boundary from the end of the last full segment.
        var skipped = 0
        if skip != nil {
            var end = closed.reduce(0.0) { $0 + (durations[$1] ?? fallbackDuration) }
            var ends: [Double] = []
            for n in closed.reversed() {
                ends.append(end)
                end -= durations[n] ?? fallbackDuration
            }
            let last = ends.first ?? 0
            skipped = ends.reversed().prefix { last - $0 > skipBoundary }.count
        }

        // Section 8: EXT-X-MAP needs version 6, EXT-X-SKIP 9, and a skip of date ranges (v2) 10.
        let version = skipped == 0 ? 6 : (skip == "v2" ? 10 : 9)
        var out = "#EXTM3U\n#EXT-X-VERSION:\(version)\n"
        out += "#EXT-X-TARGETDURATION:\(target)\n"
        out += String(format: "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=%.1f,PART-HOLD-BACK=%.3f\n", skipBoundary, partHoldBack(partTarget: partTarget))
        out += String(format: "#EXT-X-PART-INF:PART-TARGET=%.3f\n", partTarget)
        out += "#EXT-X-MEDIA-SEQUENCE:\(sequence)\n"
        out += "#EXT-X-DISCONTINUITY-SEQUENCE:\(discontinuitiesRemoved + generationStarts.keys.filter { $0 > 0 && $0 <= sequence }.count)\n"
        if skipped > 0 {
            out += "#EXT-X-SKIP:SKIPPED-SEGMENTS=\(skipped)" + (skip == "v2" ? ",RECENTLY-REMOVED-DATERANGES=\"\"" : "") + "\n"
        }

        // 6.2.2: parts are listed for the segments within three Target Durations of the end.
        var partsFrom = listed.last ?? 0
        var span = 0.0
        for n in listed.reversed() {
            partsFrom = n
            span += n == open ? (parts[n] ?? []).reduce(0) { $0 + $1.duration } : durations[n] ?? fallbackDuration
            if span >= Double(target) * 3 { break }
        }

        var listedGeneration: Int? = nil
        for (position, n) in listed.enumerated() {
            let gen = generation(of: n)
            let shown = position >= skipped
            // 4.4.4.9: a parent segment's DISCONTINUITY, MAP and PROGRAM-DATE-TIME come before its first part.
            if listedGeneration != gen {
                if shown {
                    if listedGeneration != nil { out += "#EXT-X-DISCONTINUITY\n" }
                    out += "#EXT-X-MAP:URI=\"\(initName(gen))\"\n"
                    if let date = dates[n] { out += "#EXT-X-PROGRAM-DATE-TIME:\(formatter.string(from: date))\n" }
                }
                listedGeneration = gen
            }
            guard shown else { continue }
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
        // Appendix B.1: a playlist with parts hints the next one.
        if let last = listed.last {
            let next = last == open ? partName(last, parts[last]?.count ?? 0) : partName(last + 1, 0)
            out += "#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"\(next)\"\n"
        }
        out += renditionReportLines(reports)
        return out
    }

    /// 4.4.5.4: LAST-PART only for a rendition with parts.
    static func renditionReportLines(_ reports: [RenditionReport]) -> String {
        reports.map { "#EXT-X-RENDITION-REPORT:URI=\"\($0.uri)\",LAST-MSN=\($0.msn)" + ($0.part.map { ",LAST-PART=\($0)" } ?? "") + "\n" }.joined()
    }

    /// One part's bytes: held in memory until its segment lands, then read from the segment file. The hinted part is held
    /// until it is cut (6.2.6); any other part that does not exist is a 404. Counts as demand, as a segment request does.
    func partResponse(_ n: Int, part k: Int, prefix: String = "") -> LocalHTTPResponse {
        guard let rendition = rendition(withPrefix: prefix) else { return .notFound }
        stateLock.lock()
        let exists = k < (rendition.liveParts[n]?.count ?? 0)
        let hinted = hintedPartLocked(rendition).map { $0.segment == n && $0.part == k } ?? false
        stateLock.unlock()
        if !exists, hinted {
            _ = waitForParts(deadline: Double(liveTarget()) * 3) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return k < (rendition.liveParts[n]?.count ?? 0) || self.closedLocked(n, rendition) || self.failed || self.cancelled
            }
        }
        stateLock.lock()
        let list = rendition.liveParts[n] ?? []
        let dead = failed || cancelled
        if k < list.count {
            lastRequestedSegment = n
            firstMediaRequestSeen = true
            if !sourceReleased { lastPrimaryDemandAt = Date() }
        }
        stateLock.unlock()
        guard !dead, k < list.count else { return .notFound }
        if let data = list[k].data { return .data(data, contentType: "video/iso.segment") }
        let offset = Self.stypBox.count + list[..<k].reduce(0) { $0 + $1.size }
        guard let handle = try? FileHandle(forReadingFrom: dir.appendingPathComponent(rendition.segmentName(n))) else { return .notFound }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: UInt64(offset))) != nil, let data = try? handle.read(upToCount: list[k].size),
              data.count == list[k].size else { return .notFound }
        return .data(data, contentType: "video/iso.segment")
    }

    /// A closed segment whose file is still landing, joined from its parts in memory (6.2.1: a listed segment is downloadable at once). Under stateLock.
    func landingSegmentLocked(_ n: Int, _ rendition: Rendition) -> Data? {
        guard lowLatencyInput, rendition.writing.contains(n), let parts = rendition.liveParts[n], !parts.isEmpty,
              parts.allSatisfy({ $0.data != nil }) else { return nil }
        return parts.reduce(into: Self.stypBox) { $0.append($1.data!) }
    }
}
