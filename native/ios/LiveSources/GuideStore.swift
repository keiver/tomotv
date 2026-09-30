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

    func add(_ channel: GuideChannel) {
        lock.lock()
        channelList.append(channel)
        lock.unlock()
    }

    func add(_ programme: GuideProgramme) {
        lock.lock()
        byChannel[programme.channel, default: []].append(programme)
        sorted = false
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
        if !sorted {
            for key in byChannel.keys { byChannel[key]?.sort { $0.start < $1.start } }
            sorted = true
        }
        return channelIds.flatMap { id -> [GuideProgramme] in
            let list = byChannel[id] ?? []
            return list.indices.compactMap { index in
                var programme = list[index]
                programme.stop = programme.stop ?? (index + 1 < list.count ? list[index + 1].start : nil)
                return window.overlaps(start: programme.start, stop: programme.stop) ? programme : nil
            }
        }
    }

    var programmeCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return byChannel.values.reduce(0) { $0 + $1.count }
    }
}
