//
//  LiveFrameQueue.swift
//  TomoTV
//
//  One frame per live channel on request, for the guide's cards: the channel's first keyframe
//  now, kept in the chapter frame pool under a time-named file. Jobs run one at a time on a
//  low-priority queue of their own, so a dead origin never stalls the library's posters, and a
//  watchdog stops a grab at its deadline.
//

import Foundation

final class LiveFrameQueue {
    static let defaultDeadline: TimeInterval = 8
    private static let filePrefix = "live-"

    private let root: URL
    let queue = DispatchQueue(label: "tv.tomo.liveframes", qos: .utility)
    private let lock = NSLock()
    private var cancelled = Set<String>()
    /// Channels with a request queued or running; a second request for one joins nothing and answers cancelled.
    private var pending = Set<String>()

    init(root: URL = ChapterFramePool.root) {
        self.root = root
    }

    enum Outcome {
        case frame(URL)
        /// Nothing came: `opened` false when the source would not even open.
        case none(opened: Bool)
        case cancelled
    }

    /// The channel's frame now, decoded in turn. The completion runs on the queue's thread.
    func request(channelId: String, inputUrl: String, headers: [String: String], deadline: TimeInterval = defaultDeadline,
                 completion: @escaping (Outcome) -> Void) {
        guard let location = ChapterFramePool.location(for: channelId, in: root) else {
            completion(.none(opened: true))
            return
        }
        lock.lock()
        cancelled.remove(channelId)
        let duplicate = !pending.insert(channelId).inserted
        lock.unlock()
        if duplicate {
            completion(.cancelled)
            return
        }
        let epoch = ChapterFramePool.epoch
        queue.async { [self] in
            defer {
                lock.lock()
                pending.remove(channelId)
                lock.unlock()
            }
            if isCancelled(channelId) || ChapterFramePool.epoch != epoch {
                completion(.cancelled)
                return
            }
            guard let directory = ChapterFramePool.directory(for: channelId, in: root) else {
                completion(.none(opened: true))
                return
            }
            let grabber = FrameGrabber(inputUrl: inputUrl, directory: directory, pool: root, epoch: epoch, httpHeaders: headers, live: true)
            let watchdog = DispatchWorkItem { grabber.stop() }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + deadline, execute: watchdog)
            let started = Date()
            let name = "\(Self.filePrefix)\(Int64(started.timeIntervalSince1970 * 1000)).jpg"
            let result = grabber.liveFrame(named: name)
            watchdog.cancel()
            grabber.stop()
            let elapsed = Date().timeIntervalSince(started)
            if let result {
                Self.removeOthers(in: location, keeping: result)
                NSLog("[LiveFrame] %@", String(format: "%@ %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                completion(.frame(result))
            } else {
                NSLog("[LiveFrame] %@", String(format: "%@ none %.2fs opened=%d", channelId, elapsed, grabber.sourceOpened ? 1 : 0))
                completion(.none(opened: grabber.sourceOpened))
            }
        }
    }

    /// A pending job for the channel completes cancelled without opening its source; one already
    /// decoding is stopped.
    func cancel(channelId: String) {
        lock.lock()
        cancelled.insert(channelId)
        lock.unlock()
    }

    private func isCancelled(_ channelId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled.contains(channelId)
    }

    /// The channel keeps one live frame: the one just written.
    private static func removeOthers(in directory: URL, keeping kept: URL) {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for entry in entries where entry.lastPathComponent.hasPrefix(filePrefix) && entry.lastPathComponent != kept.lastPathComponent {
            try? FileManager.default.removeItem(at: entry)
        }
    }
}
