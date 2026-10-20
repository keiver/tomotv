import Foundation
import XCTest

@testable import TomoEngine

/// The app's routing (LocalRemuxer.route) for one session, served over the loopback the way the app serves it.
func serveOverLoopback(_ session: RemuxSession, onRequest: ((String) -> Void)? = nil) throws -> (LocalHTTPServer, URL) {
    let m3u8 = "application/vnd.apple.mpegurl"
    let server = LocalHTTPServer { path in
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 2, parts[0] == session.token else { return .notFound }
        let name = parts[1]
        onRequest?(name)
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
func spinMainRunLoop(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if condition() { return true }
        RunLoop.main.run(until: Date().addingTimeInterval(0.25))
    }
    return condition()
}
