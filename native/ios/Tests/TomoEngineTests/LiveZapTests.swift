import AVFoundation
import XCTest

@testable import TomoEngine

/// What a channel change costs through the engine and the host's AVPlayer, per real origin: a cold
/// session on the top variant, the same on the lowest variant, and a session already running when
/// the player binds (a hot neighbour). Recorded, not asserted. Opt in with
/// TOMO_LIVE_ZAP_SOURCES=<path to [{name, top, low}] JSON>.
final class LiveZapTests: XCTestCase {
    private struct Source: Decodable {
        let name: String
        let top: String
        let low: String
    }

    private func serve(_ session: RemuxSession) throws -> (LocalHTTPServer, URL) {
        let m3u8 = "application/vnd.apple.mpegurl"
        let server = LocalHTTPServer { path in
            let parts = path.split(separator: "/").map(String.init)
            guard parts.count == 2, parts[0] == session.token else { return .notFound }
            let name = parts[1]
            if name == "master.m3u8" { return .data(Data(session.masterPlaylist().utf8), contentType: m3u8) }
            if name == "media.m3u8" { return .data(Data(session.mediaPlaylist().utf8), contentType: m3u8) }
            if name == "init.mp4" { return session.initResponse() }
            if name.hasPrefix("init-g"), name.hasSuffix(".mp4"), let g = Int(name.dropFirst(6).dropLast(4)) { return session.initResponse(generation: g) }
            if name.hasPrefix("seg"), name.hasSuffix(".m4s"), let n = Int(name.dropFirst(3).dropLast(4)) { return session.segmentResponse(n) }
            return .notFound
        }
        let port = try server.start()
        return (server, try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/\(session.token)/master.m3u8")))
    }

    private func spin(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        }
        return condition()
    }

    private func session(_ url: String, windowSeconds: Double = 300) throws -> RemuxSession {
        // The app's live segment target (LIVE_SEGMENT_SECONDS in services/localRemux.ts).
        try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: url, codecs: "", width: 1280, height: 720, isLive: true, liveSegmentSeconds: 2, liveWindowSeconds: windowSeconds))
    }

    /// Seconds from `origin` to the item being ready and to the clock moving, or -1 when either never came.
    private func bind(_ url: URL, from origin: Date) -> (ready: Double, moving: Double) {
        let player = AVPlayer(url: url)
        player.play()
        defer { player.pause() }
        let ready = spin(seconds: 30) { player.currentItem?.status == .readyToPlay } ? Date().timeIntervalSince(origin) : -1
        let start = player.currentTime().seconds
        let moving = ready >= 0 && spin(seconds: 20) { player.currentTime().seconds >= start + 0.5 } ? Date().timeIntervalSince(origin) : -1
        return (ready, moving)
    }

    func testChannelChangeCost() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_LIVE_ZAP_SOURCES"] else {
            throw XCTSkip("set TOMO_LIVE_ZAP_SOURCES")
        }
        let sources = try JSONDecoder().decode([Source].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        for source in sources {
            for (label, input) in [("cold top", source.top), ("cold low", source.low)] {
                let s = try session(input)
                let origin = Date()
                s.start()
                let (server, url) = try serve(s)
                let t = bind(url, from: origin)
                NSLog("[LiveZap] %@ | %@ | ready %.2fs, clock moving %.2fs", source.name, label, t.ready, t.moving)
                server.stop()
                s.stop()
            }
            // The ring's hot session: a 20s window until the player adopts it and widens it.
            let hot = try session(source.top, windowSeconds: 20)
            hot.start()
            let (server, url) = try serve(hot)
            spin(seconds: 20) { false }
            let origin = Date()
            hot.setLiveWindow(seconds: 300)
            let t = bind(url, from: origin)
            NSLog("[LiveZap] %@ | hot top (running 20s, 20s window) | ready %.2fs, clock moving %.2fs", source.name, t.ready, t.moving)
            server.stop()
            hot.stop()
        }
    }
}
