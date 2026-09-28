//
//  LiveFrameQueue.swift
//  TomoTV
//
//  A burst per live channel on request, for the guide's cards: keyframes sampled `interval`
//  stream seconds apart across `span`, kept in the chapter frame pool under time-named files.
//  Jobs run one at a time on a low-priority queue of their own, so a dead origin never stalls
//  the library's posters, and a watchdog stops a grab at its deadline.
//

import Foundation

final class LiveFrameQueue {
    static let defaultDeadline: TimeInterval = 8
    /// A burst is valid this long after its files were written or last re-verified (their
    /// modification date). Mirrored by LIVE_FRAME_EXPIRY_MS in services/liveFrames.ts.
    static let expiryMs: Int64 = 30 * 60 * 1000
    /// Files outlive their validity by this much, so a card never paints a file already gone.
    static let diskGraceMs: Int64 = 60 * 1000
    private static let filePrefix = "live-"

    /// Grabs in flight at once, across distinct hosts; same-host jobs serialize on their host's queue.
    static let maxConcurrent = 2

    private let root: URL
    let queue = DispatchQueue(label: "tv.tomo.liveframes", qos: .utility)
    private let slots = DispatchSemaphore(value: LiveFrameQueue.maxConcurrent)
    private let lock = NSLock()
    private var cancelled = Set<String>()
    /// Channels with a request queued or running; a second request for one joins nothing and answers cancelled.
    private var pending = Set<String>()
    /// The grabber reading each channel now, so a cancel stops its read instead of waiting it out.
    private var running: [String: FrameGrabber] = [:]
    /// One serial queue per origin host: providers refuse same-host concurrency, distinct hosts run together.
    private var hostQueues: [String: DispatchQueue] = [:]
    /// The next sweep, due when the oldest burst left on disk expires. Touched on `queue` only.
    private var sweepItem: DispatchWorkItem?
    private var sweepDueMs: Int64?

    init(root: URL = ChapterFramePool.root) {
        self.root = root
        queue.async { [weak self] in self?.sweep() }
    }

    private func hostQueue(for inputUrl: String) -> DispatchQueue {
        let host = URL(string: inputUrl)?.host ?? "-"
        lock.lock()
        defer { lock.unlock() }
        if let held = hostQueues[host] { return held }
        let made = DispatchQueue(label: "tv.tomo.liveframes.\(host)", qos: .utility)
        hostQueues[host] = made
        return made
    }

    /// One open yields a burst: a keyframe, then one per `defaultInterval` stream seconds across `defaultSpan`.
    static let defaultSpan: TimeInterval = 36
    static let defaultInterval: TimeInterval = 3
    static let defaultCount = 12

    enum Outcome {
        /// The burst in order, its preview clip when one was written, the first keyframe's pts.
        case frames([URL], clip: URL?, pts: Int64?)
        /// The keyframe at the live edge is still the one `shownPts` names; nothing was written.
        /// `onDisk` false when the shown burst's files are gone, so there is nothing to re-verify.
        case unchanged(onDisk: Bool)
        /// Nothing came: `opened` false when the source would not even open, `failure` its words.
        case none(opened: Bool, failure: String?)
        case cancelled
    }

    /// The channel's burst now, decoded in turn, with a `clipSpan` preview clip when over zero.
    /// `shownFile` names a frame of the burst on screen, the one an unchanged answer re-verifies.
    /// `frame` announces each burst file as it is written; it and the completion run on the queue's thread.
    func request(channelId: String, inputUrl: String, headers: [String: String], deadline: TimeInterval = defaultDeadline,
                 span: TimeInterval = defaultSpan, interval: TimeInterval = defaultInterval, count: Int = defaultCount,
                 clipSpan: TimeInterval = 0,
                 shownPts: Int64? = nil, shownFile: URL? = nil, frame: ((URL, Int) -> Void)? = nil, completion: @escaping (Outcome) -> Void) {
        guard let location = ChapterFramePool.location(for: channelId, in: root) else {
            completion(.none(opened: true, failure: nil))
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
        hostQueue(for: inputUrl).async { [self] in
            slots.wait()
            defer { slots.signal() }
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
                completion(.none(opened: true, failure: nil))
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
            let result = grabber.liveBurst(named: base, span: span, interval: interval, count: max(1, count), wall: deadline,
                                           clipSpan: clipSpan, unlessPts: shownPts, onFrame: frame)
            watchdog.cancel()
            grabber.stop()
            let elapsed = Date().timeIntervalSince(started)
            lock.lock()
            running[channelId] = nil
            let stoppedMidway = cancelled.contains(channelId)
            lock.unlock()
            if stoppedMidway {
                // Frames already written stay: the card was told about each as it landed.
                NSLog("[LiveFrame] %@", String(format: "%@ cancelled %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                completion(.cancelled)
                return
            }
            switch result {
            case .frames(let files, let clip, let pts):
                queue.sync {
                    Self.removeOthers(in: location, keeping: files)
                    sweepNoLaterThan(Self.nowMs() + Self.expiryMs + Self.diskGraceMs)
                }
                let clipBytes = clip.flatMap { (try? FileManager.default.attributesOfItem(atPath: $0.path))?[.size] as? Int } ?? 0
                NSLog("[LiveFrame] %@", String(format: "%@ %d frames clip %@ %d packets %d bytes %.0fms %.2fs %lld bytes", channelId, files.count,
                                                 grabber.clipMode, grabber.clipPackets, clipBytes, grabber.clipMs, elapsed, grabber.bytesRead))
                completion(.frames(files, clip: clip, pts: pts))
            case .unchanged:
                // The shown burst was just verified live: its files restart their validity.
                let onDisk = queue.sync { () -> Bool in
                    let touched = Self.touch(burstOf: shownFile, in: location)
                    if touched { sweepNoLaterThan(Self.nowMs() + Self.expiryMs + Self.diskGraceMs) }
                    return touched
                }
                NSLog("[LiveFrame] %@", String(format: "%@ unchanged %.2fs %lld bytes onDisk=%d", channelId, elapsed, grabber.bytesRead, onDisk ? 1 : 0))
                completion(.unchanged(onDisk: onDisk))
            case .none:
                NSLog("[LiveFrame] %@", String(format: "%@ none %.2fs opened=%d %@ %@", channelId, elapsed, grabber.sourceOpened ? 1 : 0,
                                                 grabber.openFailure ?? "no keyframe", grabber.openedUrl ?? inputUrl))
                completion(.none(opened: grabber.sourceOpened, failure: grabber.openFailure))
            }
        }
    }

    /// The newest burst on disk for each channel whose burst is still valid, in order, its clip, and
    /// the time its validity counts from. A reload or a relaunch reads these before any grab, so a
    /// card never loses the picture it had.
    func latest(channelIds: [String], now: Date = Date()) -> [String: (urls: [URL], clip: URL?, at: Int64)] {
        var found: [String: (urls: [URL], clip: URL?, at: Int64)] = [:]
        let nowMs = Self.ms(now)
        for channelId in channelIds {
            guard let location = ChapterFramePool.location(for: channelId, in: root),
                  let newest = Self.bursts(in: location).max(by: { $0.stamp < $1.stamp }),
                  nowMs - newest.at <= Self.expiryMs else { continue }
            let ordered = newest.urls.sorted { Self.index($0) < Self.index($1) }
            found[channelId] = (ordered.filter { !Self.isClip($0) }, ordered.first(where: Self.isClip), newest.at)
        }
        return found
    }

    /// Takes every burst past its validity and the grace off disk, in every channel, and schedules
    /// the next pass for when the oldest one left expires. Runs on `queue`.
    @discardableResult
    func sweep(now: Date = Date()) -> Int64? {
        let fm = FileManager.default
        let nowMs = Self.ms(now)
        var nextDue: Int64?
        let items = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for item in items {
            let bursts = Self.bursts(in: item)
            guard !bursts.isEmpty else { continue }
            var removed = false
            for burst in bursts {
                let due = burst.at + Self.expiryMs + Self.diskGraceMs
                if due <= nowMs {
                    for url in burst.urls { try? fm.removeItem(at: url) }
                    removed = true
                } else {
                    nextDue = min(nextDue ?? due, due)
                }
            }
            // Only a directory this pass emptied goes: an empty one found may be awaiting its first frame.
            if removed, (try? fm.contentsOfDirectory(atPath: item.path))?.isEmpty == true {
                try? fm.removeItem(at: item)
            }
        }
        sweepItem?.cancel()
        sweepItem = nil
        sweepDueMs = nil
        if let nextDue { sweepNoLaterThan(nextDue) }
        return nextDue
    }

    /// Arms the sweep for `dueMs` unless one is already due sooner. Runs on `queue`.
    private func sweepNoLaterThan(_ dueMs: Int64) {
        if let armed = sweepDueMs, armed <= dueMs { return }
        sweepItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.sweep() }
        sweepItem = item
        sweepDueMs = dueMs
        // Wall clock: the deadline holds across device sleep, which uptime-based timers skip.
        let delay = max(0, Double(dueMs - Self.nowMs()) / 1000)
        queue.asyncAfter(wallDeadline: .now() + delay, execute: item)
    }

    /// Restarts the validity of the burst `file` belongs to (its clip included), else the channel's
    /// newest; false when that burst is not on disk.
    static func touch(burstOf file: URL?, in location: URL, now: Date = Date()) -> Bool {
        let all = bursts(in: location)
        let target = if let file { all.first { $0.stamp == stamp(file) } } else { all.max { $0.stamp < $1.stamp } }
        guard let target else { return false }
        var touched = true
        for url in target.urls where (try? FileManager.default.setAttributes([.modificationDate: now], ofItemAtPath: url.path)) == nil {
            touched = false
        }
        return touched
    }

    /// The channel directory's bursts: files grouped by the grab stamp in their names, each dated by
    /// its earliest modification date, the moment its validity counts from.
    static func bursts(in location: URL) -> [(stamp: Int64, urls: [URL], at: Int64)] {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let entries = try? FileManager.default.contentsOfDirectory(at: location, includingPropertiesForKeys: keys) else { return [] }
        var grouped: [Int64: (urls: [URL], at: Int64)] = [:]
        for url in entries where url.lastPathComponent.hasPrefix(filePrefix) {
            let modified = (try? url.resourceValues(forKeys: Set(keys)))?.contentModificationDate
            let at = modified.map(ms) ?? stamp(url)
            let key = stamp(url)
            let held = grouped[key]
            grouped[key] = ((held?.urls ?? []) + [url], min(held?.at ?? at, at))
        }
        return grouped.map { (stamp: $0.key, urls: $0.value.urls, at: $0.value.at) }
    }

    private static func ms(_ date: Date) -> Int64 {
        Int64(date.timeIntervalSince1970 * 1000)
    }

    private static func nowMs() -> Int64 {
        ms(Date())
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

    /// The burst's preview clip (`live-<ms>-clip.mp4`) rather than one of its frames.
    static func isClip(_ url: URL) -> Bool {
        url.pathExtension == "mp4"
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

    /// The channel keeps the burst just written and the one before it: a card can still be loading
    /// a frame of the last burst when the new one lands.
    private static func removeOthers(in directory: URL, keeping kept: [URL]) {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        let frames = entries.filter { $0.lastPathComponent.hasPrefix(filePrefix) }
        let keptStamp = kept.first.map(stamp) ?? 0
        let previous = frames.map(stamp).filter { $0 < keptStamp }.max()
        for entry in frames where stamp(entry) != keptStamp && stamp(entry) != previous {
            try? FileManager.default.removeItem(at: entry)
        }
    }
}
