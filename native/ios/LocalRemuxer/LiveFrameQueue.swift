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
    /// The grabber reading each channel now, so a cancel stops its read instead of waiting it out.
    private var running: [String: FrameGrabber] = [:]

    init(root: URL = ChapterFramePool.root) {
        self.root = root
    }

    /// One open yields a burst: a keyframe, then a picture per second for up to `defaultSpan`.
    static let defaultSpan: TimeInterval = 8
    static let defaultInterval: TimeInterval = 1
    static let defaultCount = 8

    enum Outcome {
        /// The burst in order, the first keyframe's pts with it.
        case frames([URL], pts: Int64?)
        /// The keyframe at the live edge is still the one `shownPts` names; nothing was written.
        case unchanged
        /// Nothing came: `opened` false when the source would not even open.
        case none(opened: Bool)
        case cancelled
    }

    /// The channel's burst now, decoded in turn. The completion runs on the queue's thread.
    func request(channelId: String, inputUrl: String, headers: [String: String], deadline: TimeInterval = defaultDeadline,
                 span: TimeInterval = defaultSpan, interval: TimeInterval = defaultInterval, count: Int = defaultCount,
                 shownPts: Int64? = nil, completion: @escaping (Outcome) -> Void) {
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
            lock.lock()
            let stopped = cancelled.contains(channelId)
            if !stopped { running[channelId] = grabber }
            lock.unlock()
            if stopped {
                completion(.cancelled)
                return
            }
            let watchdog = DispatchWorkItem { grabber.stop() }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + deadline, execute: watchdog)
            let started = Date()
            let base = "\(Self.filePrefix)\(Int64(started.timeIntervalSince1970 * 1000))"
            let result = grabber.liveBurst(named: base, span: min(span, deadline), interval: interval, count: max(1, count), unlessPts: shownPts)
            watchdog.cancel()
            grabber.stop()
            let elapsed = Date().timeIntervalSince(started)
            lock.lock()
            running[channelId] = nil
            let stoppedMidway = cancelled.contains(channelId)
            lock.unlock()
            if stoppedMidway {
                if case .frames(let files, _) = result { for file in files { try? FileManager.default.removeItem(at: file) } }
                NSLog("[LiveFrame] %@", String(format: "%@ cancelled %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                completion(.cancelled)
                return
            }
            switch result {
            case .frames(let files, let pts):
                Self.removeOthers(in: location, keeping: files)
                NSLog("[LiveFrame] %@", String(format: "%@ %d frames %.2fs %lld bytes", channelId, files.count, elapsed, grabber.bytesRead))
                completion(.frames(files, pts: pts))
            case .unchanged:
                NSLog("[LiveFrame] %@", String(format: "%@ unchanged %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                completion(.unchanged)
            case .none:
                NSLog("[LiveFrame] %@", String(format: "%@ none %.2fs opened=%d %@ %@", channelId, elapsed, grabber.sourceOpened ? 1 : 0,
                                                 grabber.openFailure ?? "no keyframe", grabber.openedUrl ?? inputUrl))
                completion(.none(opened: grabber.sourceOpened))
            }
        }
    }

    /// The newest burst on disk for each channel that has one, by the time in its names, in order.
    /// A reload or a relaunch reads these before any grab, so a card never loses the picture it had.
    func latest(channelIds: [String]) -> [String: [URL]] {
        var found: [String: [URL]] = [:]
        for channelId in channelIds {
            guard let location = ChapterFramePool.location(for: channelId, in: root),
                  let entries = try? FileManager.default.contentsOfDirectory(at: location, includingPropertiesForKeys: nil) else { continue }
            let frames = entries.filter { $0.lastPathComponent.hasPrefix(Self.filePrefix) }
            guard let newest = frames.map(Self.stamp).max() else { continue }
            found[channelId] = frames.filter { Self.stamp($0) == newest }.sorted { Self.index($0) < Self.index($1) }
        }
        return found
    }

    /// The grab time a frame's name carries (`live-<ms>-<i>.jpg`, or the older `live-<ms>.jpg`), 0 for a name without one.
    static func stamp(_ url: URL) -> Int64 {
        let name = url.deletingPathExtension().lastPathComponent.dropFirst(filePrefix.count)
        return Int64(name.split(separator: "-").first ?? "") ?? 0
    }

    /// The frame's place in its burst, 0 for a name without one.
    static func index(_ url: URL) -> Int {
        let parts = url.deletingPathExtension().lastPathComponent.dropFirst(filePrefix.count).split(separator: "-")
        return parts.count > 1 ? Int(parts[1]) ?? 0 : 0
    }

    /// A pending job for the channel completes cancelled without opening its source; one already
    /// reading is stopped, its read interrupted.
    func cancel(channelId: String) {
        lock.lock()
        cancelled.insert(channelId)
        let reading = running[channelId]
        lock.unlock()
        reading?.stop()
    }

    private func isCancelled(_ channelId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled.contains(channelId)
    }

    /// The channel keeps one burst: the one just written.
    private static func removeOthers(in directory: URL, keeping kept: [URL]) {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        let names = Set(kept.map(\.lastPathComponent))
        for entry in entries where entry.lastPathComponent.hasPrefix(filePrefix) && !names.contains(entry.lastPathComponent) {
            try? FileManager.default.removeItem(at: entry)
        }
    }
}
