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
            name: entry.name,
            number: entry.tvgChno,
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
}
