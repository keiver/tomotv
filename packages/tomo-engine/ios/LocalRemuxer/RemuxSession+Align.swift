import Foundation

/// What lining a track up with the audio came to.
enum SubtitleAlignOutcome: Equatable {
    case aligned(offsetMs: Int, confidence: Double)
    /// `noTrack`, `noCues`, `noAudio`, `noSpeech`, `noMatch`, `notRead` or `window`.
    case failed(String)
}

/// One attempt's audio window and the stretch its cues are known for, in source seconds.
struct AlignWindow: Equatable {
    let start: Double
    let end: Double
    let coverage: ClosedRange<Double>
}

extension RemuxSession {
    /// Where each attempt's window sits, in seconds from the playhead. A track whose cues are all
    /// known looks further along the file; an embedded track knows only what the read loop has
    /// passed, so its later attempts look back.
    static let alignWindowShifts: [Double] = [0, 240, -240]
    static let alignReadWindowShifts: [Double] = [0, -240]
    static let alignHalfWindowSeconds = 90.0
    /// Cues are read this far either side of the window, so every shift tried has cues to meet.
    static let alignReachSeconds = 60.0

    /// The window an attempt reads, `half` either side of `centre` inside the file, cut to `known`
    /// (the stretch an embedded track's cues are known for) when given. Nil when under 30 s is left.
    static func alignWindow(centre wanted: Double, half: Double, fileStart: Double, duration: Double, known: ClosedRange<Double>?) -> AlignWindow? {
        let fileEnd = fileStart + duration
        let centre = duration > 2 * half ? min(max(wanted, fileStart + half), fileEnd - half) : max(wanted, fileStart + half)
        var start = max(fileStart, centre - half)
        var end = duration > 0 ? min(fileEnd, centre + half) : centre + half
        var coverage = (start - alignReachSeconds)...(end + alignReachSeconds)
        if let known {
            start = max(start, known.lowerBound)
            end = min(end, known.upperBound)
            guard end > start else { return nil }
            coverage = max(coverage.lowerBound, known.lowerBound)...min(coverage.upperBound, known.upperBound)
        }
        guard end - start >= 30 else { return nil }
        return AlignWindow(start: start, end: end, coverage: coverage)
    }

    /// Lines the track's cues up with the speech in the audio of a window of up to three minutes:
    /// attempt 0 around the playhead, later attempts elsewhere in the file. The offset answered is the
    /// track's whole correction, measured against the cues as the file has them.
    func alignSubtitleTiming(streamIndex: Int, attempt: Int) -> SubtitleAlignOutcome {
        let outcome = alignOutcome(streamIndex: streamIndex, attempt: attempt)
        if case let .failed(reason) = outcome {
            NSLog("[SubtitleAligner] stream %ld attempt %ld: %@", streamIndex, attempt, reason)
        }
        return outcome
    }

    private func alignOutcome(streamIndex: Int, attempt: Int) -> SubtitleAlignOutcome {
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex }) else { return .failed("noTrack") }
        let embedded = sub.localVtt.isEmpty && sub.vttUrl.isEmpty
        stateLock.lock()
        // Segment times count from the session anchor; cues, audio and read spans are in source time.
        let anchor = sessionAnchorSeconds ?? 0
        let playhead = segmentStartSeconds(lastRequestedSegment) + anchor
        let known = embedded ? readSpanLocked(containing: playhead) : nil
        stateLock.unlock()
        if embedded && known == nil { return .failed("notRead") }

        let shifts = embedded ? Self.alignReadWindowShifts : Self.alignWindowShifts
        let shift = shifts[min(max(attempt, 0), shifts.count - 1)]
        guard let window = Self.alignWindow(centre: playhead + shift, half: Self.alignHalfWindowSeconds, fileStart: anchor, duration: durationSeconds, known: known) else {
            return .failed("window")
        }

        guard let cues = cueSpans(streamIndex: streamIndex, from: window.coverage.lowerBound, to: window.coverage.upperBound) else { return .failed("noTrack") }
        guard !cues.isEmpty else { return .failed("noCues") }
        guard let audio = readAudioWindow(inputUrl: config.inputUrl, headers: config.httpHeaders, audioStreamIndex: config.audioTracks.first?.index, from: window.start, to: window.end) else {
            return .failed("noAudio")
        }
        let speech = speechTimeline(samples: audio.samples, sampleRate: audio.sampleRate)
        guard speech.contains(true) else { return .failed("noSpeech") }
        guard let found = alignCues(speech: speech, cues: cues, windowStart: audio.startSeconds, coverage: window.coverage) else { return .failed("noMatch") }
        NSLog("[SubtitleAligner] stream %ld attempt %ld window %.0f-%.0fs: offset %ld ms, confidence %.1f", streamIndex, attempt, window.start, window.end, found.offsetMs, found.confidence)
        return .aligned(offsetMs: found.offsetMs, confidence: found.confidence)
    }

    /// The stretch of source time the read loop has passed without a break that holds `time`, the
    /// only part of an embedded track whose cues are known. Caller holds stateLock.
    func readSpanLocked(containing time: Double) -> ClosedRange<Double>? {
        var spans = readSpans
        if let from = readSpanFrom { spans.append((from: from, upTo: readSpanUpTo)) }
        var merged: [(from: Double, upTo: Double)] = []
        for span in spans.sorted(by: { $0.from < $1.from }) {
            if let last = merged.last, span.from <= last.upTo {
                merged[merged.count - 1].upTo = max(last.upTo, span.upTo)
            } else {
                merged.append(span)
            }
        }
        return merged.first { $0.from <= time && time <= $0.upTo }.map { $0.from...$0.upTo }
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
