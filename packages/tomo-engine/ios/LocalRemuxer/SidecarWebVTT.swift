import Foundation

/// A text sidecar's WebVTT, with ASS override blocks such as `{\fad(120,120)}` taken out of its cue text.
enum SidecarWebVTT {
    static func removingOverrideBlocks(_ data: Data) -> Data {
        guard let body = String(data: data, encoding: .utf8), body.contains("{\\") else { return data }
        return Data(removingOverrideBlocks(body).utf8)
    }

    /// Every block that opens with `{\` is removed. A line left empty would end its cue early, so it goes,
    /// and a cue left with no text goes whole.
    static func removingOverrideBlocks(_ body: String) -> String {
        var out: [String] = []
        var block: [String] = []
        func flush() {
            defer { block.removeAll() }
            guard let timing = block.firstIndex(where: { $0.contains("-->") }) else {
                out.append(contentsOf: block)
                return
            }
            let text = block[(timing + 1)...]
            let kept = text
                .map { $0.replacingOccurrences(of: #"\{\\[^}]*\}"#, with: "", options: .regularExpression) }
                .filter { !isBlank($0) }
            guard !kept.isEmpty || text.isEmpty else { return }
            out.append(contentsOf: block[...timing])
            out.append(contentsOf: kept)
        }
        // Swift reads "\r\n" as one Character, so only Foundation's split finds the lines of a CRLF file.
        for line in body.components(separatedBy: "\n") {
            if isBlank(line) {
                flush()
                out.append(line)
            } else {
                block.append(line)
            }
        }
        flush()
        return out.joined(separator: "\n")
    }

    private static func isBlank(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
