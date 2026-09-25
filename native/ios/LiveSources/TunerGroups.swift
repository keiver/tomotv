//
//  TunerGroups.swift
//  TomoTV
//
//  The `group-title` groups of a Jellyfin M3U tuner, mapped to the channel ids the server gave the
//  entries. Jellyfin drops the groups, so the device reads the playlist itself.
//

import Foundation

struct TunerGroup: Equatable {
    var name: String
    /// Channel item ids in playlist order.
    var channelIds: [String]
}

/// A tuner channel's guide identity: the server's item id and the playlist's tvg-id.
struct TunerChannel: Equatable {
    var id: String
    var tvgId: String
}

struct PlaylistStats: Equatable {
    var load = LoadStats()
    var entries = 0
    var groups = 0
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

    /// Each Jellyfin channel that carries a tvg-id, in playlist order: the key an XMLTV guide matches on.
    static func channels(entries: [M3uEntry], tunerUrl: String) -> [TunerChannel] {
        let tunerHash = JellyfinChannelId.md5Guid(tunerUrl)
        return entries.compactMap { entry in
            guard isJellyfinChannel(entry), let tvgId = entry.tvgId else { return nil }
            return TunerChannel(id: JellyfinChannelId.forM3u(tunerHash: tunerHash, streamUrl: entry.line), tvgId: tvgId)
        }
    }
}

final class PlaylistLoader {
    private let parser = M3uParser()
    private var loader: SourceLoader?

    /// Starts the load; `completion` runs once on the loader's own queue. Keep the returned loader to cancel it.
    static func load(
        url: URL, headers: [String: String] = [:], store: PlaylistStore,
        configuration: URLSessionConfiguration = .ephemeral, completion: @escaping (Result<PlaylistStats, Error>) -> Void
    ) -> PlaylistLoader {
        let playlist = PlaylistLoader(store: store)
        playlist.loader = SourceLoader.load(url: url, headers: headers, sink: playlist.parser, configuration: configuration) { result in
            completion(result.map { playlist.stats($0, store: store) })
        }
        return playlist
    }

    /// Parses a playlist already in memory, on the caller's thread.
    static func parse(data: Data, store: PlaylistStore) throws -> PlaylistStats {
        let playlist = PlaylistLoader(store: store)
        return playlist.stats(try SourceLoader.parse(data: data, sink: playlist.parser), store: store)
    }

    private init(store: PlaylistStore) {
        parser.onHeader = { store.set($0) }
        parser.onEntry = { store.add($0) }
    }

    func cancel() {
        loader?.cancel()
    }

    private func stats(_ load: LoadStats, store: PlaylistStore) -> PlaylistStats {
        PlaylistStats(load: load, entries: parser.count, groups: store.groups.count)
    }
}
