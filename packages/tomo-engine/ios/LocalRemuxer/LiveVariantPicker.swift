//
//  LiveVariantPicker.swift
//  TomoTV
//
//  The variant of a multivariant HLS playlist a live read takes: for a frame, the cheapest whose
//  picture is tall enough for a card; for playback, the top variant with every rendition it names,
//  cut out of the master.
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

    /// A multivariant playlist cut to its top video variant with every rendition of its groups, URIs absolute,
    /// the `audioLanguage` rendition the audio default; nil when the text names no video variant.
    static func trimmedMaster(_ master: String, base: String, audioLanguage: String = "") -> String? {
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
        guard let chosen = streams.max(by: { $0.bandwidth < $1.bandwidth }) else { return nil }

        var out = ["#EXTM3U"]
        out += lines.filter { $0.hasPrefix("#EXT-X-VERSION:") || $0 == "#EXT-X-INDEPENDENT-SEGMENTS" }.prefix(2)
        var variant = chosen.attributes
        let media = lines.filter { $0.hasPrefix("#EXT-X-MEDIA:") }.map { String($0.dropFirst("#EXT-X-MEDIA:".count)) }
        let audioGroup = attribute("AUDIO", in: chosen.attributes)
        let audio = media.filter { attribute("TYPE", in: $0) == "AUDIO" && attribute("GROUP-ID", in: $0) == audioGroup }
        let defaultAudio = pickAudio(audio, language: audioLanguage)
        for rendition in media {
            guard let type = attribute("TYPE", in: rendition), ["AUDIO", "SUBTITLES", "CLOSED-CAPTIONS"].contains(type),
                  attribute("GROUP-ID", in: rendition) == attribute(type, in: chosen.attributes) else { continue }
            var line = rendition
            if let uri = attribute("URI", in: rendition) { line = removing("URI", from: line) + ",URI=\"\(resolve(uri))\"" }
            if type == "AUDIO" {
                line = removing("DEFAULT", from: line)
                line = rendition == defaultAudio ? removing("AUTOSELECT", from: line) + ",DEFAULT=YES,AUTOSELECT=YES" : line + ",DEFAULT=NO"
            }
            out.append("#EXT-X-MEDIA:\(line)")
        }
        if audioGroup != nil, audio.isEmpty { variant = removing("AUDIO", from: variant) }
        out.append("#EXT-X-STREAM-INF:\(variant)")
        out.append(resolve(chosen.uri))
        return out.joined(separator: "\n") + "\n"
    }

    /// The key scheme a live channel is refused for: SAMPLE-AES, or a key format other than a plain key
    /// (FairPlay, Widevine, PlayReady). AES-128 with a plain key is not refused. Nil when none is named.
    static func drmKeyFormat(_ playlist: String) -> String? {
        for raw in playlist.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            let tag = line.hasPrefix("#EXT-X-KEY:") ? "#EXT-X-KEY:" : line.hasPrefix("#EXT-X-SESSION-KEY:") ? "#EXT-X-SESSION-KEY:" : nil
            guard let tag else { continue }
            let attributes = String(line.dropFirst(tag.count))
            let method = attribute("METHOD", in: attributes) ?? "NONE"
            let keyFormat = attribute("KEYFORMAT", in: attributes) ?? "identity"
            if method.hasPrefix("SAMPLE-AES") { return keyFormat == "identity" ? method : keyFormat }
            if method != "NONE", keyFormat != "identity" { return keyFormat }
        }
        return nil
    }

    /// The asked language (two- or three-letter code, region ignored), then the group's default, then
    /// the first; a rendition for the blind or the deaf only when nothing else matches.
    static func pickAudio(_ renditions: [String], language: String) -> String? {
        let main = renditions.filter {
            let characteristics = attribute("CHARACTERISTICS", in: $0) ?? ""
            return !characteristics.contains("describes-video") && !characteristics.contains("describes-music-and-sound")
        }
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
