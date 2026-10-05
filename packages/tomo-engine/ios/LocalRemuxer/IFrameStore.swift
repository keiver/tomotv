//
//  IFrameStore.swift
//  TomoTV
//
//  Serves the I-frame rendition's fragments without ever failing one: AVPlayer retries a
//  missing I-frame segment without end and stops trick play (measured: 604 retries in 30 s).
//  Requests are made newest first; one that cannot wait for its own gets the nearest fragment
//  already made, restamped at its own time, and a failing source is left alone for a while.
//

import Foundation

final class IFrameStore {
    /// Fragments kept for a scrub that comes back over the same stretch.
    static let cacheBytes = 24 << 20
    /// How long a request with nothing cached at all waits for the first fragment.
    static let firstFrameWait: TimeInterval = 20
    /// A source whose reads fail is left alone this long, then the longer step on further failures.
    static let backoff: [TimeInterval] = [5, 30]

    let entries: IFrameEntries
    private let produce: (Int) -> Data?
    private let timescale: Double
    private let cond = NSCondition()
    private var cache: [Int: Data] = [:]
    private var order: [Int] = []
    private var cachedBytes = 0
    /// Requests waiting per entry, and the entries in request order, newest last.
    private var waiting: [Int: Int] = [:]
    private var pending: [Int] = []
    private var failures = 0
    private var pausedUntil = Date.distantPast
    private var working = false
    private var stopped = false

    /// `timescale` is the track's tfdt units per second; `produce` makes entry k's fragment, or nil.
    init(entries: IFrameEntries, timescale: Double, produce: @escaping (Int) -> Data?) {
        self.entries = entries
        self.timescale = timescale
        self.produce = produce
    }

    func stop() {
        cond.lock()
        stopped = true
        cond.broadcast()
        cond.unlock()
    }

    /// Entry k, waiting at most `budget` for its own frame before the nearest one made stands in.
    /// Nil only once stopped, or when no fragment at all could be made within `firstFrameWait`.
    func fragment(_ k: Int, budget: TimeInterval) -> Data? {
        guard entries.stamps.indices.contains(k) else { return nil }
        cond.lock()
        defer { cond.unlock() }
        if let hit = cache[k] {
            touch(k)
            return hit
        }
        waiting[k, default: 0] += 1
        pending.removeAll { $0 == k }
        pending.append(k)
        defer {
            waiting[k, default: 1] -= 1
            if waiting[k] == 0 {
                waiting.removeValue(forKey: k)
                pending.removeAll { $0 == k }
            }
        }
        startWorkerLocked()
        let start = Date()
        while !stopped, cache[k] == nil {
            let waited = Date().timeIntervalSince(start)
            if waited >= budget, let near = entries.nearest(to: k, among: cache.keys), let data = cache[near] {
                return restamp(data, from: near, to: k)
            }
            if waited >= max(budget, Self.firstFrameWait) { return nil }
            cond.wait(until: Date().addingTimeInterval(0.05))
        }
        guard let data = cache[k] else { return nil }
        touch(k)
        return data
    }

    private func startWorkerLocked() {
        guard !working, !stopped else { return }
        working = true
        Thread.detachNewThread { [weak self] in self?.work() }
    }

    private func work() {
        cond.lock()
        defer {
            working = false
            cond.unlock()
        }
        while !stopped, let k = pending.last(where: { cache[$0] == nil && (waiting[$0] ?? 0) > 0 }) {
            if Date() < pausedUntil {
                cond.wait(until: pausedUntil)
                continue
            }
            cond.unlock()
            let data = produce(k)
            cond.lock()
            if let data {
                failures = 0
                cache[k] = data
                order.append(k)
                cachedBytes += data.count
                while cachedBytes > Self.cacheBytes, order.count > 1 {
                    cachedBytes -= cache.removeValue(forKey: order.removeFirst())?.count ?? 0
                }
            } else {
                failures += 1
                pausedUntil = Date().addingTimeInterval(Self.backoff[min(failures, Self.backoff.count) - 1])
                // The request that failed gets the nearest frame; it is not retried on its own.
                pending.removeAll { $0 == k }
            }
            cond.broadcast()
        }
    }

    private func touch(_ k: Int) {
        order.removeAll { $0 == k }
        order.append(k)
    }

    /// A made fragment moved onto another entry's time: only its tfdt changes.
    private func restamp(_ data: Data, from: Int, to: Int) -> Data {
        let delta = Int64(((entries.stamps[to] - entries.stamps[from]) * timescale).rounded())
        var body = data.subdata(in: RemuxSession.stypBox.count..<data.count)
        RemuxSession.patchTfdtToAbsolute(in: &body, offsets: [1: delta])
        return RemuxSession.stypBox + body
    }
}
