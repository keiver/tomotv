//
//  GuideLoader.swift
//  TomoTV
//
//  An XMLTV guide streamed through SourceLoader into XmltvParser, landing in a GuideStore.
//

import Foundation

struct GuideStats: Equatable {
    var load = LoadStats()
    var channels = 0
    var programmes = 0
    var skipped = 0
    /// Programmes skipped because no app channel pairs with their channel.
    var unmatched = 0
    /// 2 when a channel entry came after programmes and the guide was read again.
    var passes = 1
    var errors = 0
    /// Time spent pre-folding the store's search text after the load.
    var foldMs = 0
}

typealias GuideLoadError = SourceLoadError

final class GuideLoader {
    private let parser: XmltvParser
    private var loader: SourceLoader?
    /// The second read, when the first found a channel listed after programmes.
    private var again: GuideLoader?
    private var cancelled = false

    /// Starts the load; `completion` runs once on the loader's own queue. Keep the returned loader to cancel it.
    /// With `channels`, only programmes of guide channels those pair with are kept.
    static func load(
        url: URL, window: GuideWindow?, channels: [GuideChannelRequest]? = nil, headers: [String: String] = [:], store: GuideStore,
        configuration: URLSessionConfiguration = .ephemeral, completion: @escaping (Result<GuideStats, Error>) -> Void
    ) -> GuideLoader {
        let filter = channels.map { GuideChannelFilter.pairedWith(GuideChannelMatcher(requests: $0)) }
        let guide = GuideLoader(window: window, filter: filter, store: store)
        guide.loader = SourceLoader.load(url: url, headers: headers, sink: guide.parser, configuration: configuration) { result in
            if case .success = result, !guide.cancelled, let paired = guide.parser.channelsListedLate() {
                // A channel's entry came after programmes that were skipped for it: read again knowing every channel.
                store.removeAll()
                let again = GuideLoader(window: window, filter: .ids(paired), store: store)
                guide.again = again
                again.loader = SourceLoader.load(url: url, headers: headers, sink: again.parser, configuration: configuration) { second in
                    completion(second.map { again.finished($0, store: store, passes: 2) })
                }
                return
            }
            completion(result.map { guide.finished($0, store: store, passes: 1) })
        }
        return guide
    }

    /// Parses a guide already in memory, on the caller's thread.
    static func parse(data: Data, window: GuideWindow?, channels: [GuideChannelRequest]? = nil, store: GuideStore) throws -> GuideStats {
        let filter = channels.map { GuideChannelFilter.pairedWith(GuideChannelMatcher(requests: $0)) }
        let guide = GuideLoader(window: window, filter: filter, store: store)
        let load = try SourceLoader.parse(data: data, sink: guide.parser)
        guard let paired = guide.parser.channelsListedLate() else { return guide.stats(load, passes: 1) }
        store.removeAll()
        let again = GuideLoader(window: window, filter: .ids(paired), store: store)
        return again.stats(try SourceLoader.parse(data: data, sink: again.parser), passes: 2)
    }

    private init(window: GuideWindow?, filter: GuideChannelFilter?, store: GuideStore) {
        parser = XmltvParser(window: window, filter: filter)
        parser.onChannel = { store.add($0) }
        parser.onProgramme = { store.add($0) }
    }

    func cancel() {
        cancelled = true
        loader?.cancel()
        again?.cancel()
    }

    /// Pre-folds here on the loader's queue: a search then never folds while holding the module queue.
    private func finished(_ load: LoadStats, store: GuideStore, passes: Int) -> GuideStats {
        let started = Date()
        store.buildSearchText()
        var stats = stats(load, passes: passes)
        stats.foldMs = Int(Date().timeIntervalSince(started) * 1000)
        return stats
    }

    private func stats(_ load: LoadStats, passes: Int) -> GuideStats {
        GuideStats(
            load: load, channels: parser.channels, programmes: parser.programmes, skipped: parser.skipped,
            unmatched: parser.unmatched, passes: passes, errors: parser.errors
        )
    }
}
