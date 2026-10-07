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
    /// Each entry's sample duration (IFrameEntries.sampleDurations), patched into a fragment moved onto it.
    private let sampleDurations: [Double]
    private let cond = NSCondition()
    private var cache: [Int: Data] = [:]
    private var order: [Int] = []
    private var cachedBytes = 0
    /// Requests waiting per entry, and the entries in request order, newest last.
    private var waiting: [Int: Int] = [:]
    private var pending: [Int] = []
    private var prefetching = Set<Int>()
    private var madeBytes: [Int: Int] = [:]
    private var failures = 0
    private var pausedUntil = Date.distantPast
    private var working = false
    private var stopped = false

    /// `timescale` is the track's tfdt units per second; `produce` makes entry k's fragment, or nil.
    init(entries: IFrameEntries, timescale: Double, sampleDurations: [Double] = [], produce: @escaping (Int) -> Data?) {
        self.entries = entries
        self.timescale = timescale
        self.sampleDurations = sampleDurations
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

    /// Makes these entries ahead of any request, after every waiting one: the master's measured sample.
    func prefetch(_ ks: [Int]) {
        cond.lock()
        defer { cond.unlock() }
        prefetching.formUnion(ks.filter { entries.stamps.indices.contains($0) && cache[$0] == nil })
        startWorkerLocked()
    }

    /// Bytes of every fragment made so far, by entry, kept after the cache lets the fragment go.
    func madeSizes() -> [Int: Int] {
        cond.lock()
        defer { cond.unlock() }
        return madeBytes
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
        while !stopped, let k = pending.last(where: { cache[$0] == nil && (waiting[$0] ?? 0) > 0 })
                ?? prefetching.sorted().first(where: { cache[$0] == nil }) {
            if Date() < pausedUntil {
                cond.wait(until: pausedUntil)
                continue
            }
            cond.unlock()
            let data = produce(k)
            cond.lock()
            prefetching.remove(k)
            if let data {
                failures = 0
                madeBytes[k] = data.count
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

    /// A made fragment moved onto another entry: its tfdt, sample duration and sequence become that entry's.
    private func restamp(_ data: Data, from: Int, to: Int) -> Data {
        let delta = Int64(((entries.stamps[to] - entries.stamps[from]) * timescale).rounded())
        var body = data.subdata(in: RemuxSession.stypBox.count..<data.count)
        RemuxSession.patchTfdtToAbsolute(in: &body, offsets: [1: delta])
        if sampleDurations.indices.contains(to) {
            Self.patchFragment(&body, sequence: UInt32(clamping: to + 1), sampleDuration: UInt32(clamping: Int64((sampleDurations[to] * timescale).rounded())))
        }
        return RemuxSession.stypBox + body
    }

    /// Rewrites a one-sample fragment's mfhd sequence number and its sample duration, wherever
    /// tfhd or trun carries it (spec 7.3: tfdt plus duration meets the next fragment's tfdt).
    static func patchFragment(_ data: inout Data, sequence: UInt32, sampleDuration: UInt32) {
        func u32(_ at: Int) -> UInt32 {
            (UInt32(data[at]) << 24) | (UInt32(data[at + 1]) << 16) | (UInt32(data[at + 2]) << 8) | UInt32(data[at + 3])
        }
        func put(_ value: UInt32, at: Int) {
            for i in 0..<4 { data[at + i] = UInt8((value >> (8 * (3 - i))) & 0xFF) }
        }
        func type(_ at: Int) -> String { String(decoding: data[(at + 4)..<(at + 8)], as: UTF8.self) }
        func children(_ start: Int, _ end: Int, _ visit: (Int, Int) -> Void) {
            var at = start
            while at + 8 <= end {
                let size = Int(u32(at))
                guard size >= 8, at + size <= end else { return }
                visit(at, size)
                at += size
            }
        }
        children(0, data.count) { moof, moofSize in
            guard type(moof) == "moof" else { return }
            children(moof + 8, moof + moofSize) { box, size in
                if type(box) == "mfhd", size >= 16 { put(sequence, at: box + 12) }
                guard type(box) == "traf" else { return }
                children(box + 8, box + size) { child, childSize in
                    guard childSize >= 12 else { return }
                    let flags = u32(child + 8) & 0xFF_FFFF
                    if type(child) == "tfhd", flags & 0x08 != 0 {
                        // track_ID, then base_data_offset (8) and sample_description_index (4) when present.
                        let at = child + 16 + (flags & 0x01 != 0 ? 8 : 0) + (flags & 0x02 != 0 ? 4 : 0)
                        if at + 4 <= child + childSize { put(sampleDuration, at: at) }
                    }
                    if type(child) == "trun", flags & 0x100 != 0 {
                        // sample_count, then data_offset and first_sample_flags when present.
                        let at = child + 16 + (flags & 0x01 != 0 ? 4 : 0) + (flags & 0x04 != 0 ? 4 : 0)
                        if at + 4 <= child + childSize { put(sampleDuration, at: at) }
                    }
                }
            }
        }
    }
}
