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
    var errors = 0
}

typealias GuideLoadError = SourceLoadError

final class GuideLoader {
    private let parser: XmltvParser
    private var loader: SourceLoader?

    /// Starts the load; `completion` runs once on the loader's own queue. Keep the returned loader to cancel it.
    static func load(
        url: URL, window: GuideWindow?, headers: [String: String] = [:], store: GuideStore,
        configuration: URLSessionConfiguration = .ephemeral, completion: @escaping (Result<GuideStats, Error>) -> Void
    ) -> GuideLoader {
        let guide = GuideLoader(window: window, store: store)
        guide.loader = SourceLoader.load(url: url, headers: headers, sink: guide.parser, configuration: configuration) { result in
            completion(result.map(guide.stats))
        }
        return guide
    }

    /// Parses a guide already in memory, on the caller's thread.
    static func parse(data: Data, window: GuideWindow?, store: GuideStore) throws -> GuideStats {
        let guide = GuideLoader(window: window, store: store)
        return guide.stats(try SourceLoader.parse(data: data, sink: guide.parser))
    }

    private init(window: GuideWindow?, store: GuideStore) {
        parser = XmltvParser(window: window)
        parser.onChannel = { store.add($0) }
        parser.onProgramme = { store.add($0) }
    }

    func cancel() {
        loader?.cancel()
    }

    private func stats(_ load: LoadStats) -> GuideStats {
        GuideStats(load: load, channels: parser.channels, programmes: parser.programmes, skipped: parser.skipped, errors: parser.errors)
    }
}
