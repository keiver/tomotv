//
//  PosterQueue.swift
//  TomoTV
//
//  One keyframe per library item that has no poster, made on demand for the cards
//  and kept in the chapter frame pool as poster.jpg. Jobs run one at a time on a
//  low-priority queue: each is a source open over the link, and a grid mounts
//  dozens of cards at once. A card that leaves the screen cancels its job.
//

import Foundation

final class PosterQueue {
    static let fileName = "poster.jpg"

    private let root: URL
    private let queue = DispatchQueue(label: "tv.tomo.posters", qos: .utility)
    private let lock = NSLock()
    private var cancelled = Set<String>()

    init(root: URL = ChapterFramePool.root) {
        self.root = root
    }

    /// Resolution of a request: the poster's file URL, nothing because the source gave no
    /// frame, or nothing because the request was cancelled, or the pool purged, before its turn.
    enum Outcome {
        case poster(URL)
        case none
        case cancelled
    }

    /// The poster for `itemId`: from the pool when it is there, else decoded in turn. The
    /// completion runs on the queue's thread.
    func request(itemId: String, inputUrl: String, milliseconds: Int64, completion: @escaping (Outcome) -> Void) {
        guard let location = ChapterFramePool.location(for: itemId, in: root) else {
            completion(.none)
            return
        }
        let url = location.appendingPathComponent(Self.fileName)
        if FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            completion(.poster(url))
            return
        }
        // A fresh request outlives any cancel that came before it.
        lock.lock()
        cancelled.remove(itemId)
        lock.unlock()
        // The pool the caller asked into; a purge before the job's turn leaves it nothing to answer for.
        let epoch = ChapterFramePool.epoch
        queue.async { [self] in
            if isCancelled(itemId) || ChapterFramePool.epoch != epoch {
                completion(.cancelled)
                return
            }
            guard let directory = ChapterFramePool.directory(for: itemId, in: root) else {
                completion(.none)
                return
            }
            let started = Date()
            let grabber = FrameGrabber(inputUrl: inputUrl, directory: directory, pool: root)
            let result = grabber.frame(atMilliseconds: milliseconds, named: Self.fileName, nearestFromStart: true)
            grabber.stop()
            if let result {
                NSLog("[PosterQueue] %@", String(format: "%@ ready in %.2fs", itemId, Date().timeIntervalSince(started)))
                completion(.poster(result))
            } else {
                completion(.none)
            }
        }
    }

    /// A pending job for the item completes cancelled without opening its source. One already
    /// decoding finishes: its frame goes to the pool either way.
    func cancel(itemId: String) {
        lock.lock()
        cancelled.insert(itemId)
        lock.unlock()
    }

    private func isCancelled(_ itemId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled.contains(itemId)
    }
}
