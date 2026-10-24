//
//  LiveFrameQueue.swift
//  TomoTV
//
//  A burst per live channel on request, for the guide's cards: keyframes sampled `interval`
//  stream seconds apart across `span`, kept in the chapter frame pool under time-named files.
//  Jobs run one at a time on a low-priority queue of their own, so a dead origin never stalls
//  the library's posters. A grab fights for its read: it waits for a connection on its provider,
//  tries a refused open again every second while the provider may still count a read it admitted
//  to us, and once the origin serves it has `deadline` for its pictures and clip, a watchdog
//  stopping the read at it; the clip keeps its span and a grace from its first keyframe. An open
//  the origin admitted and has not served yet waits on the origin: it serves, or ends the open itself.
//

import Foundation

// FFmpeg's error macros don't survive the Clang importer.
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')
private let SWIFT_AVERROR_INVALIDDATA: Int32 = -1_094_995_529 // FFERRTAG('I','N','D','A')

final class LiveFrameQueue {
    static let defaultDeadline: TimeInterval = 8
    /// A burst is valid this long after its files were written or last re-verified (their
    /// modification date). Mirrored by LIVE_FRAME_EXPIRY_MS in @keiver/tomo-live's src/liveFrames.ts.
    static let expiryMs: Int64 = 30 * 60 * 1000
    /// Files outlive their validity by this much, so a card never paints a file already gone.
    static let diskGraceMs: Int64 = 60 * 1000
    private static let filePrefix = "live-"

    /// Grabs in flight at once, across distinct hosts; same-host jobs serialize on their host's queue.
    static let maxConcurrent = 2
    /// A refused open is tried again this far apart while a read the provider admitted to us closed within the
    /// deadline: a provider keeps counting a closed read until it next writes to it (measured on Dispatcharr: 1 to
    /// 1.5 s on a flowing feed, up to 10 s while the feed stalls). A refusal with no such read is the answer.
    static let refusalRetryWait: TimeInterval = 1

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

    private func hostQueue(for host: String) -> DispatchQueue {
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
    static let defaultCount = 8

    enum Outcome {
        /// The burst in order, its preview clip when one was written, the first keyframe's pts.
        case frames([URL], clip: URL?, pts: Int64?)
        /// The keyframe at the live edge is still the one `shownPts` names; nothing was written.
        /// `onDisk` false when the shown burst's files are gone, so there is nothing to re-verify.
        case unchanged(onDisk: Bool)
        /// Nothing came: `opened` false when the source would not even open, `failure` its words, `ended` when the
        /// origin itself ended an open it had admitted (closed it, or served no stream), the channel's own answer.
        case none(opened: Bool, failure: String?, ended: Bool)
        /// The source opened and listed no streams: an origin serving nothing, judged by channel health.
        case empty
        /// The provider turned the open away (a 4xx or 5xx, never a 404), retried while it may still have counted a
        /// read it admitted to us: its connections are taken, which says nothing of the channel.
        case refused(failure: String?)
        /// No connection spare on the provider for a sweep read: nothing was asked of it, the channel stays due.
        case busy
        case cancelled
    }

    /// Whether the origin ended an open it admitted: the connection closed or served no stream. Our own cut, a
    /// silent socket and an HTTP refusal are not the channel's answer.
    static func originEnded(_ code: Int32?) -> Bool {
        guard let code else { return false }
        return [SWIFT_AVERROR_EOF, SWIFT_AVERROR_INVALIDDATA, -EIO, -ECONNRESET, -EPIPE].contains(code)
    }

    /// Whether the grabber's open was turned away by the provider rather than failing on the channel.
    private static func refusedOpen(_ grabber: FrameGrabber) -> Bool {
        !grabber.sourceOpened && grabber.openError.map(RemuxSession.httpOpenErrors.contains) == true
    }

    /// The channel's burst now, decoded in turn, with a `clipSpan` preview clip when over zero.
    /// `shownFile` names a frame of the burst on screen, the one an unchanged answer re-verifies.
    /// `frame` announces each burst file as it is written; it and the completion run on the queue's thread.
    /// `onOriginServed` runs before completion if the original input delivers a body; never for the fallback.
    /// `originKey` names the provider whose connection budget the read spends (the URL's host when nil); no free
    /// slot answers busy, so the channel stays due. `fallbackUrl` (the channel through the server) is read once
    /// when the input itself does not open, in the time the deadline has left.
    func request(channelId: String, inputUrl: String, headers: [String: String], deadline: TimeInterval = defaultDeadline,
                 span: TimeInterval = defaultSpan, interval: TimeInterval = defaultInterval, count: Int = defaultCount,
                 clipSpan: TimeInterval = 0, originKey: String? = nil, priority: LiveConnectionBroker.Priority = .sweep, fallbackUrl: String? = nil,
                 shownPts: Int64? = nil, shownFile: URL? = nil, onOriginServed: (() -> Void)? = nil,
                 frame: ((URL, Int) -> Void)? = nil, completion: @escaping (Outcome) -> Void) {
        guard let location = ChapterFramePool.location(for: channelId, in: root) else {
            completion(.none(opened: true, failure: nil, ended: false))
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
        let key = originKey ?? LiveConnectionBroker.key(forURL: inputUrl)
        hostQueue(for: key).async { [self] in
            // Declared first so it runs last: the caller hears once the lease, `pending` and the slot are free.
            var outcome = Outcome.cancelled
            defer { completion(outcome) }
            slots.wait()
            defer { slots.signal() }
            defer {
                lock.lock()
                pending.remove(channelId)
                lock.unlock()
            }
            if isCancelled(channelId) || ChapterFramePool.epoch != epoch {
                outcome = .cancelled
                return
            }
            guard let directory = ChapterFramePool.directory(for: channelId, in: root) else {
                outcome = .none(opened: true, failure: nil, ended: false)
                return
            }
            // The sweep waits for a connection to free, taking none from anyone; none within the deadline is busy.
            guard let lease = LiveConnectionBroker.shared.acquire(key: key, priority: priority, timeout: deadline, onRevoke: { [weak self] in self?.cancel(channelId: channelId) }) else {
                outcome = .busy
                return
            }
            // A read the origin only ever refused was never counted by it, so its close is no recent close.
            var served = false
            defer { lease.release(counted: served) }
            let shared = LiveConnectionBroker.shared.sharesUnknownOrigin(lease)
            let started = Date()
            let base = "\(Self.filePrefix)\(Int64(started.timeIntervalSince1970 * 1000))"
            var grabber: FrameGrabber!
            var watchdog: DispatchWorkItem?
            var watchdogDue = Date.distantPast
            /// Stops the read `seconds` from now, never sooner than it already would. Called on the grabber's thread while
            /// the host queue waits in `liveBurst`, so nothing else touches the watchdog meanwhile.
            func stopRead(_ made: FrameGrabber, in seconds: TimeInterval) {
                let due = Date().addingTimeInterval(seconds)
                guard due > watchdogDue else { return }
                watchdog?.cancel()
                let guard_ = DispatchWorkItem { [weak made] in made?.stop() }
                watchdog = guard_
                watchdogDue = due
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds, execute: guard_)
            }
            /// One try at the read: its own grabber, admitted by the origin or not, with the whole deadline once the origin
            /// serves it. Until then the open waits on the origin alone (its silence guard aside): cutting an open the
            /// origin admitted loses a channel that serves late, and a provider that counts the closed read still counts it.
            func attempt() -> FrameGrabber.LiveGrab? {
                let made = FrameGrabber(inputUrl: inputUrl, directory: directory, pool: root, epoch: epoch, httpHeaders: headers, live: true)
                made.reconnects = false
                // Weak: the closure lives on the grabber, a strong capture would keep every grabber alive for good.
                made.onOpened = { LiveConnectionBroker.shared.noteOpened(lease) }
                made.onServed = { [weak made] in
                    if !served { onOriginServed?() }
                    served = true
                    if let made { stopRead(made, in: deadline) }
                }
                lock.lock()
                let stopped = cancelled.contains(channelId)
                if !stopped { running[channelId] = made }
                lock.unlock()
                if stopped { return nil }
                grabber = made
                watchdog?.cancel()
                watchdogDue = .distantPast
                return made.liveBurst(named: base, span: span, interval: interval, count: max(1, count), wall: deadline, clipSpan: clipSpan, unlessPts: shownPts) { [weak made] url, index in
                    // The first keyframe is in: the clip has its span and a grace from here, whatever the deadline has left.
                    if index == 0, clipSpan > 0, let made { stopRead(made, in: clipSpan + FrameGrabber.clipGrace) }
                    frame?(url, index)
                }
            }
            guard var result = attempt() else {
                outcome = .cancelled
                return
            }
            var refused = Self.refusedOpen(grabber)
            var retries = 0
            // The fight: a refused open is asked again every second while the provider may still count a read it admitted
            // to us, until the origin admits it or the fight is lost. A refusal with no such read is the answer.
            while refused, Date().timeIntervalSince(started) + Self.refusalRetryWait < deadline, !isCancelled(channelId),
                  LiveConnectionBroker.shared.recentlyClosed(key: key, within: deadline) {
                retries += 1
                wait(Self.refusalRetryWait, unlessCancelled: channelId)
                if isCancelled(channelId) { break }
                guard let again = attempt() else { break }
                result = again
                refused = Self.refusedOpen(grabber)
            }
            if refused, !isCancelled(channelId), let code = grabber.openError {
                // A fight lost beside a preview: the preview yields; a 4xx from the origin teaches its budget.
                LiveConnectionBroker.shared.noteLostFight(of: lease, channel: channelId, learn: RemuxSession.limitErrors.contains(code))
            }
            let left = deadline - Date().timeIntervalSince(started)
            // Channel health judges the origin by its own failure, never by the server copy's.
            let origin = (opened: grabber.sourceOpened, failure: grabber.openFailure, url: grabber.openedUrl ?? inputUrl, error: grabber.openError)
            var fellBack = false
            // The server reads the channel on the same account, so a refusal is never asked of it.
            if case .none = result, !grabber.sourceOpened, !refused, let fallbackUrl, !fallbackUrl.isEmpty, fallbackUrl != inputUrl, left > 1, !isCancelled(channelId) {
                grabber.stop()
                let fallback = FrameGrabber(inputUrl: fallbackUrl, directory: directory, pool: root, epoch: epoch, httpHeaders: [:], live: true)
                fallback.reconnects = false
                watchdog?.cancel()
                watchdogDue = .distantPast
                // The server copy has the same read bound, but teaches nothing about the origin's connections.
                fallback.onServed = { [weak fallback] in
                    if let fallback { stopRead(fallback, in: left) }
                }
                lock.lock()
                running[channelId] = fallback
                lock.unlock()
                grabber = fallback
                fellBack = true
                result = fallback.liveBurst(named: base, span: span, interval: interval, count: max(1, count), wall: left,
                                            clipSpan: clipSpan, unlessPts: shownPts) { [weak fallback] url, index in
                    if index == 0, clipSpan > 0, let fallback { stopRead(fallback, in: clipSpan + FrameGrabber.clipGrace) }
                    frame?(url, index)
                }
            }
            watchdog?.cancel()
            // Closed before the lease frees, so a read waiting on the slot never opens beside this one.
            grabber.stopAndClose()
            let elapsed = Date().timeIntervalSince(started)
            // Only a broken input is evidence of a provider kick. Unchanged pictures and a span
            // containing fewer keyframes are successful reads, regardless of the requested count.
            if shared, !fellBack, grabber.sourceOpened, grabber.liveReadEnded, elapsed < deadline - 1, !isCancelled(channelId) {
                switch result {
                case .none: LiveConnectionBroker.shared.noteLost(lease)
                case .frames(let files, _, _) where files.count < max(1, count): LiveConnectionBroker.shared.noteLost(lease)
                default: break
                }
            }
            lock.lock()
            running[channelId] = nil
            let stoppedMidway = cancelled.contains(channelId)
            lock.unlock()
            if stoppedMidway {
                // Frames already written stay: the card was told about each as it landed. The clip was not,
                // and a reload would serve it as the newest on disk.
                if case .frames(_, let clip?, _) = result { try? FileManager.default.removeItem(at: clip) }
                NSLog("[LiveFrame] %@", String(format: "%@ cancelled %.2fs %lld bytes", channelId, elapsed, grabber.bytesRead))
                outcome = .cancelled
                return
            }
            switch result {
            case .frames(let files, let clip, let pts):
                queue.sync {
                    Self.removeOthers(in: location, keeping: files)
                    sweepNoLaterThan(Self.nowMs() + Self.expiryMs + Self.diskGraceMs)
                }
                let clipBytes = clip.flatMap { (try? FileManager.default.attributesOfItem(atPath: $0.path))?[.size] as? Int } ?? 0
                NSLog("[LiveFrame] %@", String(format: "%@ %d frames clip %@ %d packets %d bytes %.0fms (%@) %.2fs %lld bytes", channelId, files.count,
                                                 grabber.clipMode, grabber.clipPackets, clipBytes, grabber.clipMs, grabber.clipEnd, elapsed, grabber.bytesRead))
                outcome = .frames(files, clip: clip, pts: pts)
            case .unchanged:
                // The shown burst was just verified live: its files restart their validity.
                let onDisk = queue.sync { () -> Bool in
                    let touched = Self.touch(burstOf: shownFile, in: location)
                    if touched { sweepNoLaterThan(Self.nowMs() + Self.expiryMs + Self.diskGraceMs) }
                    return touched
                }
                NSLog("[LiveFrame] %@", String(format: "%@ unchanged %.2fs %lld bytes onDisk=%d", channelId, elapsed, grabber.bytesRead, onDisk ? 1 : 0))
                outcome = .unchanged(onDisk: onDisk)
            case .none:
                let judged = fellBack ? origin : (opened: grabber.sourceOpened, failure: grabber.openFailure, url: grabber.openedUrl ?? inputUrl, error: grabber.openError)
                let ended = !judged.opened && Self.originEnded(judged.error)
                NSLog("[LiveFrame] %@", String(format: "%@ %@ %.2fs opened=%d ended=%d %@ %@%@", channelId, refused ? "refused x\(retries + 1)" : "none", elapsed,
                                                 judged.opened ? 1 : 0, ended ? 1 : 0, judged.failure ?? "no keyframe", judged.url,
                                                 fellBack ? " fallback: \(grabber.openFailure ?? "no keyframe")" : ""))
                if refused {
                    outcome = .refused(failure: judged.failure)
                } else {
                    // A fallback runs only when the origin did not open, so an empty answer is always the origin's own.
                    outcome = !fellBack && grabber.sourceEmpty ? .empty : .none(opened: judged.opened, failure: judged.failure, ended: ended)
                }
            }
        }
    }

    /// Sleeps `seconds` in short steps, back as soon as the channel's grab is cancelled.
    private func wait(_ seconds: TimeInterval, unlessCancelled channelId: String) {
        let until = Date().addingTimeInterval(seconds)
        while Date() < until, !isCancelled(channelId) { Thread.sleep(forTimeInterval: 0.1) }
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
            // A clip still named `.part` was never finished; it is neither the clip nor a frame.
            found[channelId] = (ordered.filter { $0.pathExtension == "jpg" }, ordered.first(where: Self.isClip), newest.at)
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
            // Only a directory this pass emptied goes, and never one a grab is about to write into.
            guard removed else { continue }
            lock.lock()
            if !pending.contains(item.lastPathComponent), (try? fm.contentsOfDirectory(atPath: item.path))?.isEmpty == true {
                try? fm.removeItem(at: item)
            }
            lock.unlock()
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
