import Foundation

/// Seconds for a WebVTT timestamp, `HH:MM:SS.mmm` or `MM:SS.mmm`; nil for anything else.
func webVTTSeconds(_ text: String) -> Double? {
    let parts = text.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2 || parts.count == 3 else { return nil }
    var total = 0.0
    for (position, part) in parts.enumerated() {
        let last = position == parts.count - 1
        guard let value = Double(part), value >= 0, last || (part.count == 2 && value < 60) else { return nil }
        total = total * 60 + value
    }
    return total
}

/// The same WebVTT with every cue moved by `offsetMs`: positive delays the cues, negative brings
/// them forward. A cue that ends before zero is dropped, a start before zero is clamped to zero.
/// The header, X-TIMESTAMP-MAP, NOTE and STYLE blocks pass through untouched.
func shiftWebVtt(_ text: String, byMs offsetMs: Int) -> String {
    guard offsetMs != 0 else { return text }
    let offset = Double(offsetMs) / 1000
    let blocks = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n")
    var out: [String] = []
    for block in blocks {
        var lines = block.components(separatedBy: "\n")
        guard let timingAt = lines.firstIndex(where: { $0.contains("-->") }) else {
            out.append(block)
            continue
        }
        let timing = lines[timingAt]
        let arrow = timing.range(of: "-->")!
        let startText = String(timing[..<arrow.lowerBound])
        let afterArrow = timing[arrow.upperBound...].trimmingCharacters(in: .whitespaces)
        let endAndSettings = afterArrow.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
        guard let start = webVTTSeconds(startText), let endText = endAndSettings.first, let end = webVTTSeconds(String(endText)) else {
            out.append(block)
            continue
        }
        let shiftedEnd = end + offset
        if shiftedEnd <= 0 { continue }
        let settings = endAndSettings.count > 1 ? " " + endAndSettings[1] : ""
        lines[timingAt] = webVTTTimestamp(max(0, start + offset)) + " --> " + webVTTTimestamp(shiftedEnd) + settings
        out.append(lines.joined(separator: "\n"))
    }
    return out.joined(separator: "\n\n")
}
