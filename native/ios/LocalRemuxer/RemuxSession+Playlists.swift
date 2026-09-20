//
//  RemuxSession+Playlists.swift
//  TomoTV
//
//  The playlist model AVPlayer reads: the master, the VOD/live media playlists,
//  the live sliding-window renderer, and the subtitle rendition playlists.
//

import Foundation

extension RemuxSession {
    // MARK: - Playlists

    /// One budget for everything the master waits on, measured from the session opening: the
    /// grid and the tier probe share it, so a slow server cannot stack two waits before
    /// AVPlayer sees a single response header.
    static let masterBudgetSeconds = 12.0
    /// The link, as a multiple of the source rate, on which the copy's first 6s segment lands in 2s.
    static let copyLeadsMargin = 3.0
    /// How many times over the link carries the rung that opens a session.
    static let openingRungShare = 6.0

    func masterBudgetLeft() -> Double {
        max(0.5, Self.masterBudgetSeconds - Date().timeIntervalSince(openedAt))
    }

    /// Blocks (bounded) until the session grid is decided when a tier is
    /// configured; instant for every non-gateway session.
    func awaitGrid() {
        guard !config.tiers.isEmpty else { return }
        _ = waitUntil(deadline: masterBudgetLeft()) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.gridResolved || self.failed || self.cancelled
        }
    }

    /// True once the tier's grid is adopted and the tier has not been retired: masterPlaylist() then
    /// lists the copy and the rungs together. The background probe retires a server whose
    /// transcoder is broken (dropTier), which clears this for the session.
    var tierOffered: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return !adoptedStarts.isEmpty && !tierDisabled
    }

    /// Once per session: what the master did with the configured ladder.
    func reportTier(listed: Bool) {
        stateLock.lock()
        guard !config.tiers.isEmpty, !tierReported else { return stateLock.unlock() }
        tierReported = true
        tierListed = listed
        let reason = tierDropReason ?? tierUnavailableReason
        stateLock.unlock()
        NSLog("[LocalRemuxer] Slipstream: master %@ the tier%@", listed ? "leads with" : "withholds", reason.map { ", \($0)" } ?? "")
        var payload: [String: Any] = ["token": token, "state": listed ? "listed" : "declined"]
        if probeSeconds > 0 { payload["probeSeconds"] = round(probeSeconds * 100) / 100 }
        if !listed, let reason { payload["reason"] = reason }
        onTier?(payload)
    }

    /// The rung the master leads with, latched by the first caller: the biggest whose segment lands
    /// in about a second, so a thin link opens on the fewest bytes (the biggest rung that fits cost
    /// 12.7s at 1.5 Mb/s) and a fast one above 144p. Starts its opening fetch.
    @discardableResult
    func chooseOpeningRung(linkBps: Double) -> Int? {
        stateLock.lock()
        let rungs = (0..<config.tiers.count).filter { !rungsUnavailable.contains($0) }
        let latched = openingRung.flatMap { rungs.contains($0) ? $0 : nil }
        // A copy that leads opens the session itself, and a rung fetched beside its first segment
        // takes the link from it (measured at 30 Mb/s: AVPlayer hedged onto the bottom rung).
        let copyLeads = copyVerdict != .withheld && !sourceReleased && (config.bandwidth <= 0 || linkBps >= Double(config.bandwidth) * Self.copyLeadsMargin)
        let chosen = latched ?? (copyLeads ? nil : rungs.last { Double(config.tiers[$0].bandwidth) * Self.openingRungShare <= linkBps }) ?? rungs.first
        // Nothing is latched while the copy leads: a source that then will not open leaves the
        // master free to choose by the link.
        let settles = latched != nil || !copyLeads
        let kick = latched == nil && !copyLeads && (chosen ?? 0) > 0
        if settles { openingRung = chosen }
        stateLock.unlock()
        if kick, let chosen { fetchOpeningSegment(rung: chosen) }
        return chosen
    }

    func masterPlaylist() -> String {
        awaitGrid()
        // Live: the tracks and the captions come off the open input, not from Jellyfin's probe.
        if config.isLive {
            _ = waitUntil(deadline: 40) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return self.liveStreamsResolved || self.failed || self.cancelled
            }
            stateLock.lock()
            let unresolved = !liveStreamsResolved && !failed && !cancelled
            stateLock.unlock()
            // A master guessed from Jellyfin's probe can name tracks the pipeline never builds.
            if unresolved {
                fail("live input did not resolve within 40s")
                return "#EXTM3U\n"
            }
        }
        let offered = tierOffered
        // A copy is named only once it can be produced: a source that will not open, or cannot be
        // planned, lets itself go before this returns, and the rungs carry the session instead.
        if offered, decideCopy() {
            _ = waitUntil(deadline: masterBudgetLeft()) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return self.sourceReady || self.sourceReleased || self.failed || self.cancelled
            }
        }
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"

        // Audio renditions. Every track points at its own audio-only playlist
        // — none is muxed into the variant. A muxed (URI-less) rendition gets
        // its picker label from the embedded stream metadata, not from NAME:
        // an "und" track showed as "Unknown", and which track wore which label
        // style changed with the mux order on every rebuild. All-URI renditions
        // are labelled from NAME consistently, same as the server-side
        // multi-audio path.
        //
        // LANGUAGE is emitted on every rendition, "und" included. Apple's HLS
        // authoring specification requires it: req 4.7 for a subtitles track,
        // req 8.10 for every EXT-X-MEDIA tag that is not TYPE=VIDEO. "und" is
        // the BCP 47 subtag for undetermined and is what an untagged track is.
        //
        // This used to be omitted for "und", justified by a comment claiming
        // iOS always prefers LANGUAGE for the picker label so leaving it out
        // was what made NAME show. The device log contradicts that: T06 ships
        // LANGUAGE="eng" and onTextTracks still reported NAME as the track's
        // title. Note the log settles the option's common metadata title, not
        // what AVKit paints in the picker row, which is a different field
        // (AVMediaSelectionOption.displayName, documented only as "may use"
        // common metadata). If a device run ever shows the rows collapsing to
        // a language name, that is the tradeoff to revisit — not this comment.
        // Slipstream sessions force the audio-GROUP shape even with one track:
        // the tier variant is video-only and switching variants must never
        // touch the audio, so audio always rides the group, never the variant.
        stateLock.lock()
        let tracks = liveAudioTracks ?? config.audioTracks
        let subtitles = liveSubtitles ?? config.subtitles
        stateLock.unlock()
        // Same predicate as the pipeline's splitAudio, or the master names a rendition never built.
        let useAudioGroup = tracks.count > 1 || !config.tiers.isEmpty
        if useAudioGroup {
            for (position, track) in tracks.enumerated() {
                let name = track.name.replacingOccurrences(of: "\"", with: "")
                var line = "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"\(name)\""
                line += ",LANGUAGE=\"\(track.language.isEmpty ? "und" : track.language)\""
                // RFC 8216: when DEFAULT is YES, AUTOSELECT must also be YES if
                // present. Emitting DEFAULT=YES,AUTOSELECT=NO makes
                // AVFoundation reject the whole master playlist (-12642).
                line += position == 0 ? ",DEFAULT=YES,AUTOSELECT=YES" : ",DEFAULT=NO,AUTOSELECT=NO"
                line += ",URI=\"\(audioPrefix(position)).m3u8\""
                out += line + "\n"
            }
        }
        // Slipstream audio-lo: the tier's own server-fed audio group, so the
        // survival rung never depends on the engine's source pull. Same member
        // set with identical attributes except URI (RFC 8216 §4.3.4.1.1);
        // selection follows LANGUAGE/DEFAULT across groups on a variant switch.
        if audioLoActive {
            for (position, track) in config.audioTracks.enumerated() {
                let name = track.name.replacingOccurrences(of: "\"", with: "")
                var line = "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio-lo\",NAME=\"\(name)\""
                line += ",LANGUAGE=\"\(track.language.isEmpty ? "und" : track.language)\""
                line += position == 0 ? ",DEFAULT=YES,AUTOSELECT=YES" : ",DEFAULT=NO,AUTOSELECT=NO"
                if track.serverAudioChannels > 0 { line += ",CHANNELS=\"\(track.serverAudioChannels)\"" }
                line += ",URI=\"a\(position)s.m3u8\""
                out += line + "\n"
            }
        }

        // RFC 8216 §4.3.4.1 also forbids a group from carrying more than one
        // member with DEFAULT=YES, and Matroska is happy to flag several
        // subtitle tracks as default at once. Emitting them all costs the whole
        // file, not just its subtitles, because AVFoundation rejects the master
        // playlist outright. First default wins, the rest are demoted.
        let defaultSubtitle = subtitles.firstIndex(where: { $0.isDefault })

        for (position, sub) in subtitles.enumerated() {
            let name = sub.name.replacingOccurrences(of: "\"", with: "")
            let isDefault = position == defaultSubtitle
            var line = "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"\(name)\""
            line += ",LANGUAGE=\"\(sub.language.isEmpty ? "und" : sub.language)\""
            // Same RFC 8216 rule as the audio group: DEFAULT=YES requires
            // AUTOSELECT=YES. A file carrying a default subtitle (very common
            // in MKV rips) otherwise makes AVFoundation reject the entire
            // master playlist with a bare -12642.
            //
            // A forced track is AUTOSELECT=YES too, without being DEFAULT: it
            // must be presentable on its own (it carries dialogue the viewer is
            // meant to see) but must not switch on a full subtitle track for
            // someone who never asked for one.
            line += isDefault ? ",DEFAULT=YES" : ",DEFAULT=NO"
            line += isDefault || sub.isForced ? ",AUTOSELECT=YES" : ",AUTOSELECT=NO"
            // FORCED=YES is never emitted, whatever the source flags say.
            //
            // AVFoundation treats a forced rendition as something it applies on
            // the viewer's behalf rather than something the viewer chooses, so
            // it withholds it from AVKit's picker and never reports it as the
            // current media selection. What it then does NOT do is apply it.
            // Three files from one device session, differing in this attribute
            // alone, measured 2026-08-13:
            //
            //   T06, one PGS track, FORCED=NO,  eng default: selection held,
            //        listed in the picker, drawn.
            //   T07, ten SUBRIP tracks, FORCED=NO, deu default: automatic
            //        selection cleared, still listed, manual picks hold.
            //   T05, one SUBRIP track, FORCED=YES, eng default: selection
            //        cleared 0.4s into playback, before its first cue at
            //        2.253s, and NO picker entry at all. Played from zero with
            //        two cues inside the window watched, nothing was drawn.
            //
            // So the attribute's only observed effect here is that the viewer
            // loses the track outright. DEFAULT=YES and AUTOSELECT=YES carry
            // the intent instead: a forced track still presents itself without
            // being asked for, and stays something the viewer can switch off.
            //
            // The cost is AVKit's "Auto" subtitle entry, which keys off exactly
            // this attribute. It buys nothing: a rendition AVKit will neither
            // offer nor render cannot be shown by any mode.
            //
            // There is no "emit it only when the group also holds a selectable
            // track" branch. No file in the test library pairs a forced track
            // with a non-forced one, so such a branch could not be verified.
            line += ",FORCED=NO"
            line += ",URI=\"sub\(sub.index).m3u8\"\n"
            out += line
        }

        // Peak bit rate of the variant (req 9.13), and the average alongside it
        // (req 9.14). This was a hardcoded 20 Mbps, which was true of nothing.
        // Zero means Jellyfin gave us no bit rate, and an absent attribute beats
        // an invented one — except that BANDWIDTH is the single required
        // attribute of this tag, so it falls back rather than disappearing.
        let bandwidth = config.bandwidth > 0 ? config.bandwidth : 20_000_000
        var primary = "#EXT-X-STREAM-INF:BANDWIDTH=\(bandwidth),AVERAGE-BANDWIDTH=\(bandwidth)"
        // Unquoted enumerated value per RFC 8216 §4.3.4.2. RFC 8216 §4.3.4.2
        // scopes VIDEO-RANGE to variants that carry video, so an audio-only
        // session sends an empty string and the attribute is left off.
        if !config.videoRange.isEmpty {
            primary += ",VIDEO-RANGE=\(config.videoRange)"
        }
        if !config.codecs.isEmpty {
            // Authoring spec req 5.10 says the subtitle kind SHOULD appear here
            // as "wvtt". Deliberately not emitted. It is a SHOULD, the attribute
            // is one AVPlayer hard-rejects when it disagrees, and no fixture
            // pairs a subtitle track with a variant carrying CODECS at all.
            // Nothing we own can prove the token is harmless, and its failure
            // mode is the whole file refusing to play.
            primary += ",CODECS=\"\(config.codecs)\""
            // Only alongside CODECS: SUPPLEMENTAL-CODECS names the same
            // rendition's optional decode, so it cannot stand on its own.
            if !config.supplementalCodecs.isEmpty {
                primary += ",SUPPLEMENTAL-CODECS=\"\(config.supplementalCodecs)\""
            }
        }
        // Required whenever the rendition has video (req 9.2 and 9.15).
        if config.width > 0 && config.height > 0 {
            primary += ",RESOLUTION=\(config.width)x\(config.height)"
        }
        if config.frameRate > 0 {
            // Trailing zeros trimmed so 24.0 reads as 24 and 23.976 survives,
            // which is how Jellyfin writes it too.
            primary += String(format: ",FRAME-RATE=%g", config.frameRate)
        }
        if useAudioGroup {
            primary += ",AUDIO=\"audio\""
        }
        if !subtitles.isEmpty {
            primary += ",SUBTITLES=\"subs\""
        }
        // Say plainly that there are none. RFC 8216 §4.3.4.2 makes this the way
        // a playlist declares that no variant carries closed captions, and with
        // the attribute absent the player cannot rule them out: AVFoundation
        // then offers a legible option with an empty title and no language,
        // which AVKit lists as "CC" and which draws nothing when selected.
        // Measured on T88, a file with no subtitle streams at all, whose video
        // ffprobe confirms carries no CEA-608/708 either.
        //
        // This is a blanket claim. The master playlist is written before FFmpeg
        // opens the input, and Jellyfin does not report captions embedded in a
        // video stream, so at this moment there is no way to know whether a
        // given source has them. No file in the test library does. If one ever
        // shows up whose captions this hides, that is the trade to revisit.
        //
        // NONE is only legal if EVERY EXT-X-STREAM-INF says NONE. Every variant
        // the master lists (the on-device copy, or the tier rungs) says NONE.
        //
        // The exception is copied video whose opening packets carried A/53 captions (read
        // before the muxers are built, see runPipeline): the SEI survives the copy, so the
        // group is declared (authoring spec 4.4) and AVPlayer renders the captions itself.
        stateLock.lock()
        let captions = embeddedCaptions
        stateLock.unlock()
        if captions {
            out += "#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID=\"cc\",NAME=\"CC1\",INSTREAM-ID=\"CC1\",DEFAULT=NO,AUTOSELECT=YES\n"
            primary += ",CLOSED-CAPTIONS=\"cc\""
        } else {
            primary += ",CLOSED-CAPTIONS=NONE"
        }
        primary += "\nmedia.m3u8\n"

        // Slipstream ladder: the on-device copy and the rungs in one master, all on the SAME grid and
        // sharing the subtitle group, so AVPlayer's own ABR steps down when the copy outruns the
        // link and climbs back when it recovers. The first variant listed is where it starts: the
        // copy on a link measured to carry it, else the smallest rung.
        guard offered else {
            // The ladder is gone. A session that had let its source go for it has nothing left to play.
            if isSourceReleased { fail("the ladder was lost after the source was let go") }
            stateLock.lock()
            copyVerdict = .listed
            copyAnnounced = true
            stateLock.unlock()
            out += primary
            reportTier(listed: false)
            return out
        }
        stateLock.lock()
        let copyFirst = !sourceUnusable
        if copyFirst { copyAnnounced = true }
        // A source that cannot be read leaves the probe nothing to time; the ladder is then sized by
        // the canonical playlist's own transfer, the one other body that moves at the wire's pace.
        let linkBps = testLinkBps ?? measuredLinkBps ?? playlistLinkBps ?? 0
        let rungs = (0..<config.tiers.count).filter { !rungsUnavailable.contains($0) }
        stateLock.unlock()
        let startRung = chooseOpeningRung(linkBps: linkBps)
        let listed = rungs

        func rungLine(_ k: Int) -> String {
            let rung = config.tiers[k]
            let group = audioLoActive ? "audio-lo" : "audio"
            let bw = rung.bandwidth > 0 ? rung.bandwidth : 1_500_000
            var line = "#EXT-X-STREAM-INF:BANDWIDTH=\(bw),AVERAGE-BANDWIDTH=\(bw)"
            // Rungs are SDR by build; declare their real resolution and codecs.
            if !config.videoRange.isEmpty {
                line += ",VIDEO-RANGE=SDR"
            }
            if !rung.codecs.isEmpty && !config.codecs.isEmpty {
                line += ",CODECS=\"\(rung.codecs)\""
            }
            if rung.width > 0 && rung.height > 0 {
                line += ",RESOLUTION=\(rung.width)x\(rung.height)"
            }
            if config.frameRate > 0 {
                line += String(format: ",FRAME-RATE=%g", config.frameRate)
            }
            line += ",AUDIO=\"\(group)\""
            if !config.subtitles.isEmpty {
                line += ",SUBTITLES=\"subs\""
            }
            // RFC 8216 4.3.4.2: CLOSED-CAPTIONS=NONE on one variant requires it on all of them.
            line += captions ? ",CLOSED-CAPTIONS=\"cc\"" : ",CLOSED-CAPTIONS=NONE"
            return line + "\nt\(k).m3u8\n"
        }

        // The copy leads only on a link that lands its first segment at once. Listed first at
        // 12 Mb/s (1.9x the source) its 4.7 MB opening segment took 3.7s, AVPlayer hedged onto the
        // bottom rung and showed a frame at 8.6s; it then climbed to the copy on the same item by
        // itself (measured). So under that margin the smallest rung leads and the copy stays listed.
        let copyLeads = copyFirst && (config.bandwidth <= 0 || linkBps >= Double(config.bandwidth) * Self.copyLeadsMargin)
        if copyLeads {
            out += primary + listed.map(rungLine).joined()
        } else if copyFirst, let startRung {
            out += rungLine(startRung) + primary + listed.filter { $0 != startRung }.map(rungLine).joined()
            stateLock.lock()
            rungLeads = true
            stateLock.unlock()
        } else if copyFirst {
            out += primary
        } else if let startRung {
            out += rungLine(startRung) + listed.filter { $0 != startRung }.map(rungLine).joined()
            // Opening on a rung means the copy is not being played: a source still open (one the
            // demuxer owes a track from) holds its pull now rather than ten seconds from now, or the
            // producer spends the slow link the rungs need.
            stateLock.lock()
            lastTierDemandAt = Date()
            rungLeads = true
            stateLock.unlock()
        } else {
            out += primary
        }
        NSLog("[LocalRemuxer] Slipstream: master starts on %@%@ (link %.1f Mb/s, %d rungs)",
              copyLeads || startRung == nil ? "the copy" : "rung \(startRung ?? 0)", copyFirst && !copyLeads ? " with the copy listed" : "", linkBps / 1_000_000, listed.count)
        reportTier(listed: !rungs.isEmpty)
        return out
    }

    /// EXT-X-START line for resume sessions, or empty. Media playlists only —
    /// the proven placement (the master carries no per-timeline tags here).
    var startTag: String {
        config.startOffsetSeconds > 0 ? String(format: "#EXT-X-START:TIME-OFFSET=%.3f,PRECISE=NO\n", config.startOffsetSeconds) : ""
    }

    /// One TARGETDURATION for every playlist of the session — Apple authoring
    /// req 8.2: audio and video playlists MUST all use the same value.
    func sessionTargetDuration() -> Int {
        if config.isLive { return liveTarget() }
        let count = segmentCount
        let maxDur = (0..<count).lazy.map { self.segmentDurationSeconds($0) }.max() ?? Self.segmentDuration
        return Int(ceil(max(maxDur, Self.segmentDuration * 2)))
    }

    /// Slipstream tier media playlist: the adopted segment list on our URL
    /// scheme. Timeline identical to the primary's by construction.
    func tierPlaylist(rung: Int) -> String? {
        guard adoptRung(rung) else { return nil }
        stateLock.lock()
        let segments = tierSegments[rung] ?? []
        stateLock.unlock()
        guard !segments.isEmpty, !isTierDisabled else { return nil }
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n" + startTag
        out += "#EXT-X-TARGETDURATION:\(sessionTargetDuration())\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"t\(rung)-init.mp4\"\n"
        for (n, seg) in segments.enumerated() {
            out += String(format: "#EXTINF:%.6f,\n", seg.duration)
            out += "t\(rung)-seg\(n).m4s\n"
        }
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// Rendition prefix for the alternate audio track at `position` (>= 1).
    func audioPrefix(_ position: Int) -> String { "a\(position)" }

    /// Media playlist for a rendition. `prefix` is "" for the primary
    /// (video + default audio) and "aN" for an alternate audio track; the
    /// segment timeline is identical across all of them, because every
    /// rendition is cut on the same boundaries.
    func mediaPlaylist(prefix: String = "") -> String {
        if config.isLive { return livePlaylist(prefix: prefix) }
        awaitGrid()
        let initName = prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4"
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n" + startTag
        // Covers the final segment, which absorbs the duration remainder and
        // can run just under 2x the nominal segment length; shared session-wide.
        let count = segmentCount
        out += "#EXT-X-TARGETDURATION:\(sessionTargetDuration())\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"\(initName)\"\n"
        for n in 0..<count {
            out += String(format: "#EXTINF:%.6f,\n", segmentDurationSeconds(n))
            out += prefix.isEmpty ? "seg\(n).m4s\n" : "\(prefix)-seg\(n).m4s\n"
        }
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// Resizes the live window from here on; segments already pruned stay gone.
    func setLiveWindow(seconds: Double) {
        guard config.isLive else { return }
        stateLock.lock()
        liveKeepSegments = max(3, Int(seconds / max(1, config.liveSegmentSeconds)))
        stateLock.unlock()
    }

    func liveWindowSecondsNow() -> Double {
        stateLock.lock()
        defer { stateLock.unlock() }
        return Double(liveKeepSegments) * config.liveSegmentSeconds
    }

    /// Live TARGETDURATION: never below the longest retained segment, and it only ever rises.
    /// A copied segment runs to the next keyframe, so a GOP longer than the headroom lifts it.
    func liveTarget() -> Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        let longest = liveDurations.values.max() ?? 0
        let target = max(liveTargetDuration ?? 0, max(1, Int(ceil(max(liveCapSecondsLocked(), longest)))))
        liveTargetDuration = target
        return target
    }

    /// TARGETDURATION headroom over the segment target: a full source keyframe interval on a copy
    /// lane (segments run one GOP long when the interval exceeds the target), a fixed margin where
    /// the encoder forces keyframes at the target. Under stateLock.
    func liveCapSecondsLocked() -> Double {
        if renditions.first?.videoTranscoder != nil { return config.liveSegmentSeconds + 0.5 }
        return config.liveSegmentSeconds + max(maxKeyframeGapSeconds, config.liveSegmentSeconds)
    }

    static func liveInitName(prefix: String, generation: Int) -> String {
        let base = prefix.isEmpty ? "init" : "\(prefix)-init"
        return generation == 0 ? "\(base).mp4" : "\(base)-g\(generation).mp4"
    }

    /// Sliding-window playlist for a live rendition: retained segments only, measured EXTINF,
    /// a MAP per generation and a DISCONTINUITY at every splice. No ENDLIST, no PLAYLIST-TYPE.
    func livePlaylist(prefix: String) -> String {
        guard let rendition = rendition(withPrefix: prefix) else { return "#EXTM3U\n" }
        // An empty media playlist is a player error; the first segment is seconds away.
        _ = waitUntil(deadline: 20) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return !rendition.completed.isEmpty || self.failed || self.cancelled
        }
        let target = liveTarget()
        stateLock.lock()
        let first = firstRetainedSegment
        let segments = rendition.completed.filter { $0 >= first }.sorted()
        let durations = liveDurations
        let dates = liveDates
        let starts = liveGenerationStarts
        let removed = liveDiscontinuitiesRemoved
        stateLock.unlock()
        return Self.renderLivePlaylist(
            prefix: prefix, target: target, firstRetained: first, segments: segments,
            durations: durations, generationStarts: starts, discontinuitiesRemoved: removed, dates: dates, fallbackDuration: config.liveSegmentSeconds)
    }

    /// The image track's live playlist: the primary rendition's window, one cue-less VTT per segment.
    func liveSubtitlePlaylist(_ sub: RemuxSubtitle) -> String {
        guard let rendition = rendition(withPrefix: "") else { return "#EXTM3U\n" }
        _ = waitUntil(deadline: 20) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return !rendition.completed.isEmpty || self.failed || self.cancelled
        }
        let target = liveTarget()
        stateLock.lock()
        let first = firstRetainedSegment
        let segments = rendition.completed.filter { $0 >= first }.sorted()
        let durations = liveDurations
        let dates = liveDates
        let starts = liveGenerationStarts
        let removed = liveDiscontinuitiesRemoved
        stateLock.unlock()
        return Self.renderLivePlaylist(
            target: target, firstRetained: first, segments: segments, durations: durations, generationStarts: starts, discontinuitiesRemoved: removed,
            dates: dates, fallbackDuration: config.liveSegmentSeconds, initName: nil, segmentName: { "sub\(sub.index)-\($0).vtt" })
    }

    /// The live playlist text from a snapshot of the session's live state (pure, host-testable).
    static func renderLivePlaylist(
        prefix: String, target: Int, firstRetained: Int, segments: [Int], durations: [Int: Double],
        generationStarts: [Int: Int], discontinuitiesRemoved: Int = 0, dates: [Int: Date], fallbackDuration: Double
    ) -> String {
        renderLivePlaylist(
            target: target, firstRetained: firstRetained, segments: segments, durations: durations, generationStarts: generationStarts,
            discontinuitiesRemoved: discontinuitiesRemoved, dates: dates, fallbackDuration: fallbackDuration,
            initName: { liveInitName(prefix: prefix, generation: $0) },
            segmentName: { prefix.isEmpty ? "seg\($0).m4s" : "\(prefix)-seg\($0).m4s" })
    }

    /// `initName` maps a generation to its MAP; nil writes no MAP (a WebVTT rendition has none).
    static func renderLivePlaylist(
        target: Int, firstRetained: Int, segments: [Int], durations: [Int: Double], generationStarts: [Int: Int], discontinuitiesRemoved: Int = 0,
        dates: [Int: Date], fallbackDuration: Double, initName: ((Int) -> String)?, segmentName: (Int) -> String
    ) -> String {
        func generation(of n: Int) -> Int { generationStarts.filter { $0.key <= n }.values.max() ?? 0 }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        out += "#EXT-X-TARGETDURATION:\(target)\n"
        out += "#EXT-X-MEDIA-SEQUENCE:\(firstRetained)\n"
        // Splices at or before the first listed segment have left the playlist, the pruned ones included.
        out += "#EXT-X-DISCONTINUITY-SEQUENCE:\(discontinuitiesRemoved + generationStarts.keys.filter { $0 > 0 && $0 <= firstRetained }.count)\n"
        var listed: Int? = nil
        for n in segments {
            let gen = generation(of: n)
            if listed != gen {
                if listed != nil { out += "#EXT-X-DISCONTINUITY\n" }
                if let initName { out += "#EXT-X-MAP:URI=\"\(initName(gen))\"\n" }
                if let date = dates[n] { out += "#EXT-X-PROGRAM-DATE-TIME:\(formatter.string(from: date))\n" }
                listed = gen
            }
            out += String(format: "#EXTINF:%.6f,\n", durations[n] ?? fallbackDuration)
            out += segmentName(n) + "\n"
        }
        return out
    }

    /// Subtitle playlist. An engine-decoded text track is cut on the session
    /// grid: cues only exist as far as the read loop has got, and one full-length
    /// segment is fetched once, at load. Measured on a paced link 2026-09-10,
    /// AVFoundation takes four at load then one just ahead of each video segment,
    /// which is where the demux already is. Everything else stays one segment.
    func subtitlePlaylist(streamIndex: Int) -> String? {
        stateLock.lock()
        let subtitles = liveSubtitles ?? config.subtitles
        stateLock.unlock()
        guard let sub = subtitles.first(where: { $0.index == streamIndex }) else { return nil }
        // Measured: selecting a rendition leaves the item's tracks unchanged, and its playlist is
        // refreshed while selected and never after. The request is the selection.
        if config.isLive {
            onSubtitleRequest?(["token": token, "streamIndex": sub.index, "requestedAt": Date().timeIntervalSince1970 * 1000])
        }

        // Live carries image tracks only, on the video's own window: the same segments and
        // target (authoring spec 5.6), cue-less bodies, no init.
        if config.isLive { return liveSubtitlePlaylist(sub) }

        if sub.isEngineText {
            // Nothing is published until the track can answer for itself: the
            // player asks for segments the instant it has this list.
            _ = awaitTextDecoder(streamIndex: streamIndex)
            // One TARGETDURATION for every playlist of the session (Apple
            // authoring req 8.2), on the video's own grid.
            var out = "#EXTM3U\n#EXT-X-VERSION:7\n" + startTag
            out += "#EXT-X-TARGETDURATION:\(sessionTargetDuration())\n"
            out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
            for n in 0 ..< segmentCount {
                out += String(format: "#EXTINF:%.6f,\n", segmentDurationSeconds(n))
                out += "sub\(sub.index)-\(n).vtt\n"
            }
            out += "#EXT-X-ENDLIST\n"
            return out
        }

        let dur = max(1, Int(ceil(config.durationSeconds)))
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n" + startTag
        out += "#EXT-X-TARGETDURATION:\(dur)\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += String(format: "#EXTINF:%.3f,\n", config.durationSeconds)
        out += sub.isImage || !sub.localVtt.isEmpty ? "sub\(sub.index).vtt\n" : "\(sub.vttUrl)\n"
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// The track's decoder, once the pipeline has built it.
    ///
    /// The decoders come up when the input opens, and AVFoundation can ask for a
    /// track before that: measured on an Apple TV, all ten segments of a 60s
    /// item arrived 250ms after the session started. Answering "not yet" with an
    /// empty body loses the whole track, because a VOD segment is fetched once.
    /// The playlist waits on this too, so by the time a segment can be asked for
    /// the answer is already there.
    func awaitTextDecoder(streamIndex: Int) -> TextSubtitleDecoder? {
        var decoder: TextSubtitleDecoder?
        _ = waitUntil(deadline: Self.subtitleSegmentWaitSeconds) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            decoder = self.textSubtitles[Int32(streamIndex)]
            // Built, not merely absent: a codec this build cannot decode never
            // gets an entry, and waiting the deadline out for it would hold the
            // playlist 25s and leave the track out of the picker anyway.
            let settled = self.subtitleDecodersBuilt || self.failed || self.cancelled || self.sourceReleased
            self.stateLock.unlock()
            return decoder != nil || settled
        }
        return decoder
    }

    /// Whether one read generation started before `end` and reached it. Caller holds stateLock.
    func readCoversLocked(through end: Double) -> Bool {
        if let from = readSpanFrom, from < end, readSpanUpTo >= end { return true }
        return readSpans.contains { $0.from < end && $0.upTo >= end }
    }

    /// One WebVTT segment of an engine-decoded text track, in output time.
    /// Blocks (bounded) until the read loop passes the window's end, which is
    /// when the video segment covering it finishes. A window the read loop
    /// cannot reach in time comes from the server's WebVTT when the track has
    /// one; otherwise it serves what it holds: a failed request loses the track,
    /// a short one a line.
    func subtitleSegment(streamIndex: Int, segment n: Int) -> String? {
        guard n >= 0, n < segmentCount else { return nil }
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex && $0.isEngineText }) else { return nil }

        let start = segmentStartSeconds(n)
        let end = start + segmentDurationSeconds(n)
        let hasServer = !sub.serverVttUrl.isEmpty

        // A released source builds no decoders, and a session only releases one whose text tracks
        // all have server WebVTT (demuxerOwesTracks), so the cues come whole from the server.
        if isSourceReleased {
            guard let server = serverCues(streamIndex: streamIndex, deadline: 5) else { return emptySubtitleBody() }
            return serverSubtitleBody(server, from: start, to: end)
        }

        guard let decoder = awaitTextDecoder(streamIndex: streamIndex) else { return emptySubtitleBody() }

        _ = waitUntil(deadline: hasServer ? Self.engineTextWaitSeconds : Self.subtitleSegmentWaitSeconds) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            let anchor = self.sessionAnchorSeconds
            let covered = anchor.map { self.readCoversLocked(through: end + $0) } ?? false
            let dead = self.failed || self.cancelled
            let held = hasServer && self.ridingTierLocked()
            self.stateLock.unlock()
            if dead || decoder.isComplete || held { return true }
            return covered
        }

        stateLock.lock()
        let anchor = sessionAnchorSeconds ?? 0
        let read = demuxedUpTo
        let covered = readCoversLocked(through: end + anchor)
        stateLock.unlock()

        var out = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n"
        if !decoder.isComplete, !covered, hasServer, let server = serverCues(streamIndex: streamIndex, deadline: 1.5) {
            return serverSubtitleBody(server, from: start, to: end)
        }

        if !decoder.isComplete, !covered {
            NSLog("[LocalRemuxer] subtitle segment %d of stream %d served at read head %.1fs, window ends %.1fs",
                  n, streamIndex, read - anchor, end)
        }

        for cue in decoder.cues(from: start + anchor, to: end + anchor) {
            out += "\n" + webVTTTimestamp(cue.start - anchor) + " --> " + webVTTTimestamp(cue.end - anchor) + "\n"
            out += cue.text + "\n"
        }
        return out
    }

    /// The server's cues for one segment window. They are session time as they arrive: Jellyfin
    /// extracts without -copyts, so its cues count from the file's start, as the session does
    /// (measured with its own ffmpeg and command line: a cue at pts 7.0 in a source starting at
    /// 5.0 extracts at 00:00:02).
    func serverSubtitleBody(_ cues: [ServerCue], from start: Double, to end: Double) -> String {
        var out = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n"
        for cue in cues where cue.end > start && cue.start < end {
            out += "\n" + webVTTTimestamp(cue.start) + " --> " + webVTTTimestamp(cue.end) + "\n"
            out += cue.text + "\n"
        }
        return out
    }

    /// The body a rendition with no bytes of its own resolves to: a structurally valid
    /// WebVTT file with no cues at all.
    ///
    /// Step 0 of this feature measured all three ways of making a rendition
    /// silent on a real Apple TV. Cues with a zero-width-space payload draw an
    /// empty caption box; cues pushed off-screen with `line:-200%` get clamped
    /// back into the title-safe area and draw their text. Only a track with no
    /// active cue draws nothing, because AVKit paints a caption background for
    /// any cue that is active. That is exactly the shape an image track needs.
    ///
    /// The X-TIMESTAMP-MAP is required of WebVTT segments by the authoring
    /// specification (req 5.3). Identity mapping, because the engine's own
    /// timeline starts at zero — unlike Jellyfin's WebVTT, which stamps
    /// MPEGTS:900000 and displaced every cue by 10 seconds when a file went
    /// through the server's HLS subtitle path.
    /// The bytes of a text track saved with a download, or nil when it has none on disk.
    func localSubtitleBody(streamIndex: Int) -> Data? {
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex }), !sub.localVtt.isEmpty else { return nil }
        // JS hands over a file:// URI, which contents(atPath:) does not take.
        let path = sub.localVtt.hasPrefix("file://") ? (URL(string: sub.localVtt)?.path ?? sub.localVtt) : sub.localVtt
        return FileManager.default.contents(atPath: path)
    }

    func emptySubtitleBody() -> String {
        "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n"
    }

    /// Display-set manifest for an image subtitle track, or nil if that stream
    /// is not one. Served to the app, which draws the images itself.
    func subtitleCueManifest(streamIndex: Int) -> Data? {
        stateLock.lock()
        let decoder = imageSubtitles[Int32(streamIndex)]
        let server = serverImageSubtitles[Int32(streamIndex)]
        let serverReadUpTo = serverImageReadUpTo[Int32(streamIndex)] ?? 0
        let readUpTo = config.isLive ? demuxedUpToOutput : demuxedUpTo
        let sourceGone = sourceReleased
        stateLock.unlock()
        // The server's copy answers once it holds every cue, or when nothing else will.
        if let server, server.isComplete || decoder == nil || sourceGone {
            return server.manifestJSON(demuxedUpTo: server.isComplete ? config.durationSeconds : serverReadUpTo)
        }
        return decoder?.manifestJSON(demuxedUpTo: readUpTo)
    }

    /// On-disk PNG for an image subtitle cue, addressed by its file name.
    func subtitleImageURL(_ name: String) -> URL? {
        let url = dir.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

}
