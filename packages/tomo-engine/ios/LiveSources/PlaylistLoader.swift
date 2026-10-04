//
//  PlaylistLoader.swift
//
//  Streams an M3U playlist into a PlaylistStore, over the network or from memory.
//

import Foundation

public struct PlaylistStats: Equatable {
    public var load = LoadStats()
    public var entries = 0
    public var groups = 0
}

public final class PlaylistLoader {
    private let parser = M3uParser()
    private var loader: SourceLoader?

    /// Starts the load; `completion` runs once on the loader's own queue. Keep the returned loader to cancel it.
    public static func load(
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
    public static func parse(data: Data, store: PlaylistStore) throws -> PlaylistStats {
        let playlist = PlaylistLoader(store: store)
        return playlist.stats(try SourceLoader.parse(data: data, sink: playlist.parser), store: store)
    }

    private init(store: PlaylistStore) {
        parser.onHeader = { store.set($0) }
        parser.onEntry = { store.add($0) }
    }

    public func cancel() {
        loader?.cancel()
    }

    private func stats(_ load: LoadStats, store: PlaylistStore) -> PlaylistStats {
        PlaylistStats(load: load, entries: parser.count, groups: store.groups.count)
    }
}
