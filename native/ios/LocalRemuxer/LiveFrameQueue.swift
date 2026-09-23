//
//  LiveFrameQueue.swift
//  TomoTV
//
//  One frame per live channel on request, for the guide's cards: the channel's first keyframe
//  now, kept in the chapter frame pool under a time-named file. Jobs run a few at a time on a
//  low-priority queue of their own, so a dead origin never stalls the library's posters or the
//  other channels, and a watchdog stops a grab at its deadline.
//

import Foundation

final class LiveFrameQueue {
    static let defaultDeadline: TimeInterval = 8
    /// Grabs overlap: each is network wait around a single keyframe decode.
    static let defaultWidth = 4
    private static let filePrefix = "live-"

    private let root: URL
    let queue = DispatchQueue(label: "tv.tomo.liveframes", qos: .utility)
    private let grabs = OperationQueue()
    private let lock = NSLock()
    private var cancelled = Set<String>()
    /// Channels with a request queued or running; a second request for one joins nothing and answers cancelled.
    private var pending = Set<String>()
    /// The grabber reading each channel now, so a cancel stops its read instead of waiting it out.
    private var running: [String: FrameGrabber] = [:]

    init(root: URL = ChapterFramePool.root, width: Int = defaultWidth) {
        self.root = root
        grabs.name = "tv.tomo.liveframes.grabs"
        grabs.qualityOfService = .utility
        grabs.maxConcurrentOperationCount = width
    }

    enum Outcome {
        case frame(URL, pts: Int64?)
        /// The keyframe at the live edge is still the one `shownPts` names; nothing was written.
        case unchanged
        /// Nothing came: `opened` false when the source would not even open.
        case none(opened: Bool)
        case cancelled
    }

    /// The channel's frame now, decoded in turn. The completion runs on the queue's thread.
    func request(channelId: String, inputUrl: String, headers: [String: String], deadline: TimeInterval = defaultDeadline,
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
        grabs.addOperation { [self] in
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
            let name = "\(Self.filePrefix)\(Int64(started.timeIntervalSince1970 * 1000)).jpg"
            let result = grabber.liveFrame(named: name, unlessPts: shownPts)
            watchdog.cancel()
            grabber.stop()
            let elapsed = Date().timeIntervalSince(started)
            lock.lock()
            running[channelId] = nil
            let stoppedMidway = cancelled.contains(channelId)
            lock.unlock()
            if stoppedMidway {
                if case .frame(let file, _) = result { try? FileManager.default.removeItem(at: file) }
                NSLog("[LiveFrame] %@", String(format: "%@ cancelled %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                completion(.cancelled)
                return
            }
            switch result {
            case .frame(let file, let pts):
                Self.removeOthers(in: location, keeping: file)
                NSLog("[LiveFrame] %@", String(format: "%@ %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                completion(.frame(file, pts: pts))
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

    /// The newest frame on disk for each channel that has one, by the time in its name. A reload
    /// or a relaunch reads these before any grab, so a card never loses the picture it had.
    func latest(channelIds: [String]) -> [String: URL] {
        var found: [String: URL] = [:]
        for channelId in channelIds {
            guard let location = ChapterFramePool.location(for: channelId, in: root),
                  let entries = try? FileManager.default.contentsOfDirectory(at: location, includingPropertiesForKeys: nil) else { continue }
            let frames = entries.filter { $0.lastPathComponent.hasPrefix(Self.filePrefix) }
            if let newest = frames.max(by: { Self.stamp($0) < Self.stamp($1) }) { found[channelId] = newest }
        }
        return found
    }

    /// The grab time a frame's name carries, 0 for a name without one.
    static func stamp(_ url: URL) -> Int64 {
        Int64(url.deletingPathExtension().lastPathComponent.dropFirst(filePrefix.count)) ?? 0
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

    /// The channel keeps one live frame: the one just written.
    private static func removeOthers(in directory: URL, keeping kept: URL) {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for entry in entries where entry.lastPathComponent.hasPrefix(filePrefix) && entry.lastPathComponent != kept.lastPathComponent {
            try? FileManager.default.removeItem(at: entry)
        }
    }
}
