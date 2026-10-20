import AVFoundation
import XCTest

@testable import TomoEngine

/// The engine's live output through the host's own AVPlayer, served over the loopback the way the
/// app serves it. Answers what only a player can: does it play keyframe-cut long-GOP segments, does
/// it see a declared caption group, and what happens when a pause outlives the window. Opt in with
/// the TOMO_LIVE_SOURCE_* variables of LivePipelineTests.
final class LiveAVPlayerTests: XCTestCase {
    private func serve(_ session: RemuxSession, onRequest: ((String) -> Void)? = nil) throws -> (LocalHTTPServer, URL) {
        try serveOverLoopback(session, onRequest: onRequest)
    }

    @discardableResult
    private func spin(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
        spinMainRunLoop(seconds: seconds, until: condition)
    }

    private func startedSession(source: String, subtitles: [RemuxSubtitle] = [], liveWindowSeconds: Double = 300) throws -> RemuxSession {
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 0, inputUrl: source, subtitles: subtitles, width: 1280, height: 720, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: liveWindowSeconds))
        session.start()
        return session
    }

    /// AVPlayer plays a copied ~10s-GOP source cut on keyframes: ready, then the clock advances.
    func testAVPlayerPlaysKeyframeCutLongGopSegments() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_LONGGOP"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_LONGGOP")
        }
        let session = try startedSession(source: source)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }

        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 90) { player.currentItem?.status == .readyToPlay }, "never ready: \(String(describing: player.currentItem?.error))")
        XCTAssertTrue(spin(seconds: 60) { player.currentTime().seconds >= 8 }, "clock stalled at \(player.currentTime().seconds)s: \(String(describing: player.currentItem?.error))")
        XCTAssertNil(player.currentItem?.error)
    }

    /// The server rung: Jellyfin's live transcode master (EVENT playlist, TS segments) plays in
    /// AVPlayer as returned by PlaybackInfo. Opt in with TOMO_LIVE_SERVER_MASTER=<TranscodingUrl>.
    func testAVPlayerPlaysTheServerLiveMaster() throws {
        guard let master = ProcessInfo.processInfo.environment["TOMO_LIVE_SERVER_MASTER"], let url = URL(string: master) else {
            throw XCTSkip("set TOMO_LIVE_SERVER_MASTER")
        }
        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 90) { player.currentItem?.status == .readyToPlay }, "never ready: \(String(describing: player.currentItem?.error))")
        XCTAssertTrue(spin(seconds: 60) { player.currentTime().seconds >= 8 }, "clock stalled at \(player.currentTime().seconds)s: \(String(describing: player.currentItem?.error))")
        XCTAssertNil(player.currentItem?.error)
    }

    /// The declared caption group reaches AVFoundation as a legible option of the closed-caption kind.
    func testAVPlayerListsTheDeclaredClosedCaptions() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_CC"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_CC")
        }
        let session = try startedSession(source: source)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }

        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 90) { player.currentItem?.status == .readyToPlay }, "never ready: \(String(describing: player.currentItem?.error))")
        let asset = try XCTUnwrap(player.currentItem?.asset)
        var group: AVMediaSelectionGroup?
        let loaded = expectation(description: "legible group")
        asset.loadMediaSelectionGroup(for: .legible) { result, _ in
            group = result
            loaded.fulfill()
        }
        wait(for: [loaded], timeout: 30)
        let options = try XCTUnwrap(group?.options, "no legible group")
        XCTAssertTrue(options.contains { $0.mediaType == .closedCaption }, "no closed-caption option among \(options.map(\.displayName))")
    }

    /// What a subtitle selection is visible as: the item's `tracks` (react-native-video reports text
    /// tracks only when those change) and the subtitle playlist requests the engine serves. Recorded.
    /// Opt in with TOMO_LIVE_SOURCE_TELETEXT (an MPEG-TS or HLS source with a teletext or DVB track).
    func testASubtitleSelectionAsSeenByTracksAndByTheEngine() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_TELETEXT"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_TELETEXT")
        }
        let session = try startedSession(source: source)
        defer { session.stop() }
        let lock = NSLock()
        var subtitleRequests: [String] = []
        var trackChanges = 0
        let (server, url) = try serve(session) { name in
            guard name.hasPrefix("sub") else { return }
            lock.lock()
            subtitleRequests.append(name)
            lock.unlock()
        }
        defer { server.stop() }

        let item = AVPlayerItem(url: url)
        let observation = item.observe(\.tracks, options: [.new]) { _, _ in
            lock.lock()
            trackChanges += 1
            lock.unlock()
        }
        defer { observation.invalidate() }
        let player = AVPlayer(playerItem: item)
        player.play()
        XCTAssertTrue(spin(seconds: 90) { item.status == .readyToPlay }, "never ready: \(String(describing: item.error))")

        var group: AVMediaSelectionGroup?
        let loaded = expectation(description: "legible group")
        item.asset.loadMediaSelectionGroup(for: .legible) { result, _ in
            group = result
            loaded.fulfill()
        }
        wait(for: [loaded], timeout: 30)
        let legible = try XCTUnwrap(group, "no legible group")
        let option = try XCTUnwrap(legible.options.first { $0.mediaType == .subtitle }, "no subtitle option among \(legible.options.map(\.displayName))")

        func snapshot(_ label: String) -> (tracks: Int, requests: [String]) {
            lock.lock()
            defer { lock.unlock() }
            let selected = item.currentMediaSelection.selectedMediaOption(in: legible)?.displayName ?? "none"
            NSLog("[SubtitleSelection] %@: tracks changed %d times, selected %@, subtitle requests %@", label, trackChanges, selected, subtitleRequests.joined(separator: " "))
            return (trackChanges, subtitleRequests)
        }

        spin(seconds: 8) { false }
        let settled = snapshot("settled")
        item.select(option, in: legible)
        spin(seconds: 14) { false }
        let selected = snapshot("selected")
        item.select(nil, in: legible)
        spin(seconds: 6) { false }
        let deselected = snapshot("deselected +6s")
        spin(seconds: 14) { false }
        let later = snapshot("deselected +20s")
        item.select(option, in: legible)
        spin(seconds: 8) { false }
        let reselected = snapshot("reselected")
        NSLog("[SubtitleSelection] requests while selected %d, first 6s after deselect %d, next 14s %d, after reselect %d; track changes on select %d, on deselect %d",
              selected.requests.count - settled.requests.count, deselected.requests.count - selected.requests.count,
              later.requests.count - deselected.requests.count, reselected.requests.count - later.requests.count,
              selected.tracks - settled.tracks, deselected.tracks - selected.tracks)
    }

    /// A pause that outlives the window: the engine prunes what the player had, and the player's
    /// own live handling decides the rest. Recorded, not assumed: the test logs whether the clock
    /// jumped to the edge or the item failed, and fails only if playback does not continue.
    func testAVPlayerRecoversFromAPauseLongerThanTheWindow() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_CC"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_CC (short GOPs, so the window is a known number of seconds)")
        }
        let session = try startedSession(source: source, liveWindowSeconds: 16)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }

        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 90) { player.currentItem?.status == .readyToPlay }, "never ready")
        XCTAssertTrue(spin(seconds: 60) { player.currentTime().seconds >= 4 }, "clock stalled before the pause")
        let pausedAt = player.currentTime().seconds
        player.pause()
        spin(seconds: 30) { false }
        player.play()
        let resumed = spin(seconds: 40) { player.currentTime().seconds >= pausedAt + 6 }
        let now = player.currentTime().seconds
        let error = player.currentItem?.error
        NSLog("[LiveAVPlayerTests] paused at %.1fs for 30s over a 16s window; 40s later the clock reads %.1fs, status %d, error %@",
              pausedAt, now, player.currentItem?.status.rawValue ?? -1, String(describing: error))
        XCTAssertNil(error, "the item failed after the pause: \(String(describing: error))")
        XCTAssertTrue(resumed, "the clock did not move on after the pause: \(pausedAt)s -> \(now)s")
    }
}
