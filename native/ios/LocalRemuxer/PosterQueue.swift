//
//  PosterQueue.swift
//  TomoTV
//
//  One keyframe per library item that has no poster, made on demand for the cards
//  and kept in the chapter frame pool as poster.jpg. Jobs run one at a time on a
//  low-priority queue, newest request first: a grid mounts cards in scroll order,
//  so the cards on screen are the latest to ask and decode ahead of the ones
//  mounted behind them. A card that leaves the screen cancels its job.
//

import Foundation

final class PosterQueue {
    static let fileName = "poster.jpg"

    private struct Pending {
        let itemId: String
        let inputUrl: String
        let milliseconds: Int64
        let epoch: Int
        let completion: (Outcome) -> Void
    }

    private let root: URL
    let queue = DispatchQueue(label: "tv.tomo.posters", qos: .utility)
    private let lock = NSLock()
    private var cancelled = Set<String>()
    private var pending: [Pending] = []
    private var draining = false

    init(root: URL = ChapterFramePool.root) {
        self.root = root
    }

    /// Resolution of a request: the poster's file URL (`fresh` when decoded now rather than found),
    /// nothing because the source gave no frame (`opened` false when it would not even open), or
    /// nothing because the request was cancelled, or the pool purged, before its turn.
    enum Outcome {
        case poster(URL, fresh: Bool)
        case none(opened: Bool)
        case cancelled
    }

    /// The poster for `itemId`: from the pool when it is there, else decoded in turn, the most
    /// recent request first. A hit and a cancel answer on the caller's thread, a decode on the queue's.
    func request(itemId: String, inputUrl: String, milliseconds: Int64, completion: @escaping (Outcome) -> Void) {
        guard let location = ChapterFramePool.location(for: itemId, in: root) else {
            completion(.none(opened: true))
            return
        }
        let url = location.appendingPathComponent(Self.fileName)
        if FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            completion(.poster(url, fresh: false))
            return
        }
        lock.lock()
        // A fresh request outlives any cancel that came before it.
        cancelled.remove(itemId)
        // The pool the caller asked into; a purge before the job's turn leaves it nothing to answer for.
        pending.append(Pending(itemId: itemId, inputUrl: inputUrl, milliseconds: milliseconds,
                               epoch: ChapterFramePool.epoch, completion: completion))
        let start = !draining
        if start { draining = true }
        lock.unlock()
        if start { queue.async { [self] in drain() } }
    }

    private func drain() {
        while true {
            lock.lock()
            guard let job = pending.popLast() else {
                draining = false
                lock.unlock()
                return
            }
            lock.unlock()
            run(job)
        }
    }

    private func run(_ job: Pending) {
        if isCancelled(job.itemId) || ChapterFramePool.epoch != job.epoch {
            job.completion(.cancelled)
            return
        }
        guard let directory = ChapterFramePool.directory(for: job.itemId, in: root) else {
            job.completion(.none(opened: true))
            return
        }
        let grabber = FrameGrabber(inputUrl: job.inputUrl, directory: directory, pool: root, epoch: job.epoch)
        // A run of keyframes from the 10% mark; the grabber takes the most representative, so a
        // dark or blank opening loses to real footage further in.
        let result = grabber.frame(atMilliseconds: job.milliseconds, named: Self.fileName, nearestFromStart: true,
                                   enhanced: true, batch: 10)
        grabber.stop()
        if let result {
            job.completion(.poster(result, fresh: true))
        } else {
            job.completion(.none(opened: grabber.sourceOpened))
        }
    }

    /// A pending job for the item completes cancelled at once, without waiting for its turn. One
    /// already decoding finishes: its frame goes to the pool either way.
    func cancel(itemId: String) {
        lock.lock()
        cancelled.insert(itemId)
        let withdrawn = pending.filter { $0.itemId == itemId }
        pending.removeAll { $0.itemId == itemId }
        lock.unlock()
        for job in withdrawn { job.completion(.cancelled) }
    }

    private func isCancelled(_ itemId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled.contains(itemId)
    }
}
