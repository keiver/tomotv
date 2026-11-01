import Foundation

/// What lining a track up with the audio came to.
enum SubtitleAlignOutcome: Equatable {
    case aligned(offsetMs: Int, confidence: Double)
    /// `noTrack`, `noCues`, `noAudio`, `noSpeech`, `noMatch` or `window`.
    case failed(String)
}

extension RemuxSession {
    /// Where each attempt's window sits, in seconds from the playhead.
    static let alignWindowShifts: [Double] = [0, 240, -240]
    static let alignHalfWindowSeconds = 90.0

    /// Lines the track's cues up with the speech in the audio of a three-minute window: attempt 0
    /// around the playhead, later attempts further along the file. The offset answered is the
    /// track's whole correction, measured against the cues as the file has them.
    func alignSubtitleTiming(streamIndex: Int, attempt: Int) -> SubtitleAlignOutcome {
        let half = Self.alignHalfWindowSeconds
        stateLock.lock()
        let playhead = segmentStartSeconds(lastRequestedSegment)
        stateLock.unlock()
        let duration = durationSeconds
        let shift = Self.alignWindowShifts[min(max(attempt, 0), Self.alignWindowShifts.count - 1)]
        let centre = duration > 2 * half ? min(max(playhead + shift, half), duration - half) : max(playhead + shift, half)
        let start = max(0, centre - half)
        let end = duration > 0 ? min(duration, centre + half) : centre + half
        guard end - start >= 30 else { return .failed("window") }

        guard let cues = cueSpans(streamIndex: streamIndex, from: start - 60, to: end + 60) else { return .failed("noTrack") }
        guard !cues.isEmpty else { return .failed("noCues") }
        guard let audio = readAudioWindow(inputUrl: config.inputUrl, headers: config.httpHeaders, audioStreamIndex: config.audioTracks.first?.index, from: start, to: end) else {
            return .failed("noAudio")
        }
        let speech = speechTimeline(samples: audio.samples, sampleRate: audio.sampleRate)
        guard speech.contains(true) else { return .failed("noSpeech") }
        guard let found = alignCues(speech: speech, cues: cues, windowStart: audio.startSeconds, coverage: (start - 60)...(end + 60)) else { return .failed("noMatch") }
        NSLog("[SubtitleAligner] stream %ld attempt %ld window %.0f-%.0fs: offset %ld ms, confidence %.1f", streamIndex, attempt, start, end, found.offsetMs, found.confidence)
        return .aligned(offsetMs: found.offsetMs, confidence: found.confidence)
    }

    /// The track's cues as the file has them, no offset, overlapping [from, to]: a device copy or a
    /// sidecar from its WebVTT, a track of the file from its decoder. Nil when the track is unknown.
    func cueSpans(streamIndex: Int, from: Double, to: Double) -> [(start: Double, end: Double)]? {
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex }) else { return nil }
        if !sub.localVtt.isEmpty || !sub.vttUrl.isEmpty {
            guard let body = rawSubtitleBody(streamIndex: streamIndex) else { return nil }
            return webVTTCueSpans(String(decoding: body, as: UTF8.self)).filter { $0.end > from && $0.start < to }
        }
        guard let decoder = awaitTextDecoder(streamIndex: streamIndex) else { return nil }
        return decoder.cues(from: from, to: to).map { (start: $0.start, end: $0.end) }
    }
}
