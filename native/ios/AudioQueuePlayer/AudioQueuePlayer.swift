//
//  AudioQueuePlayer.swift
//  TomoTV
//
//  Native music-style queue player: one AVQueuePlayer + one presented
//  AVPlayerViewController for gapless audio track transitions, background
//  playback, lock-screen queue controls, and per-item metadata. JS hands it a
//  flat ordered track list (order/shuffle/loop policy live in JS); the module
//  owns everything with a lifetime longer than the screen — the queue window,
//  the audio session, Now Playing, and the presented UI.
//
//  AVQueuePlayer is forward-only, so only the current + next few tracks are
//  enqueued (it preloads just the next item anyway); previous/skip rebuild the
//  window with fresh AVPlayerItems (played items cannot be re-inserted).
//

import AVFoundation
import AVKit
import CoreMedia
import Foundation
import MediaPlayer
// Required with react-native-tvos's prebuilt React core (React.framework +
// VFS overlay): the bridging header's <React/RCTEventEmitter.h> resolves as
// framework-module content there, so the class only becomes visible to Swift
// through an explicit module import. Compiler-verified 2026-08-10: without
// this line, "cannot find type 'RCTEventEmitter' in scope".
import React
import UIKit

private struct QueueTrack {
    let id: String
    let url: URL
    let title: String
    let artist: String
    let album: String
    /// AVKit's on-screen description line. Kept apart from `album`, which also feeds the
    /// Now Playing album field — "Disc 2 · Track 5" is not an album name.
    let description: String
    let artworkUrl: URL?
    let duration: Double
}

// Subclassing AVPlayerViewController is formally "unsupported", but a
// disappear override for dismissal detection is exactly what
// react-native-video ships (RCTVideoPlayerViewController) — no private API,
// no behavior override beyond observing our own presentation's end.
private final class TomoAudioPlayerViewController: AVPlayerViewController {
    var onWillDismiss: (() -> Void)?
    var onDismissed: (() -> Void)?

    /// Runs ahead of AVKit's own disappear work, so the handler reads the transport state the
    /// user left rather than the one the dismissal imposes.
    override func viewWillDisappear(_ animated: Bool) {
        if isBeingDismissed || presentingViewController == nil {
            onWillDismiss?()
        }
        super.viewWillDisappear(animated)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil {
            onDismissed?()
        }
    }
}

@objc(AudioQueuePlayer)
class AudioQueuePlayer: RCTEventEmitter {

    /// Items enqueued ahead of the current one. AVQueuePlayer only preloads its
    /// immediate successor, so a deeper window buys nothing but memory.
    private static let windowSize = 3
    /// The standard music-player previous rule: restart the track when more
    /// than this many seconds in, otherwise go to the previous track.
    private static let previousRestartThreshold = 3.0

    private var tracks: [QueueTrack] = []
    private var currentIndex = 0
    private var loop = false
    private var active = false

    private var player: AVQueuePlayer?
    private var playerVC: TomoAudioPlayerViewController?
    private var enqueued: [(item: AVPlayerItem, index: Int)] = []
    private let nowPlaying = NowPlayingCoordinator()

    private var timeObserverToken: Any?
    private var currentItemObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?

    private var hasEmittedFirstTrack = false
    private var naturalEndPending = false
    /// True between removeAllItems() and the first fresh insert of a window
    /// rebuild: the removal fires a currentItem→nil KVO change that must not
    /// be read as the queue running dry.
    private var rebuildInProgress = false
    private var pendingSkipPosition: Double?
    private var lastObservedPosition: Double = 0
    private var programmaticDismiss = false
    /// Shared by the tvOS will-dismiss callback and the viewDidDisappear fallback so one user
    /// dismissal can never make JS pop twice.
    private var dismissEventEmitted = false
    /// Playback state sampled before AVKit's dismissal pause, so a track paused in its transport
    /// bar is not restarted by the dismissal. tvOS samples it in the delegate, iPhone in
    /// viewWillDisappear — AVKit declares the dismissal callbacks tvOS-only.
    private var resumeAfterDismissal = false
    /// One-shot latch for onQueueEnded; see endQueue(natural:). Reset with the
    /// rest of the queue state in loadQueue and stopInternal.
    private var queueEndedEmitted = false
    /// Artwork bytes by URL, shared by player-item metadata, Now Playing and the
    /// Up Next cells.
    ///
    /// NSCache with a byte-cost limit rather than a dictionary: this used to grow
    /// without bound for the life of a queue, and a long album's worth of
    /// full-size art is megabytes, so the bound has to be in bytes — a count
    /// limit would not actually cap it. Every reader tolerates a miss (artwork
    /// simply does not refresh), so eviction is safe.
    private let artworkCache: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.totalCostLimit = 32 * 1024 * 1024
        return cache
    }()
    #if os(tvOS)
    private weak var upNextPanel: UpNextPanelViewController?
    #endif

    // Override required: the react-native-tvos fork's RCTEventEmitter exposes
    // this class method (compiler-verified — plain RN core does not).
    @objc override static func requiresMainQueueSetup() -> Bool { false }

    // RCTEventEmitter.h carries no nullability audit, so the imported Swift
    // signature is the implicitly-unwrapped [String]!.
    override func supportedEvents() -> [String]! {
        ["onTrackChanged", "onProgress", "onQueueEnded", "onDismiss", "onError"]
    }

    override func invalidate() {
        DispatchQueue.main.async { self.stopInternal() }
        super.invalidate()
    }

    // MARK: - Bridge API

    /// Start a queue. Config keys:
    ///   tracks: [{id, url, title, artist, album, description, artworkUrl, durationSeconds}]
    ///   startIndex: Int
    ///   startPositionSeconds: Double — resume offset within the start track
    ///   loop: Bool — wrap at queue end (shuffle-infinite mode)
    @objc func loadQueue(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let parsed: [QueueTrack] = ((config["tracks"] as? [[String: Any]]) ?? []).compactMap { raw in
            guard let id = raw["id"] as? String,
                  let urlString = raw["url"] as? String,
                  let url = URL(string: urlString) else { return nil }
            let artworkUrl = (raw["artworkUrl"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
            return QueueTrack(
                id: id,
                url: url,
                title: raw["title"] as? String ?? "",
                artist: raw["artist"] as? String ?? "",
                album: raw["album"] as? String ?? "",
                description: raw["description"] as? String ?? "",
                artworkUrl: artworkUrl,
                duration: raw["durationSeconds"] as? Double ?? 0
            )
        }
        guard !parsed.isEmpty else {
            reject("invalid_config", "loadQueue needs a non-empty tracks array with id and url on every track", nil)
            return
        }
        let startIndex = min(max(config["startIndex"] as? Int ?? 0, 0), parsed.count - 1)
        let startPosition = config["startPositionSeconds"] as? Double ?? 0
        let loopFlag = config["loop"] as? Bool ?? false

        DispatchQueue.main.async {
            self.stopInternal()

            self.tracks = parsed
            self.currentIndex = startIndex
            self.loop = loopFlag
            self.active = true
            self.hasEmittedFirstTrack = false
            self.queueEndedEmitted = false

            do {
                try AVAudioSession.sharedInstance().setCategory(.playback)
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                self.active = false
                reject("audio_session", "Could not activate the audio session: \(error.localizedDescription)", error)
                return
            }

            let queuePlayer = AVQueuePlayer()
            self.player = queuePlayer
            self.attachObservers(to: queuePlayer)
            self.attachSessionObservers()
            self.configureNowPlaying(for: queuePlayer)

            // Observers are attached before the first insert so the initial
            // currentItem change flows through the same handler as every
            // later advance.
            self.fillWindow(from: startIndex)
            self.presentUI()

            if startPosition > 0 {
                queuePlayer.seek(to: CMTime(seconds: startPosition, preferredTimescale: 600))
                self.lastObservedPosition = startPosition
            }
            queuePlayer.play()
            resolve(nil)
        }
    }

    @objc func play(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            // After an interruption that ended without shouldResume the session
            // may be inactive; reactivating on explicit play is harmless
            // otherwise.
            try? AVAudioSession.sharedInstance().setActive(true)
            self.player?.play()
            resolve(nil)
        }
    }

    @objc func pause(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.player?.pause()
            resolve(nil)
        }
    }

    @objc func next(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.skipForward()
            resolve(nil)
        }
    }

    @objc func previous(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.skipBackward()
            resolve(nil)
        }
    }

    @objc func seekTo(
        _ seconds: Double,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            guard let player = self.player else {
                resolve(nil)
                return
            }
            player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) { _ in
                DispatchQueue.main.async {
                    self.lastObservedPosition = seconds
                    self.nowPlaying.updatePlayback(elapsed: seconds, rate: player.rate)
                    self.emitProgress()
                    resolve(nil)
                }
            }
        }
    }

    @objc func skipToIndex(
        _ index: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            let target = index.intValue
            guard target >= 0, target < self.tracks.count else {
                reject("out_of_range", "skipToIndex \(target) outside 0..\(self.tracks.count - 1)", nil)
                return
            }
            self.skip(to: target)
            resolve(nil)
        }
    }

    /// Re-present the player UI for a queue that kept playing after the user
    /// dismissed it (background music re-entry).
    @objc func present(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard self.active else {
                reject("not_active", "No audio queue is playing", nil)
                return
            }
            if self.playerVC == nil {
                self.presentUI()
            }
            resolve(nil)
        }
    }

    @objc func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.stopInternal()
            resolve(nil)
        }
    }

    @objc func getState(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            resolve([
                "active": self.active,
                "index": self.currentIndex,
                "position": self.lastObservedPosition,
                "playing": (self.player?.rate ?? 0) > 0,
            ])
        }
    }

    // MARK: - Queue window

    private func fillWindow(from index: Int) {
        guard let player else { return }
        let upper = min(index + Self.windowSize, tracks.count - 1)
        for i in index...upper {
            let item = makeItem(for: i)
            if player.canInsert(item, after: nil) {
                player.insert(item, after: nil)
                enqueued.append((item, i))
            }
        }
    }

    private func topUpWindow() {
        guard let player else { return }
        while let last = enqueued.last, last.index < min(currentIndex + Self.windowSize, tracks.count - 1) {
            let nextIndex = last.index + 1
            let item = makeItem(for: nextIndex)
            guard player.canInsert(item, after: nil) else { break }
            player.insert(item, after: nil)
            enqueued.append((item, nextIndex))
        }
    }

    private func rebuildWindow(from index: Int) {
        guard let player else { return }
        rebuildInProgress = true
        player.removeAllItems()
        enqueued.removeAll()
        fillWindow(from: index)
        player.play()
    }

    private func makeItem(for index: Int) -> AVPlayerItem {
        let track = tracks[index]
        let item = AVPlayerItem(url: track.url)
        var metadata: [AVMetadataItem] = [
            stringMetadata(.commonIdentifierTitle, track.title),
        ]
        if !track.artist.isEmpty {
            metadata.append(stringMetadata(.commonIdentifierArtist, track.artist))
        }
        if !track.description.isEmpty {
            metadata.append(stringMetadata(.commonIdentifierDescription, track.description))
        }
        item.externalMetadata = metadata
        loadArtwork(for: index, into: item)
        return item
    }

    // MARK: - Playback movement

    /// Returns whether the queue actually moved. False means there was nowhere
    /// to go — the last track with no loop — which is a no-op for a user-driven
    /// skip but has to become an ending when the current track just failed.
    @discardableResult
    private func skipForward() -> Bool {
        guard let player else { return false }
        if currentIndex < tracks.count - 1 {
            pendingSkipPosition = player.currentTime().seconds
            topUpWindow()
            player.advanceToNextItem()
            return true
        }
        if loop, tracks.count > 1 {
            skip(to: 0)
            return true
        }
        // Last track without loop: skip forward is a no-op; the track keeps
        // playing to its natural end.
        return false
    }

    private func skipBackward() {
        guard let player else { return }
        let position = player.currentTime().seconds
        if position > Self.previousRestartThreshold || currentIndex == 0 {
            player.seek(to: .zero) { _ in
                DispatchQueue.main.async {
                    self.lastObservedPosition = 0
                    self.nowPlaying.updatePlayback(elapsed: 0, rate: player.rate)
                    self.emitProgress()
                }
            }
        } else {
            skip(to: currentIndex - 1)
        }
    }

    private func skip(to index: Int) {
        guard let player else { return }
        pendingSkipPosition = player.currentTime().seconds
        rebuildWindow(from: index)
    }

    // MARK: - Observers

    private func attachObservers(to player: AVQueuePlayer) {
        currentItemObservation = player.observe(\.currentItem, options: [.old, .new]) { [weak self] _, change in
            DispatchQueue.main.async {
                self?.handleCurrentItemChange(newItem: change.newValue ?? nil)
            }
        }

        rateObservation = player.observe(\.rate, options: [.new]) { [weak self] player, _ in
            DispatchQueue.main.async {
                guard let self, self.active else { return }
                self.nowPlaying.updatePlayback(elapsed: self.lastObservedPosition, rate: player.rate)
                self.emitProgress()
            }
        }

        timeObserverToken = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self, self.active else { return }
            self.lastObservedPosition = time.seconds
            // AVQueuePlayer does not skip items that fail before ever playing;
            // sweep on the tick so a dead URL cannot wedge the queue.
            if let item = self.player?.currentItem, item.status == .failed {
                self.handleItemFailure(item)
                return
            }
            self.emitProgress()
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidPlayToEnd(_:)),
            name: .AVPlayerItemDidPlayToEndTime,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleFailedToPlayToEnd(_:)),
            name: .AVPlayerItemFailedToPlayToEndTime,
            object: nil
        )
    }

    private func attachSessionObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    private func detachObservers() {
        currentItemObservation?.invalidate()
        currentItemObservation = nil
        rateObservation?.invalidate()
        rateObservation = nil
        if let token = timeObserverToken {
            player?.removeTimeObserver(token)
            timeObserverToken = nil
        }
        NotificationCenter.default.removeObserver(self)
    }

    private func handleCurrentItemChange(newItem: AVPlayerItem?) {
        guard active else { return }

        guard let newItem else {
            // A window rebuild empties the queue on purpose; the fresh insert
            // arrives as the next KVO change.
            if rebuildInProgress { return }
            // Queue ran dry past the last track.
            if loop, !tracks.isEmpty {
                // Natural wrap: rebuild from 0 keeps the session and UI alive;
                // the insert re-enters this handler with the first item.
                rebuildWindow(from: 0)
                return
            }
            let natural = naturalEndPending
            naturalEndPending = false
            endQueue(natural: natural)
            return
        }

        guard let entry = enqueued.first(where: { $0.item === newItem }) else { return }
        rebuildInProgress = false

        let previousIndex = hasEmittedFirstTrack ? currentIndex : -1
        let natural = naturalEndPending
        naturalEndPending = false
        let previousPosition: Double
        if natural, previousIndex >= 0 {
            previousPosition = tracks[previousIndex].duration
        } else {
            previousPosition = pendingSkipPosition ?? lastObservedPosition
        }
        pendingSkipPosition = nil

        currentIndex = entry.index
        lastObservedPosition = 0
        enqueued.removeAll { $0.index < entry.index }
        topUpWindow()
        #if os(tvOS)
        upNextPanel?.reload()
        #endif

        let track = tracks[entry.index]
        nowPlaying.updateTrack(
            NowPlayingCoordinator.TrackInfo(
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: track.duration,
                queueIndex: entry.index,
                queueCount: tracks.count
            ),
            elapsed: 0,
            rate: player?.rate ?? 1
        )
        publishCachedArtwork(for: entry.index)

        // Swift's ternary can't unify String and NSNull; build the mixed-type
        // value explicitly (JS receives string | null).
        let previousTrackId: Any = previousIndex >= 0 ? tracks[previousIndex].id as Any : NSNull()
        sendEvent(withName: "onTrackChanged", body: [
            "index": entry.index,
            "trackId": track.id,
            "previousIndex": previousIndex,
            "previousTrackId": previousTrackId,
            "previousPosition": previousPosition,
            "natural": natural,
        ])
        hasEmittedFirstTrack = true
    }

    /// The queue's single terminal event. Two paths reach it — the queue running
    /// dry past the last track, and the last track failing with nothing to skip
    /// to — and whether AVQueuePlayer also drives currentItem to nil after a
    /// failed final item is not something this code should have to depend on.
    /// The flag makes the outcome the same either way: exactly one onQueueEnded.
    private func endQueue(natural: Bool) {
        guard !queueEndedEmitted else { return }
        queueEndedEmitted = true
        sendEvent(withName: "onQueueEnded", body: ["natural": natural])
    }

    @objc private func handleDidPlayToEnd(_ notification: Notification) {
        DispatchQueue.main.async {
            guard let item = notification.object as? AVPlayerItem,
                  let entry = self.enqueued.first(where: { $0.item === item }),
                  entry.index == self.currentIndex else { return }
            self.naturalEndPending = true
        }
    }

    @objc private func handleFailedToPlayToEnd(_ notification: Notification) {
        DispatchQueue.main.async {
            guard let item = notification.object as? AVPlayerItem else { return }
            self.handleItemFailure(item)
        }
    }

    private func handleItemFailure(_ item: AVPlayerItem) {
        guard active, let entry = enqueued.first(where: { $0.item === item }) else { return }
        let message = item.error?.localizedDescription ?? "Playback failed"
        sendEvent(withName: "onError", body: ["index": entry.index, "message": message])
        // Skip past the broken track rather than wedging the whole queue.
        guard entry.index == currentIndex else { return }
        if !skipForward() {
            // The failed track was the last one and there is nothing to advance
            // to, so nothing will ever move the queue again. Without this JS
            // received onError and then waited forever for a terminal event.
            // Not "natural": the queue stopped because a track broke.
            endQueue(natural: false)
        }
    }

    @objc private func handleInterruption(_ notification: Notification) {
        DispatchQueue.main.async {
            guard let info = notification.userInfo,
                  let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
            switch type {
            case .began:
                self.player?.pause()
            case .ended:
                let options = AVAudioSession.InterruptionOptions(
                    rawValue: (info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
                )
                if options.contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true)
                    self.player?.play()
                }
            @unknown default:
                break
            }
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        DispatchQueue.main.async {
            guard let info = notification.userInfo,
                  let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }
            // Headphones unplugged / speaker vanished: pause instead of blasting
            // the room, matching system player behavior.
            if reason == .oldDeviceUnavailable {
                self.player?.pause()
            }
        }
    }

    private func emitProgress() {
        guard active, currentIndex < tracks.count else { return }
        sendEvent(withName: "onProgress", body: [
            "index": currentIndex,
            "position": lastObservedPosition,
            "duration": tracks[currentIndex].duration,
            "playing": (player?.rate ?? 0) > 0,
        ])
    }

    // MARK: - Now Playing

    private func configureNowPlaying(for player: AVQueuePlayer) {
        nowPlaying.activate(player: player)
        nowPlaying.onPlay = { [weak self] in
            try? AVAudioSession.sharedInstance().setActive(true)
            self?.player?.play()
        }
        nowPlaying.onPause = { [weak self] in self?.player?.pause() }
        nowPlaying.onToggle = { [weak self] in
            guard let player = self?.player else { return }
            if player.rate > 0 {
                player.pause()
            } else {
                try? AVAudioSession.sharedInstance().setActive(true)
                player.play()
            }
        }
        nowPlaying.onNext = { [weak self] in self?.skipForward() }
        nowPlaying.onPrevious = { [weak self] in self?.skipBackward() }
        nowPlaying.onSeek = { [weak self] seconds in
            self?.player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) { _ in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.lastObservedPosition = seconds
                    self.nowPlaying.updatePlayback(elapsed: seconds, rate: self.player?.rate ?? 0)
                    self.emitProgress()
                }
            }
        }
    }

    // MARK: - Presentation

    /// AVKit pauses the player as part of its dismissal. A nil currentItem means the queue ran
    /// dry instead and must stay stopped.
    private func resumeIfPausedByAVKit() {
        guard resumeAfterDismissal, let player, player.timeControlStatus == .paused, player.currentItem != nil else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
    }

    /// AVKit's pause can land either side of the disappear callbacks, so the resume is asserted
    /// again once the transition's completion blocks have run.
    private func restorePlaybackAfterDismissal() {
        resumeIfPausedByAVKit()
        DispatchQueue.main.async {
            self.resumeIfPausedByAVKit()
            self.resumeAfterDismissal = false
        }
    }

    private func emitUserDismissIfNeeded() {
        guard !programmaticDismiss, !dismissEventEmitted else { return }
        dismissEventEmitted = true
        sendEvent(withName: "onDismiss", body: [:])
    }

    private func presentUI() {
        guard let player else { return }
        let vc = TomoAudioPlayerViewController()
        vc.player = player
        vc.modalPresentationStyle = .fullScreen
        #if !os(tvOS)
        // iOS-only property (compiler-verified unavailable on tvOS). Now
        // Playing is owned by NowPlayingCoordinator on both platforms; on tvOS
        // AVKit has no equivalent publisher to switch off.
        vc.updatesNowPlayingInfoCenter = false
        #endif
        vc.delegate = self
        #if !os(tvOS)
        // iPhone's stand-in for the tvOS shouldDismiss sample: the last moment the player still
        // holds the state the user chose. tvOS keeps its delegate sample, taken earlier still.
        vc.onWillDismiss = { [weak self] in
            guard let self, !self.programmaticDismiss else { return }
            let status = self.player?.timeControlStatus
            self.resumeAfterDismissal = status == .playing || status == .waitingToPlayAtSpecifiedRate
        }
        #endif
        vc.onDismissed = { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                self.playerVC = nil
                guard !self.programmaticDismiss else {
                    self.resumeAfterDismissal = false
                    return
                }
                // User dismissal (swipe/✕ on iPhone, Back on tvOS). The queue keeps playing;
                // JS already heard this at will-dismiss on tvOS, and the one-shot makes this
                // second emit harmless there.
                self.restorePlaybackAfterDismissal()
                self.emitUserDismissIfNeeded()
            }
        }

        #if os(tvOS)
        // Remote left/right = previous/next track, the user-confirmed music
        // mapping. .skipItem repurposes AVKit's skip gesture from ±10s seek to
        // queue-item navigation (forward advance handled by AVKit itself and
        // observed via the currentItem KVO). Backward has nothing enqueued to
        // navigate to (the window is forward-only), so a leftArrow recognizer
        // implements previous with the 3s restart rule.
        // DEVICE-VERIFY: if AVKit's own backward handling also acts, drop one
        // of the two — see the plan's device checklist.
        vc.skippingBehavior = .skipItem
        let leftTap = UITapGestureRecognizer(target: self, action: #selector(handleLeftArrowPress))
        leftTap.allowedPressTypes = [NSNumber(value: UIPress.PressType.leftArrow.rawValue)]
        vc.view.addGestureRecognizer(leftTap)

        // Native info-panel "Up Next" tab (swipe down): the remaining queue as
        // focusable artwork cards; selecting one jumps playback there. Only
        // added when something is actually up next.
        if tracks.count > 1 {
            let panel = UpNextPanelViewController()
            panel.entriesProvider = { [weak self] in self?.upcomingEntries() ?? [] }
            panel.onSelect = { [weak self] index in
                guard let self else { return }
                // tvOS 26 presents the info panel from the player VC; close it on
                // selection so the chosen track takes the screen (same behavior
                // as the video player's panel). The guard means dismiss can only
                // take down the panel, never this presented player itself.
                if let vc = self.playerVC, vc.presentedViewController != nil {
                    vc.dismiss(animated: true, completion: nil)
                }
                self.skip(to: index)
            }
            panel.artworkLoader = { [weak self] url, completion in
                self?.fetchArtworkData(url: url, completion: completion)
            }
            vc.customInfoViewControllers = [panel]
            upNextPanel = panel
        }
        #endif

        guard let top = topViewController() else { return }
        programmaticDismiss = false
        dismissEventEmitted = false
        playerVC = vc
        top.present(vc, animated: true)
    }

    @objc private func handleLeftArrowPress() {
        skipBackward()
    }

    #if os(tvOS)
    /// Panel cap: the info panel is a quick-look surface, not a library
    /// browser; NSLog marks the truncation so it never reads as full coverage.
    private static let upNextPanelLimit = 30

    private func upcomingEntries() -> [UpNextPanelViewController.Entry] {
        // Plain arithmetic for the count: lazy sequences (dropFirst on
        // enumerated()) have no `count` property, only count(where:).
        let upcomingCount = tracks.count - (currentIndex + 1)
        guard upcomingCount > 0 else { return [] }
        if upcomingCount > Self.upNextPanelLimit {
            NSLog("[AudioQueuePlayer] Up Next panel capped at %d of %d upcoming tracks", Self.upNextPanelLimit, upcomingCount)
        }
        return tracks.enumerated().dropFirst(currentIndex + 1).prefix(Self.upNextPanelLimit).map { offset, track in
            UpNextPanelViewController.Entry(index: offset, title: track.title, artist: track.artist, artworkURL: track.artworkUrl)
        }
    }
    #endif

    private func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    // MARK: - Teardown

    private func stopInternal() {
        guard player != nil else { return }
        active = false
        resumeAfterDismissal = false
        detachObservers()
        player?.pause()
        player?.removeAllItems()
        nowPlaying.deactivate()

        if let vc = playerVC {
            programmaticDismiss = true
            dismissEventEmitted = true
            vc.presentingViewController?.dismiss(animated: true) { [weak self] in
                self?.programmaticDismiss = false
            }
            playerVC = nil
        }

        player = nil
        enqueued.removeAll()
        #if os(tvOS)
        upNextPanel = nil
        #endif
        tracks = []
        currentIndex = 0
        lastObservedPosition = 0
        pendingSkipPosition = nil
        naturalEndPending = false
        rebuildInProgress = false
        hasEmittedFirstTrack = false
        queueEndedEmitted = false
        artworkCache.removeAllObjects()

        // Deactivating hands audio focus back (music apps that were ducked or
        // paused get their interruption-ended signal).
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Metadata helpers

    private func stringMetadata(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value as NSString
        // "und" (undetermined) keeps the metadata visible on every device
        // locale; a concrete tag hides it on non-matching locales.
        item.extendedLanguageTag = "und"
        return item
    }

    private func artworkMetadata(_ data: Data) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = .commonIdentifierArtwork
        item.value = data as NSData
        let isPNG = data.first == 0x89
        item.dataType = (isPNG ? kCMMetadataBaseDataType_PNG : kCMMetadataBaseDataType_JPEG) as String
        item.extendedLanguageTag = "und"
        return item
    }

    /// Shared artwork fetch: memory-cached by URL string, completion always on
    /// main (synchronously for cache hits). Used by player-item metadata, Now
    /// Playing, and the Up Next panel cells.
    private func fetchArtworkData(url: URL, completion: @escaping (Data?) -> Void) {
        if let cached = artworkCache.object(forKey: url.absoluteString as NSString) {
            completion(cached as Data)
            return
        }
        // A downloaded item's poster is a file in the app container, and dataTask is the HTTP
        // path. Read it directly, off the main thread, then cache it like any other.
        if url.isFileURL {
            DispatchQueue.global(qos: .utility).async { [weak self] in
                let data = try? Data(contentsOf: url)
                DispatchQueue.main.async {
                    guard let data, !data.isEmpty else {
                        completion(nil)
                        return
                    }
                    self?.artworkCache.setObject(data as NSData, forKey: url.absoluteString as NSString, cost: data.count)
                    completion(data)
                }
            }
            return
        }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let data, !data.isEmpty else {
                    completion(nil)
                    return
                }
                // Cost is the byte count, which is what totalCostLimit bounds.
                self?.artworkCache.setObject(data as NSData, forKey: url.absoluteString as NSString, cost: data.count)
                completion(data)
            }
        }.resume()
    }

    private func loadArtwork(for index: Int, into item: AVPlayerItem) {
        guard let url = tracks[index].artworkUrl else { return }
        fetchArtworkData(url: url) { [weak self, weak item] data in
            guard let self, let data else { return }
            item?.externalMetadata.append(self.artworkMetadata(data))
            self.publishCachedArtwork(for: index)
        }
    }

    /// Push the current track's artwork into Now Playing once its bytes exist.
    private func publishCachedArtwork(for index: Int) {
        guard active, index == currentIndex,
              let url = tracks[index].artworkUrl,
              let data = artworkCache.object(forKey: url.absoluteString as NSString),
              let image = UIImage(data: data as Data) else { return }
        nowPlaying.setArtwork(image, elapsed: lastObservedPosition, rate: player?.rate ?? 0)
    }
}

/// tvOS only; AVKit marks both callbacks API_UNAVAILABLE(ios), so iPhone samples and resumes
/// from the subclass's own viewWillDisappear/viewDidDisappear instead.
extension AudioQueuePlayer: AVPlayerViewControllerDelegate {
    #if os(tvOS)
    /// Asked before AVKit begins dismissing, so the player still holds the state the user left it
    /// in: paused here means they paused it, not that the dismissal did.
    func playerViewControllerShouldDismiss(_ playerViewController: AVPlayerViewController) -> Bool {
        let status = player?.timeControlStatus
        resumeAfterDismissal = status == .playing || status == .waitingToPlayAtSpecifiedRate
        return true
    }

    /// Pop the React route while AVKit still covers it. By the time AVKit reveals the app, the
    /// gallery underneath is already the active native-stack screen instead of a black bridge.
    func playerViewControllerWillBeginDismissalTransition(_ playerViewController: AVPlayerViewController) {
        resumeIfPausedByAVKit()
        emitUserDismissIfNeeded()
    }
    #endif
}
