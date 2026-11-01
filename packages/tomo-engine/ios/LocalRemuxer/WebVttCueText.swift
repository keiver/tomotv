import Foundation

/// The <b>, <i> and <u> tags open in one WebVTT cue, closed innermost first and reopened so they nest.
struct WebVttTagStack {
    private var open: [Character] = []

    mutating func set(_ tag: Character, _ on: Bool, into out: inout String) {
        if on { openTag(tag, into: &out) } else { closeTag(tag, into: &out) }
    }

    mutating func openTag(_ tag: Character, into out: inout String) {
        guard !open.contains(tag) else { return }
        out += "<\(tag)>"
        open.append(tag)
    }

    mutating func closeTag(_ tag: Character, into out: inout String) {
        guard let at = open.lastIndex(of: tag) else { return }
        let reopen = Array(open[(at + 1)...])
        for inner in reopen.reversed() { out += "</\(inner)>" }
        out += "</\(tag)>"
        open.removeSubrange(at...)
        for inner in reopen {
            out += "<\(inner)>"
            open.append(inner)
        }
    }

    mutating func closeAll(into out: inout String) {
        for tag in open.reversed() { out += "</\(tag)>" }
        open.removeAll()
    }
}

/// The same WebVTT with the ASS markup left in its cue text rendered: `\b`, `\i` and `\u` overrides become
/// WebVTT tags, drawings and every other `{\...}` block are dropped, `\N` and `\n` break the line and `\h`
/// is a no-break space. A body with none of them, the header, timing lines, NOTE and STYLE blocks pass
/// through untouched.
func cleanWebVttCues(_ text: String) -> String {
    guard text.contains("{\\") || text.contains("\\N") || text.contains("\\n") || text.contains("\\h") else { return text }
    let blocks = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n")
    var out: [String] = []
    for block in blocks {
        let lines = block.components(separatedBy: "\n")
        guard let timingAt = lines.firstIndex(where: { $0.contains("-->") }), timingAt + 1 < lines.count,
              let arrow = lines[timingAt].range(of: "-->"), webVTTSeconds(String(lines[timingAt][..<arrow.lowerBound])) != nil else {
            out.append(block)
            continue
        }
        var payloadEnd = lines.count
        while payloadEnd > timingAt + 1, lines[payloadEnd - 1].isEmpty { payloadEnd -= 1 }
        guard payloadEnd > timingAt + 1 else {
            out.append(block)
            continue
        }
        let rendered = renderAssMarkup(lines[(timingAt + 1) ..< payloadEnd].joined(separator: "\n"))
        out.append((lines[...timingAt] + [rendered] + lines[payloadEnd...]).joined(separator: "\n"))
    }
    return out.joined(separator: "\n\n")
}

private func renderAssMarkup(_ text: String) -> String {
    let characters = Array(text)
    var out = ""
    var tags = WebVttTagStack()
    var drawing = false
    var index = 0
    while index < characters.count {
        let character = characters[index]
        if character == "{", index + 1 < characters.count, characters[index + 1] == "\\",
           let close = characters[index...].firstIndex(of: "}") {
            var resetTo = ""
            for code in AssToWebVTT.overrides(String(characters[(index + 1) ..< close]), resetTo: &resetTo) {
                switch code.tag {
                case "b", "i", "u": tags.set(code.tag, code.on ?? false, into: &out)
                case "p": drawing = code.on ?? false
                case "r": tags.closeAll(into: &out)
                default: break
                }
            }
            index = close + 1
            continue
        }
        if character == "\\", index + 1 < characters.count {
            let escape = characters[index + 1]
            if escape == "N" || escape == "n" {
                if !drawing, !out.isEmpty, out.last != "\n" { out += "\n" }
                index += 2
                continue
            }
            if escape == "h" {
                if !drawing { out += "\u{00A0}" }
                index += 2
                continue
            }
        }
        if !drawing { out.append(character) }
        index += 1
    }
    tags.closeAll(into: &out)
    while let empty = out.range(of: "<([biu])></\\1>", options: .regularExpression) {
        out.removeSubrange(empty)
    }
    return out.trimmingCharacters(in: .whitespacesAndNewlines)
}
