//
//  LiveVariantPicker.swift
//  TomoTV
//
//  The variant of a multivariant HLS playlist a live frame reads: the cheapest whose picture is
//  tall enough for a card. FFmpeg's HLS demuxer given the master reads every variant's segments.
//

import Foundation

enum LiveVariantPicker {
    struct Variant: Equatable {
        let bandwidth: Int
        let height: Int?
        let uri: String
        let hasVideo: Bool
    }

    /// A card is 480px wide; a variant at least this tall covers it without upscaling.
    static let minHeight = 270

    /// The variants a multivariant playlist declares, in order; empty for a media playlist.
    static func variants(in master: String) -> [Variant] {
        var found: [Variant] = []
        let lines = master.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        var index = 0
        while index < lines.count {
            let line = lines[index]
            index += 1
            guard line.hasPrefix("#EXT-X-STREAM-INF:") else { continue }
            let attributes = String(line.dropFirst("#EXT-X-STREAM-INF:".count))
            guard index < lines.count else { break }
            // The URI is the next line that is not a tag or blank.
            while index < lines.count, lines[index].isEmpty || lines[index].hasPrefix("#") { index += 1 }
            guard index < lines.count else { break }
            let uri = lines[index]
            index += 1
            found.append(Variant(bandwidth: attribute("BANDWIDTH", in: attributes).flatMap { Int($0) } ?? 0,
                                 height: attribute("RESOLUTION", in: attributes).flatMap { $0.split(separator: "x").last }.flatMap { Int($0) },
                                 uri: uri,
                                 hasVideo: hasVideoCodec(attribute("CODECS", in: attributes))))
        }
        return found
    }

    /// The variant to read, resolved against `base`; nil when the text is not a multivariant playlist.
    static func pick(_ master: String, base: String) -> String? {
        let candidates = variants(in: master).filter(\.hasVideo)
        guard !candidates.isEmpty else { return nil }
        let tallEnough = candidates.filter { ($0.height ?? Int.max) >= minHeight }
        let pool = tallEnough.isEmpty ? candidates : tallEnough
        // Among the tall enough, the cheapest; when none is, the tallest there is.
        let chosen = tallEnough.isEmpty
            ? pool.max { ($0.height ?? 0, -$0.bandwidth) < ($1.height ?? 0, -$1.bandwidth) }
            : pool.min { $0.bandwidth < $1.bandwidth }
        guard let chosen else { return nil }
        return URL(string: chosen.uri, relativeTo: URL(string: base))?.absoluteString ?? chosen.uri
    }

    /// An attribute's value, unquoted; nil when absent. Quoted values may hold commas.
    static func attribute(_ name: String, in attributes: String) -> String? {
        var rest = Substring(attributes)
        while !rest.isEmpty {
            guard let eq = rest.firstIndex(of: "=") else { return nil }
            let key = rest[..<eq].trimmingCharacters(in: .whitespaces)
            var after = rest[rest.index(after: eq)...]
            let value: Substring
            if after.first == "\"" {
                after = after.dropFirst()
                let close = after.firstIndex(of: "\"") ?? after.endIndex
                value = after[..<close]
                after = close < after.endIndex ? after[after.index(after: close)...] : Substring("")
            } else {
                let comma = after.firstIndex(of: ",") ?? after.endIndex
                value = after[..<comma]
                after = after[comma...]
            }
            if key == name { return String(value) }
            rest = after.first == "," ? after.dropFirst() : after
        }
        return nil
    }

    /// Absent CODECS means the playlist did not say; it is read as video, the common case.
    private static func hasVideoCodec(_ codecs: String?) -> Bool {
        guard let codecs else { return true }
        let video = ["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "mp4v", "dvh1", "dvhe"]
        return codecs.split(separator: ",").contains { entry in video.contains { entry.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix($0) } }
    }
}
