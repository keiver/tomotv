//
//  M3uParser.swift
//  TomoTV
//
//  Streaming M3U playlist parser: bytes in any chunking, entries out as each URL line lands.
//  Conventions from Kodi pvr.iptvsimple and iptv-org: quoted attributes may hold commas, the name
//  follows the first comma outside quotes, #EXTGRP holds until an empty one, headers ride
//  #EXTVLCOPT or `url|`. Invalid UTF-8 is replaced, never fatal.
//

import Foundation

struct M3uCatchup: Equatable {
    var type: String?
    var source: String?
    var days: Int?
}

struct M3uHeader: Equatable {
    /// Guide URLs from x-tvg-url / url-tvg, split on commas.
    var tvgUrls: [String] = []
    var tvgShift: Double?
    var catchup: M3uCatchup?
    var attrs: [String: String] = [:]
}

struct M3uEntry: Equatable {
    var name: String
    var url: String
    /// The URL line as written, `|headers` included: what Jellyfin hashes into the channel id.
    var line: String
    /// False when no #EXTINF preceded the URL; Jellyfin drops such lines.
    var hasExtInf: Bool
    var tvgId: String?
    var tvgName: String?
    var tvgLogo: String?
    var tvgChno: String?
    var groups: [String] = []
    var tvgShift: Double?
    var radio = false
    var catchup: M3uCatchup?
    /// HTTP headers the stream needs, lower-case names (user-agent, referer, ...).
    var headers: [String: String] = [:]
    var kodiProps: [String: String] = [:]
    /// A DRM property (inputstream.adaptive license or drm) is set: AVPlayer cannot play it.
    var drm = false
    var attrs: [String: String] = [:]
}

final class M3uParser: StreamSink {
    var onHeader: ((M3uHeader) -> Void)?
    var onEntry: ((M3uEntry) -> Void)?
    private(set) var count = 0

    private var carry: [UInt8] = []
    private var headerSeen = false
    private var header = M3uHeader()
    private var pending: (attrs: [String: String], name: String)?
    private var vlcHeaders: [String: String] = [:]
    private var kodiProps: [String: String] = [:]
    private var extgrp: [String] = []

    func push(_ bytes: UnsafeRawBufferPointer) {
        guard bytes.count > 0 else { return }
        var start = 0
        for index in 0 ..< bytes.count where bytes[index] == 0x0A {
            if carry.isEmpty {
                line(UnsafeRawBufferPointer(rebasing: bytes[start ..< index]))
            } else {
                carry.append(contentsOf: bytes[start ..< index])
                carry.withUnsafeBytes { line($0) }
                carry.removeAll(keepingCapacity: true)
            }
            start = index + 1
        }
        if start < bytes.count { carry.append(contentsOf: bytes[start...]) }
    }

    func finish() {
        if !carry.isEmpty {
            carry.withUnsafeBytes { line($0) }
            carry.removeAll()
        }
        if !headerSeen { emitHeader() }
    }

    private func emitHeader() {
        headerSeen = true
        onHeader?(header)
    }

    private func line(_ raw: UnsafeRawBufferPointer) {
        var bytes = raw
        if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF { bytes = UnsafeRawBufferPointer(rebasing: bytes[3...]) }
        let text = String(decoding: bytes, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard text.hasPrefix("#") else {
            url(text)
            return
        }
        if hasPrefix(text, "#EXTINF:") {
            if !headerSeen { emitHeader() }
            // The duration token precedes the attributes: `#EXTINF:-1 key="v",Name`.
            var afterDuration = text.index(text.startIndex, offsetBy: 8)
            while afterDuration < text.endIndex, text[afterDuration] != " ", text[afterDuration] != "," { afterDuration = text.index(after: afterDuration) }
            pending = Self.parseAttributes(text, from: afterDuration)
        } else if hasPrefix(text, "#EXTM3U") {
            let attrs = Self.parseAttributes(text, from: text.index(text.startIndex, offsetBy: 7)).attrs
            header.attrs = attrs
            header.tvgUrls = (attrs["x-tvg-url"] ?? attrs["url-tvg"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            header.tvgShift = Self.number(attrs["tvg-shift"])
            header.catchup = Self.catchup(attrs)
        } else if hasPrefix(text, "#EXTGRP:") {
            extgrp = Self.groups(String(text.dropFirst(8)))
        } else if hasPrefix(text, "#EXTVLCOPT") {
            guard let colon = text.firstIndex(of: ":") else { return }
            let body = text[text.index(after: colon)...]
            guard let eq = body.firstIndex(of: "="), eq > body.startIndex else { return }
            let key = body[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            let value = body[body.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if key == "http-user-agent" { vlcHeaders["user-agent"] = value } else if key == "http-referrer" || key == "http-referer" { vlcHeaders["referer"] = value }
        } else if hasPrefix(text, "#KODIPROP:") {
            let body = text.dropFirst(10)
            guard let eq = body.firstIndex(of: "="), eq > body.startIndex else { return }
            kodiProps[body[..<eq].trimmingCharacters(in: .whitespaces)] = body[body.index(after: eq)...].trimmingCharacters(in: .whitespaces)
        }
    }

    private func url(_ raw: String) {
        let (url, pipeHeaders) = Self.splitPipeHeaders(raw)
        let attrs = pending?.attrs ?? [:]
        var headers = vlcHeaders
        for (name, value) in pipeHeaders { headers[name] = value }
        if let agent = attrs["http-user-agent"], headers["user-agent"] == nil { headers["user-agent"] = agent }
        if let referer = attrs["http-referrer"], headers["referer"] == nil { headers["referer"] = referer }
        let name = pending?.name ?? ""
        let entry = M3uEntry(
            name: name.isEmpty ? (attrs["tvg-name"].flatMap { $0.isEmpty ? nil : $0 } ?? url) : name,
            url: url,
            line: raw,
            hasExtInf: pending != nil,
            tvgId: Self.value(attrs["tvg-id"]),
            tvgName: Self.value(attrs["tvg-name"]),
            tvgLogo: Self.value(attrs["tvg-logo"]),
            tvgChno: Self.value(attrs["tvg-chno"]) ?? Self.value(attrs["ch-number"]),
            groups: attrs["group-title"].map(Self.groups) ?? extgrp,
            tvgShift: Self.number(attrs["tvg-shift"]),
            radio: attrs["radio"]?.lowercased() == "true",
            catchup: Self.catchup(attrs),
            headers: headers,
            kodiProps: kodiProps,
            drm: kodiProps.keys.contains { $0.hasPrefix("inputstream.adaptive.license") || $0.hasPrefix("inputstream.adaptive.drm") },
            attrs: attrs
        )
        pending = nil
        vlcHeaders = [:]
        kodiProps = [:]
        count += 1
        onEntry?(entry)
    }

    // MARK: Helpers

    private func hasPrefix(_ text: String, _ prefix: String) -> Bool {
        text.utf8.count >= prefix.utf8.count && text.prefix(prefix.count).caseInsensitiveCompare(prefix) == .orderedSame
    }

    /// `key="value"` and `key=value` pairs up to the first comma outside quotes; the rest is the name.
    static func parseAttributes(_ line: String, from start: String.Index) -> (attrs: [String: String], name: String) {
        var attrs: [String: String] = [:]
        var i = start
        let end = line.endIndex
        while i < end {
            let ch = line[i]
            if ch == " " || ch == "\t" {
                i = line.index(after: i)
                continue
            }
            if ch == "," { return (attrs, line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)) }
            var keyEnd = i
            while keyEnd < end, line[keyEnd] != "=", line[keyEnd] != " ", line[keyEnd] != "\t", line[keyEnd] != "," { keyEnd = line.index(after: keyEnd) }
            let key = line[i ..< keyEnd].lowercased()
            if keyEnd == end || line[keyEnd] != "=" {
                if !key.isEmpty { attrs[key] = "" }
                i = keyEnd
                continue
            }
            var valueStart = line.index(after: keyEnd)
            let value: String
            if valueStart < end, line[valueStart] == "\"" {
                valueStart = line.index(after: valueStart)
                if let close = line[valueStart...].firstIndex(of: "\"") {
                    value = String(line[valueStart ..< close])
                    i = line.index(after: close)
                } else {
                    value = String(line[valueStart...])
                    i = end
                }
            } else {
                var valueEnd = valueStart
                while valueEnd < end, line[valueEnd] != " ", line[valueEnd] != "\t", line[valueEnd] != "," { valueEnd = line.index(after: valueEnd) }
                value = String(line[valueStart ..< valueEnd])
                i = valueEnd
            }
            if !key.isEmpty { attrs[key] = value }
        }
        return (attrs, "")
    }

    /// `url|User-Agent=x&Referer=y`: headers after the pipe, values URL-encoded, `!` marks a non-standard name.
    static func splitPipeHeaders(_ raw: String) -> (String, [String: String]) {
        guard let pipe = raw.firstIndex(of: "|") else { return (raw, [:]) }
        var headers: [String: String] = [:]
        for pair in raw[raw.index(after: pipe)...].split(separator: "&", omittingEmptySubsequences: true) {
            guard let eq = pair.firstIndex(of: "="), eq > pair.startIndex else { continue }
            var name = pair[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            if name.hasPrefix("!") { name.removeFirst() }
            if name == "referrer" { name = "referer" }
            let encoded = String(pair[pair.index(after: eq)...])
            // A bare % in a header value stays as written.
            if !name.isEmpty { headers[name] = encoded.removingPercentEncoding ?? encoded }
        }
        return (String(raw[..<pipe]), headers)
    }

    static func groups(_ value: String) -> [String] {
        value.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private static func value(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        return raw
    }

    private static func number(_ raw: String?) -> Double? {
        guard let raw, !raw.isEmpty, let value = Double(raw), value.isFinite else { return nil }
        return value
    }

    private static func catchup(_ attrs: [String: String]) -> M3uCatchup? {
        let type = value(attrs["catchup"]) ?? value(attrs["catchup-type"]) ?? (value(attrs["timeshift"]) != nil ? "shift" : nil)
        let source = value(attrs["catchup-source"])
        let days = (value(attrs["catchup-days"]) ?? value(attrs["timeshift"]) ?? value(attrs["tvg-rec"])).flatMap(Double.init).flatMap { abs($0) < 100_000 ? Int($0) : nil }
        guard type != nil || source != nil || (days ?? 0) > 0 else { return nil }
        return M3uCatchup(type: type, source: source, days: (days ?? 0) > 0 ? days : nil)
    }
}
