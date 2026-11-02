import Foundation

/// Speech or not for every `frameMs` of 16-bit mono audio. A frame counts as speech when its level
/// stands clear above the quiet floor of the window; gaps inside speech up to 150 ms are bridged
/// and bursts under 50 ms are dropped. The same samples always give the same answer.
func speechTimeline(samples: [Int16], sampleRate: Int, frameMs: Int = 10) -> [Bool] {
    let frameLength = max(1, sampleRate * frameMs / 1000)
    let frames = samples.count / frameLength
    guard frames > 0 else { return [] }
    var levels = [Float](repeating: 0, count: frames)
    for frame in 0..<frames {
        var energy = 0.0
        let base = frame * frameLength
        for offset in 0..<frameLength {
            let sample = Double(samples[base + offset])
            energy += sample * sample
        }
        levels[frame] = Float(10 * log10(energy / Double(frameLength) + 1))
    }
    return speechTimeline(levels: levels, frameMs: frameMs)
}

/// The same judgement over levels already measured per `frameMs`; a NaN level (audio never decoded) is not speech.
func speechTimeline(levels: [Float], frameMs: Int = 10) -> [Bool] {
    let frames = levels.count
    let sorted = levels.filter { !$0.isNaN }.sorted()
    guard !sorted.isEmpty else { return [Bool](repeating: false, count: frames) }
    let floor = sorted[Int(Double(sorted.count - 1) * 0.2)]
    let loud = sorted[Int(Double(sorted.count - 1) * 0.95)]
    // Nothing stands out of the floor: silence, or a level that never changes.
    guard loud - floor >= 6 else { return [Bool](repeating: false, count: frames) }
    let threshold = floor + max(6, (loud - floor) * 0.35)
    var speech = levels.map { $0 > threshold }
    bridgeGaps(&speech, upTo: 150 / frameMs)
    dropBursts(&speech, shorterThan: 50 / frameMs)
    return speech
}

/// Runs of `false` no longer than `limit` between two `true` runs become `true`.
private func bridgeGaps(_ timeline: inout [Bool], upTo limit: Int) {
    var index = 0
    while index < timeline.count {
        guard !timeline[index] else {
            index += 1
            continue
        }
        var end = index
        while end < timeline.count, !timeline[end] { end += 1 }
        if index > 0, end < timeline.count, end - index <= limit {
            for gap in index..<end { timeline[gap] = true }
        }
        index = end
    }
}

/// Runs of `true` shorter than `minimum` become `false`.
private func dropBursts(_ timeline: inout [Bool], shorterThan minimum: Int) {
    var index = 0
    while index < timeline.count {
        guard timeline[index] else {
            index += 1
            continue
        }
        var end = index
        while end < timeline.count, timeline[end] { end += 1 }
        if end - index < minimum {
            for burst in index..<end { timeline[burst] = false }
        }
        index = end
    }
}
