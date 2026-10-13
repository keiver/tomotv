//
//  TunerGroups.swift
//  TomoTV
//
//  The `group-title` groups of a Jellyfin M3U tuner, mapped to the channel ids the server gave the
//  entries. Jellyfin drops the groups, so the device reads the playlist itself.
//

import Foundation
import TomoLiveSources

struct TunerGroup: Equatable {
    var name: String
    /// Channel item ids in playlist order.
    var channelIds: [String]
}

/// A tuner channel's guide identity: the server's item id and the playlist's tvg-id and tvg-name.
struct TunerChannel: Equatable {
    var id: String
    var tvgId: String?
    var tvgName: String?
}

/// Everything the device needs to list and tune a tuner channel without the server's item.
struct TunerRow: Equatable {
    var id: String
    var name: String
    var number: String?
    var logo: String?
    /// The stream URL, pipe headers stripped.
    var url: String
    var headers: [String: String]
    var groups: [String]
    var tvgId: String?
    var tvgName: String?
    var radio: Bool
    var drm: Bool
}

enum TunerGroups {
    /// Schemes Jellyfin accepts for a channel (M3uParser.cs IsValidChannelUrl); other lines never become channels.
    private static let schemes: Set<String> = ["http", "https", "rtsp", "rtp", "udp"]

    /// Whether Jellyfin creates a channel for the entry: an #EXTINF before it and an accepted scheme.
    static func isJellyfinChannel(_ entry: M3uEntry) -> Bool {
        guard entry.hasExtInf, let colon = entry.line.range(of: "://") else { return false }
        return schemes.contains(entry.line[..<colon.lowerBound].lowercased())
    }

    /// Groups in order of first appearance; an entry in several groups lands in each.
    static func groups(entries: [M3uEntry], tunerUrl: String) -> [TunerGroup] {
        let tunerHash = JellyfinChannelId.md5Guid(tunerUrl)
        var order: [String] = []
        var ids: [String: [String]] = [:]
        for entry in entries where isJellyfinChannel(entry) && !entry.groups.isEmpty {
            let id = JellyfinChannelId.forM3u(tunerHash: tunerHash, streamUrl: entry.line)
            for group in entry.groups {
                if ids[group] == nil { order.append(group) }
                ids[group, default: []].append(id)
            }
        }
        return order.map { TunerGroup(name: $0, channelIds: ids[$0] ?? []) }
    }

    /// Each Jellyfin channel that carries a tvg-id or tvg-name, in playlist order: the keys an XMLTV guide matches on.
    static func channels(entries: [M3uEntry], tunerUrl: String) -> [TunerChannel] {
        let tunerHash = JellyfinChannelId.md5Guid(tunerUrl)
        return entries.compactMap { entry in
            guard isJellyfinChannel(entry), entry.tvgId != nil || entry.tvgName != nil else { return nil }
            return TunerChannel(id: JellyfinChannelId.forM3u(tunerHash: tunerHash, streamUrl: entry.line), tvgId: entry.tvgId, tvgName: entry.tvgName)
        }
    }

    /// The entry as a full channel row, or nil when Jellyfin would not make a channel of it.
    static func row(entry: M3uEntry, tunerHash: String) -> TunerRow? {
        guard isJellyfinChannel(entry) else { return nil }
        return TunerRow(
            id: JellyfinChannelId.forM3u(tunerHash: tunerHash, streamUrl: entry.line),
            name: jellyfinName(entry),
            number: jellyfinNumber(entry),
            logo: entry.tvgLogo,
            url: entry.url,
            headers: entry.headers,
            groups: entry.groups,
            tvgId: entry.tvgId,
            tvgName: entry.tvgName,
            radio: entry.radio,
            drm: entry.drm
        )
    }

    // MARK: The name and number Jellyfin assigns (M3uParser.cs GetChannelName / GetChannelNumber)

    // Lists match a channel by number and name, so a row must read the same before and after ingest.

    private static let numberPattern = try! NSRegularExpression(pattern: #"^[+-]?(?:[0-9][0-9,]*\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"#)
    private static let numberTrim = CharacterSet(charactersIn: " .")
    private static let nameTrim = CharacterSet(charactersIn: " -")

    /// .NET's `double.TryParse` under the invariant culture, which also reads "NaN" and "Infinity" in any case.
    private static func isNumber(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if numberPattern.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) != nil { return true }
        let unsigned = trimmed.first == "+" || trimmed.first == "-" ? String(trimmed.dropFirst()) : trimmed
        return ["nan", "infinity"].contains(unsigned.lowercased())
    }

    private static func isBlank(_ text: String?) -> Bool {
        text?.trimmingCharacters(in: .whitespaces).isEmpty ?? true
    }

    private static func isChannelNumber(_ text: String?) -> Bool {
        guard let text, !isBlank(text), text != "-1", text != "0" else { return false }
        return isNumber(text)
    }

    private static func attribute(_ entry: M3uEntry, _ key: String) -> String? {
        entry.attrs[key].flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The text after the #EXTINF line's last comma, nil when the line names nothing.
    private static func title(_ entry: M3uEntry) -> String? {
        guard entry.name != entry.url else { return nil }
        return entry.name.split(separator: ",", omittingEmptySubsequences: true).last.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// The title's leading token when it is a number ("84. VOX", "4 Fun Dance"), with where the name starts.
    private static func leadingNumber(_ title: String?) -> (number: String, rest: Substring)? {
        guard let title, !isBlank(title), let space = title.firstIndex(of: " "), space > title.startIndex else { return nil }
        let number = title[..<space].trimmingCharacters(in: numberTrim)
        return isNumber(number) ? (number, title[title.index(after: space)...]) : nil
    }

    static func jellyfinName(_ entry: M3uEntry) -> String {
        let title = title(entry)
        let named = leadingNumber(title).map { $0.rest.trimmingCharacters(in: nameTrim) } ?? title
        for candidate in [named, attribute(entry, "tvg-name"), attribute(entry, "tvg-id")] {
            if let candidate, !isBlank(candidate) { return candidate }
        }
        return entry.name
    }

    static func jellyfinNumber(_ entry: M3uEntry) -> String? {
        var number = attribute(entry, "tvg-chno").flatMap { isNumber($0) ? $0 : nil }
        if !isChannelNumber(number) {
            if let tvgId = attribute(entry, "tvg-id") {
                if isNumber(tvgId) {
                    number = tvgId
                } else if let channelId = attribute(entry, "channel-id"), isNumber(channelId) {
                    number = channelId
                }
            }
            if isBlank(number), let leading = leadingNumber(title(entry)) { number = leading.number }
        }
        if isChannelNumber(number) { return number?.trimmingCharacters(in: .whitespaces) }
        // The stream URL's file name, extension dropped: an Xtream-style `.../12345.ts` is channel 12345.
        let file = entry.line[(entry.line.lastIndex(of: "/").map { entry.line.index(after: $0) } ?? entry.line.startIndex)...]
        let stem = file.lastIndex(of: ".").map { String(file[..<$0]) } ?? String(file)
        return isChannelNumber(stem) ? stem : nil
    }
}
