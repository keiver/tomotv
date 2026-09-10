//
//  AssToWebVTT.swift
//  TomoTV
//
//  ASS dialogue to WebVTT cue text. Every text subtitle decoder in FFmpeg emits
//  ASS rects whatever the source format was, so subrip, mov_text, SSA and ASS
//  all arrive here in one shape. WebVTT carries <b>, <i> and <u> and nothing
//  else, the same set libavcodec's own webvtt encoder emits.
//

import Foundation

/// Bold/italic/underline of one ASS style, read from the script header.
private struct AssStyle {
    var bold = false
    var italic = false
    var underline = false
}

/// Converts one track's lines against the style table in its `subtitle_header`.
struct AssToWebVTT {
    private let styles: [String: AssStyle]

    init(header: String?) {
        styles = header.map(Self.parseStyles) ?? [:]
    }

    /// One decoded rect's `ass` payload as WebVTT cue text. The payload is
    /// `ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text`, so the
    /// text is past the eighth comma and may hold commas of its own.
    func cueText(_ dialogue: String) -> String {
        var fields = 0
        var textStart = dialogue.startIndex
        var index = dialogue.startIndex
        while index < dialogue.endIndex, fields < 8 {
            if dialogue[index] == "," {
                fields += 1
                textStart = dialogue.index(after: index)
            }
            index = dialogue.index(after: index)
        }
        let style = fields == 8 ? styleName(dialogue) : ""
        let text = fields == 8 ? String(dialogue[textStart...]) : dialogue
        return render(text, style: styles[style] ?? AssStyle())
    }

    /// Third field of the dialogue line. A leading `*` marks a style the script
    /// did not resolve and is not part of the name: every line of the Alien Nine
    /// SSA sample names `*Default`, and matching it literally found no style at
    /// all, so the whole file lost its bold and italic.
    private func styleName(_ dialogue: String) -> String {
        let parts = dialogue.split(separator: ",", maxSplits: 3, omittingEmptySubsequences: false)
        guard parts.count > 2 else { return "" }
        return String(parts[2].drop { $0 == "*" })
    }

    private func render(_ text: String, style: AssStyle) -> String {
        var out = ""
        // Open tags, innermost last, so they close in reverse.
        var open: [Character] = []

        func openTag(_ tag: Character) {
            guard !open.contains(tag) else { return }
            out += "<\(tag)>"
            open.append(tag)
        }
        func closeTag(_ tag: Character) {
            guard let at = open.lastIndex(of: tag) else { return }
            // Close everything nested inside it, then reopen those.
            let reopen = Array(open[(at + 1)...])
            for inner in reopen.reversed() { out += "</\(inner)>" }
            out += "</\(tag)>"
            open.removeSubrange(at...)
            for inner in reopen {
                out += "<\(inner)>"
                open.append(inner)
            }
        }
        func setTag(_ tag: Character, _ on: Bool) { on ? openTag(tag) : closeTag(tag) }
        func applyStyle() {
            setTag("b", style.bold)
            setTag("i", style.italic)
            setTag("u", style.underline)
        }

        applyStyle()

        // Inside {\p1}...{\p0} the payload is vector drawing coordinates, not words.
        var drawing = false
        let characters = Array(text)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if character == "{" {
                guard let close = characters[index...].firstIndex(of: "}") else {
                    index += 1
                    continue
                }
                for code in overrides(String(characters[(index + 1) ..< close])) {
                    switch code.tag {
                    case "b", "i", "u": setTag(code.tag, code.on)
                    case "p": drawing = code.on
                    case "r":
                        for tag in open.reversed() { out += "</\(tag)>" }
                        open.removeAll()
                        applyStyle()
                    default: break
                    }
                }
                index = close + 1
                continue
            }
            if character == "\\", index + 1 < characters.count {
                let escape = characters[index + 1]
                if escape == "N" || escape == "n" {
                    // A blank line would end the cue, so a run of breaks collapses to one.
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
            if !drawing { out += escaped(character) }
            index += 1
        }

        for tag in open.reversed() { out += "</\(tag)>" }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func escaped(_ character: Character) -> String {
        switch character {
        case "&": return "&amp;"
        case "<": return "&lt;"
        case ">": return "&gt;"
        default: return String(character)
        }
    }

    /// The override codes of one `{...}` block that this converter acts on.
    ///
    /// The digits identify the tag, not just its value: `\pos(960,200)` read as
    /// `\p` put this into drawing mode and swallowed the sign it was
    /// positioning. `\bord`, `\blur`, `\be` and `\iclip` are the same trap.
    private func overrides(_ block: String) -> [(tag: Character, on: Bool)] {
        var found: [(tag: Character, on: Bool)] = []
        let characters = Array(block)
        var index = 0
        while index < characters.count {
            guard characters[index] == "\\", index + 1 < characters.count else {
                index += 1
                continue
            }
            let tag = characters[index + 1]
            var digits = ""
            var cursor = index + 2
            while cursor < characters.count, characters[cursor].isNumber {
                digits.append(characters[cursor])
                cursor += 1
            }
            switch tag {
            case "b", "i", "u", "p":
                // A weight (\b700) is bold, \b0 and \i0 are off.
                guard !digits.isEmpty else { break }
                found.append((tag, (Int(digits) ?? 0) != 0))
            case "r":
                found.append(("r", true))
            default:
                break
            }
            index = max(cursor, index + 2)
        }
        return found
    }

    /// Bold/italic/underline per style name. Column order is whatever the
    /// `[V4+ Styles]` (or `[V4 Styles]`) section's own Format line declares.
    private static func parseStyles(_ header: String) -> [String: AssStyle] {
        var table: [String: AssStyle] = [:]
        var columns: [String] = []
        var inStyles = false

        // isNewline, not "\n": Swift reads CRLF as ONE Character, so splitting a
        // CRLF script on "\n" returns the whole header as a single line and the
        // table comes out empty. Aegisub writes CRLF, which is most of the ASS
        // in the world.
        for raw in header.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") {
                inStyles = line.lowercased().contains("styles")
                columns = []
                continue
            }
            guard inStyles else { continue }
            if line.hasPrefix("Format:") {
                columns = line.dropFirst("Format:".count).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                continue
            }
            guard line.hasPrefix("Style:"), !columns.isEmpty else { continue }
            let values = line.dropFirst("Style:".count).split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            func value(_ name: String) -> String? {
                guard let at = columns.firstIndex(of: name), at < values.count else { return nil }
                return values[at]
            }
            guard let name = value("Name") else { continue }
            // ASS writes -1 for true, 0 for false.
            func flag(_ name: String) -> Bool { (Int(value(name) ?? "0") ?? 0) != 0 }
            table[name] = AssStyle(bold: flag("Bold"), italic: flag("Italic"), underline: flag("Underline"))
        }
        return table
    }
}

/// WebVTT timestamp: `HH:MM:SS.mmm`, the form that holds past an hour.
func webVTTTimestamp(_ seconds: Double) -> String {
    let clamped = max(0, seconds)
    let hours = Int(clamped / 3600)
    let minutes = Int(clamped.truncatingRemainder(dividingBy: 3600) / 60)
    let rest = clamped.truncatingRemainder(dividingBy: 60)
    return String(format: "%02d:%02d:%06.3f", hours, minutes, rest)
}
