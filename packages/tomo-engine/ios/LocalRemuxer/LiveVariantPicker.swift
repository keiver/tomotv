//
//  LiveVariantPicker.swift
//  TomoTV
//
//  The variant of a multivariant HLS playlist a live read takes: for a frame, the cheapest whose
//  picture is tall enough for a card; for playback, one variant and one audio rendition, cut out
//  of the master. FFmpeg's HLS demuxer given the master reads every variant's segments.
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

    /// A multivariant playlist cut to one video variant and one audio rendition of its group, URIs
    /// absolute, subtitle groups dropped; nil when the text names no video variant. Opening this
    /// instead of the master spares the demuxer every other variant's playlist and first segment.
    static func trimmedMaster(_ master: String, base: String, audioLanguage: String = "", maxBandwidth: Int = 0) -> String? {
        let lines = master.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        let resolve = { (uri: String) in URL(string: uri, relativeTo: URL(string: base))?.absoluteString ?? uri }
        var streams: [(attributes: String, uri: String, bandwidth: Int)] = []
        var index = 0
        while index < lines.count {
            let line = lines[index]
            index += 1
            guard line.hasPrefix("#EXT-X-STREAM-INF:") else { continue }
            let attributes = String(line.dropFirst("#EXT-X-STREAM-INF:".count))
            while index < lines.count, lines[index].isEmpty || lines[index].hasPrefix("#") { index += 1 }
            guard index < lines.count else { break }
            if hasVideoCodec(attribute("CODECS", in: attributes)) {
                streams.append((attributes, lines[index], attribute("BANDWIDTH", in: attributes).flatMap { Int($0) } ?? 0))
            }
            index += 1
        }
        guard !streams.isEmpty else { return nil }
        let fitting = maxBandwidth > 0 ? streams.filter { $0.bandwidth <= maxBandwidth } : streams
        let chosen = fitting.isEmpty
            ? streams.min { $0.bandwidth < $1.bandwidth }!
            : fitting.max { $0.bandwidth < $1.bandwidth }!

        var out = ["#EXTM3U"]
        out += lines.filter { $0.hasPrefix("#EXT-X-VERSION:") || $0 == "#EXT-X-INDEPENDENT-SEGMENTS" }.prefix(2)
        var variant = removing("SUBTITLES", from: chosen.attributes)
        if let group = attribute("AUDIO", in: chosen.attributes) {
            let renditions = lines.filter { $0.hasPrefix("#EXT-X-MEDIA:") }.map { String($0.dropFirst("#EXT-X-MEDIA:".count)) }
                .filter { attribute("TYPE", in: $0) == "AUDIO" && attribute("GROUP-ID", in: $0) == group }
            if let picked = pickAudio(renditions, language: audioLanguage) {
                var media = removing("DEFAULT", from: removing("AUTOSELECT", from: picked))
                if let uri = attribute("URI", in: picked) { media = removing("URI", from: media) + ",URI=\"\(resolve(uri))\"" }
                out.append("#EXT-X-MEDIA:\(media),DEFAULT=YES,AUTOSELECT=YES")
            } else {
                variant = removing("AUDIO", from: variant)
            }
        }
        out.append("#EXT-X-STREAM-INF:\(variant)")
        out.append(resolve(chosen.uri))
        return out.joined(separator: "\n") + "\n"
    }

    /// The asked language (two- or three-letter code, region ignored), then the group's default, then
    /// the first; a rendition that describes the video for the blind only when nothing else matches.
    static func pickAudio(_ renditions: [String], language: String) -> String? {
        let main = renditions.filter { !(attribute("CHARACTERISTICS", in: $0) ?? "").contains("describes-video") }
        let pool = main.isEmpty ? renditions : main
        let isDefault = { (r: String) in attribute("DEFAULT", in: r) == "YES" }
        let wanted = baseLanguage(language)
        let matching = wanted.isEmpty ? [] : pool.filter { baseLanguage(attribute("LANGUAGE", in: $0) ?? "") == wanted }
        return matching.first(where: isDefault) ?? matching.first ?? pool.first(where: isDefault) ?? pool.first
    }

    static func baseLanguage(_ tag: String) -> String {
        let code = tag.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map { String($0).lowercased() } ?? ""
        guard !code.isEmpty else { return "" }
        return Locale.LanguageCode(code).identifier(.alpha2) ?? code
    }

    /// The attribute list without `name`, quoted values intact.
    static func removing(_ name: String, from attributes: String) -> String {
        var kept: [String] = []
        var rest = Substring(attributes)
        while !rest.isEmpty {
            var end = rest.startIndex
            var quoted = false
            while end < rest.endIndex, quoted || rest[end] != "," {
                if rest[end] == "\"" { quoted.toggle() }
                end = rest.index(after: end)
            }
            let pair = rest[..<end]
            if pair.split(separator: "=", maxSplits: 1).first.map({ $0.trimmingCharacters(in: .whitespaces) }) != name { kept.append(String(pair)) }
            rest = end < rest.endIndex ? rest[rest.index(after: end)...] : ""
        }
        return kept.joined(separator: ",")
    }

    /// Absent CODECS means the playlist did not say; it is read as video, the common case.
    private static func hasVideoCodec(_ codecs: String?) -> Bool {
        guard let codecs else { return true }
        let video = ["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "mp4v", "dvh1", "dvhe"]
        return codecs.split(separator: ",").contains { entry in video.contains { entry.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix($0) } }
    }
}
