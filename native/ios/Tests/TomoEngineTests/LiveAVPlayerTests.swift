import AVFoundation
import XCTest

@testable import TomoEngine

/// The engine's live output through the host's own AVPlayer, served over the loopback the way the
/// app serves it. Answers what only a player can: does it play keyframe-cut long-GOP segments, does
/// it see a declared caption group, and what happens when a pause outlives the window. Opt in with
/// the TOMO_LIVE_SOURCE_* variables of LivePipelineTests.
final class LiveAVPlayerTests: XCTestCase {
    /// The app's routing (LocalRemuxer.route) for one session.
    private func serve(_ session: RemuxSession) throws -> (LocalHTTPServer, URL) {
        let m3u8 = "application/vnd.apple.mpegurl"
        let server = LocalHTTPServer { path in
            let parts = path.split(separator: "/").map(String.init)
            guard parts.count == 2, parts[0] == session.token else { return .notFound }
            let name = parts[1]
            switch name {
            case "master.m3u8": return .data(Data(session.masterPlaylist().utf8), contentType: m3u8)
            case "media.m3u8": return .data(Data(session.mediaPlaylist().utf8), contentType: m3u8)
            case "init.mp4": return session.initResponse()
            default: break
            }
            if name.hasPrefix("init-g"), name.hasSuffix(".mp4"), let g = Int(name.dropFirst(6).dropLast(4)) { return session.initResponse(generation: g) }
            if name.hasPrefix("seg"), name.hasSuffix(".m4s"), let n = Int(name.dropFirst(3).dropLast(4)) { return session.segmentResponse(n) }
            if name.hasPrefix("sub"), name.hasSuffix(".m3u8"), let i = Int(name.dropFirst(3).dropLast(5)), let playlist = session.subtitlePlaylist(streamIndex: i) {
                return .data(Data(playlist.utf8), contentType: m3u8)
            }
            if name.hasPrefix("sub"), name.hasSuffix(".vtt") { return .data(Data(session.emptySubtitleBody().utf8), contentType: "text/vtt") }
            if name.hasPrefix("a"), let split = name.firstIndex(where: { $0 == "-" || $0 == "." }) {
                let prefix = String(name[name.startIndex..<split])
                guard prefix.count > 1, prefix.dropFirst().allSatisfy(\.isNumber) else { return .notFound }
                let rest = String(name[split...])
                if rest == ".m3u8" { return .data(Data(session.mediaPlaylist(prefix: prefix).utf8), contentType: m3u8) }
                if rest == "-init.mp4" { return session.initResponse(prefix: prefix) }
                if rest.hasPrefix("-init-g"), rest.hasSuffix(".mp4"), let g = Int(rest.dropFirst(7).dropLast(4)) { return session.initResponse(prefix: prefix, generation: g) }
                if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"), let n = Int(rest.dropFirst(4).dropLast(4)) { return session.segmentResponse(n, prefix: prefix) }
            }
            return .notFound
        }
        let port = try server.start()
        return (server, try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/\(session.token)/master.m3u8")))
    }

    /// Spins the main run loop until `condition` holds or the deadline passes.
    @discardableResult
    private func spin(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
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
