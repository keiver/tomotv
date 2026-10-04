//
//  GuideStore.swift
//  TomoTV
//
//  A parsed guide held for queries: channels in file order, programmes per channel ordered by start.
//  Thread-safe; the loader writes on its queue while callers read on theirs.
//

import Foundation

final class GuideStore {
    private let lock = NSLock()
    private var channelList: [GuideChannel] = []
    private var byChannel: [String: [GuideProgramme]] = [:]
    private var sorted = true
    /// Each channel's programmes' folded search text, index for index with `byChannel`; built on the first search.
    private var searchText: [String: [String]] = [:]

    func add(_ channel: GuideChannel) {
        lock.lock()
        channelList.append(channel)
        lock.unlock()
    }

    func add(_ programme: GuideProgramme) {
        lock.lock()
        byChannel[programme.channel, default: []].append(programme)
        sorted = false
        searchText = [:]
        lock.unlock()
    }

    var channels: [GuideChannel] {
        lock.lock()
        defer { lock.unlock() }
        return channelList
    }

    /// Programmes on the given channels overlapping `window`, each channel's in start order.
    /// A programme without a stop ends where the channel's next one starts.
    func programmes(channelIds: [String], window: GuideWindow) -> [GuideProgramme] {
        lock.lock()
        defer { lock.unlock() }
        return channelIds.flatMap { id in overlapping(id, window: window) { _ in true } }
    }

    /// Programmes overlapping `window` on the given channels that carry every word of `query`
    /// (GuideSearch): a title's earliest airing per channel, earliest start first, at most `limit`.
    func search(channelIds: [String], window: GuideWindow, query: String, limit: Int) -> [GuideProgramme] {
        let terms = GuideSearch.terms(query)
        guard !terms.isEmpty, limit > 0 else { return [] }
        lock.lock()
        defer { lock.unlock() }
        let hits = channelIds.flatMap { id -> [GuideProgramme] in
            let texts = foldedText(id)
            var titles = Set<String>()
            // Start order: the first airing of a title on a channel is the one kept.
            return overlapping(id, window: window) { index in terms.allSatisfy { texts[index].contains($0) } }.filter { titles.insert(GuideSearch.fold($0.title)).inserted }
        }
        return Array(hits.sorted { $0.start < $1.start }.prefix(limit))
    }

    /// The channel's programmes in start order overlapping `window` that `keep` admits by index.
    /// A programme without a stop ends where the channel's next one starts. Callers hold the lock.
    private func overlapping(_ id: String, window: GuideWindow, keep: (Int) -> Bool) -> [GuideProgramme] {
        sortIfNeeded()
        let list = byChannel[id] ?? []
        return list.indices.compactMap { index in
            var programme = list[index]
            programme.stop = programme.stop ?? (index + 1 < list.count ? list[index + 1].start : nil)
            return window.overlaps(start: programme.start, stop: programme.stop) && keep(index) ? programme : nil
        }
    }

    /// The channel's folded search text in start order, folded once per guide load. Callers hold the lock.
    private func foldedText(_ id: String) -> [String] {
        sortIfNeeded()
        if let cached = searchText[id] { return cached }
        let texts = (byChannel[id] ?? []).map(GuideSearch.text)
        searchText[id] = texts
        return texts
    }

    /// Callers hold the lock.
    private func sortIfNeeded() {
        guard !sorted else { return }
        for key in byChannel.keys { byChannel[key]?.sort { $0.start < $1.start } }
        sorted = true
    }

    var programmeCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return byChannel.values.reduce(0) { $0 + $1.count }
    }
}
