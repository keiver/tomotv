//
//  PlaylistStore.swift
//  TomoTV
//
//  A parsed playlist held for queries: entries in file order, groups in order of first appearance.
//  Thread-safe; the loader writes on its queue while callers read on theirs.
//

import Foundation

struct PlaylistGroup: Equatable {
    var name: String
    var count: Int
}

final class PlaylistStore {
    private let lock = NSLock()
    private var header = M3uHeader()
    private var entries: [M3uEntry] = []
    private var groupOrder: [String] = []
    private var byGroup: [String: [Int]] = [:]

    func set(_ header: M3uHeader) {
        lock.lock()
        self.header = header
        lock.unlock()
    }

    func add(_ entry: M3uEntry) {
        lock.lock()
        let index = entries.count
        entries.append(entry)
        for group in entry.groups {
            if byGroup[group] == nil { groupOrder.append(group) }
            byGroup[group, default: []].append(index)
        }
        lock.unlock()
    }

    var playlistHeader: M3uHeader {
        lock.lock()
        defer { lock.unlock() }
        return header
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }

    var groups: [PlaylistGroup] {
        lock.lock()
        defer { lock.unlock() }
        return groupOrder.map { PlaylistGroup(name: $0, count: byGroup[$0]?.count ?? 0) }
    }

    /// A page of entries in file order; held to a group when one is named.
    func entries(group: String?, offset: Int, limit: Int) -> [M3uEntry] {
        lock.lock()
        defer { lock.unlock() }
        guard offset >= 0, limit > 0 else { return [] }
        if let group {
            let indexes = byGroup[group] ?? []
            guard offset < indexes.count else { return [] }
            return indexes[offset ..< min(offset + limit, indexes.count)].map { entries[$0] }
        }
        guard offset < entries.count else { return [] }
        return Array(entries[offset ..< min(offset + limit, entries.count)])
    }

    var allEntries: [M3uEntry] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }
}
