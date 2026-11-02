import Accelerate
import Foundation

/// The shift that lines a track's cues up with the speech, and how clearly it stood out.
struct SubtitleAlignment: Equatable {
    /// Added to every cue time: positive delays the cues.
    let offsetMs: Int
    /// The best shift's score in standard deviations above the mean score of all shifts tried.
    let confidence: Double
}

/// Every cue's start and end in a WebVTT body, in seconds, in file order.
func webVTTCueSpans(_ text: String) -> [(start: Double, end: Double)] {
    var spans: [(start: Double, end: Double)] = []
    for line in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
        guard let arrow = line.range(of: "-->") else { continue }
        let endText = line[arrow.upperBound...].trimmingCharacters(in: .whitespaces).split(separator: " ", maxSplits: 1).first.map(String.init) ?? ""
        guard let start = webVTTSeconds(String(line[..<arrow.lowerBound])), let end = webVTTSeconds(endText), end > start else { continue }
        spans.append((start, end))
    }
    return spans
}

/// Scores every shift of the cues against the speech timeline, the way ffsubsync does: a speech frame
/// under a cue counts +1, a speech frame under no cue -1, and the shift with the highest score wins.
/// `speech` starts at `windowStart` in `frameMs` steps; `cues` are in file time, and only frames inside
/// `coverage` are judged (a track whose cues are known only for part of the window). Nil when no shift
/// stands out: too little speech, too few cues, or a best score below `minConfidence` deviations.
func alignCues(
    speech: [Bool],
    cues: [(start: Double, end: Double)],
    windowStart: Double,
    coverage: ClosedRange<Double>,
    frameMs: Int = 10,
    maxOffsetSeconds: Double = 60,
    minConfidence: Double = 6
) -> SubtitleAlignment? {
    let frameSeconds = Double(frameMs) / 1000
    let count = speech.count
    let reach = Int(maxOffsetSeconds / frameSeconds)
    guard count >= Int(10 / frameSeconds), reach > 0 else { return nil }
    let speechFrames = speech.reduce(0) { $0 + ($1 ? 1 : 0) }
    guard speechFrames >= count / 20, speechFrames <= count * 19 / 20 else { return nil }

    // The cue timeline over the window widened by the reach on both sides, so every shift has frames to meet.
    let paddedStart = windowStart - Double(reach) * frameSeconds
    var cueLine = [Float](repeating: 0, count: count + 2 * reach)
    for index in cueLine.indices {
        let time = paddedStart + Double(index) * frameSeconds
        if coverage.contains(time) { cueLine[index] = -1 }
    }
    var cueFrames = 0
    for cue in cues {
        let first = max(0, Int(((cue.start - paddedStart) / frameSeconds).rounded(.up)))
        let last = min(cueLine.count - 1, Int(((cue.end - paddedStart) / frameSeconds).rounded(.down)))
        guard first <= last else { continue }
        for index in first...last where cueLine[index] != 0 {
            if cueLine[index] < 0 { cueFrames += 1 }
            cueLine[index] = 1
        }
    }
    guard cueFrames >= count / 50 else { return nil }

    let audioLine = speech.map { $0 ? Float(1) : Float(0) }
    var scores = [Float](repeating: 0, count: 2 * reach + 1)
    cueLine.withUnsafeBufferPointer { cuePointer in
        audioLine.withUnsafeBufferPointer { audioPointer in
            scores.withUnsafeMutableBufferPointer { scorePointer in
                vDSP_conv(cuePointer.baseAddress!, 1, audioPointer.baseAddress!, 1, scorePointer.baseAddress!, 1, vDSP_Length(scorePointer.count), vDSP_Length(count))
            }
        }
    }

    var mean: Float = 0
    var deviation: Float = 0
    vDSP_normalize(scores, 1, nil, 1, &mean, &deviation, vDSP_Length(scores.count))
    guard deviation > 0 else { return nil }
    var peak: Float = 0
    var peakIndex: vDSP_Length = 0
    vDSP_maxvi(scores, 1, &peak, &peakIndex, vDSP_Length(scores.count))
    let confidence = Double((peak - mean) / deviation)
    guard peak > 0, confidence >= minConfidence else { return nil }
    // Score index i tried the cues shifted by i - reach frames: cues that late need moving back by as much.
    let lagFrames = Int(peakIndex) - reach
    return SubtitleAlignment(offsetMs: -lagFrames * frameMs, confidence: confidence)
}

/// Several windows' answers taken together: one at `single` deviations or more stands alone; otherwise
/// the most answers at `agree` or more that lie within `toleranceMs` of each other, at least two, give
/// their middle offset. Nil when neither holds.
func agreedAlignment(_ found: [SubtitleAlignment], single: Double = 6, agree: Double = 3, toleranceMs: Int = 300) -> SubtitleAlignment? {
    if let strongest = found.max(by: { $0.confidence < $1.confidence }), strongest.confidence >= single { return strongest }
    let candidates = found.filter { $0.confidence >= agree }
    var best: [SubtitleAlignment] = []
    for candidate in candidates {
        let group = candidates.filter { abs($0.offsetMs - candidate.offsetMs) <= toleranceMs }
        let weight = group.reduce(0) { $0 + $1.confidence }
        if group.count > best.count || (group.count == best.count && weight > best.reduce(0) { $0 + $1.confidence }) { best = group }
    }
    guard best.count >= 2 else { return nil }
    let offsets = best.map(\.offsetMs).sorted()
    return SubtitleAlignment(offsetMs: offsets[offsets.count / 2], confidence: best.map(\.confidence).max() ?? 0)
}
