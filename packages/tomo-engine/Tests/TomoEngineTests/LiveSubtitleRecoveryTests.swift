import Foundation
import XCTest

@testable import TomoEngine

final class LiveSubtitleRecoveryTests: XCTestCase {
    func testReopenedMasterRenewsTheURLsOfRunningSubtitlePollersWithoutSwappingTracks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-renew-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n"
        for file in ["video-old", "video-new", "en-old", "en-new", "es-old", "es-new"] {
            try playlist.write(to: root.appendingPathComponent("\(file).m3u8"), atomically: true, encoding: .utf8)
        }
        func writeMaster(_ generation: String, languages: [String]) throws {
            let renditions = languages.map {
                "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"\($0)\",LANGUAGE=\"\($0)\",URI=\"\($0)-\(generation).m3u8\""
            }
            let master = (["#EXTM3U"] + renditions + ["#EXT-X-STREAM-INF:BANDWIDTH=900000,SUBTITLES=\"subs\"", "video-\(generation).m3u8", ""]).joined(separator: "\n")
            try master.write(to: root.appendingPathComponent("master.m3u8"), atomically: true, encoding: .utf8)
        }
        try writeMaster("old", languages: ["en", "es"])
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let input = "\(origin.base)/master.m3u8"
        let session = try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: input, isLive: true))
        session.loopbackBase = "http://127.0.0.1:1/session"
        defer { session.stop() }

        XCTAssertNotNil(session.trimmedLiveSource(input, headers: [:]))
        let tracks = session.liveTextTracks()
        XCTAssertEqual(tracks.map(\.language), ["en", "es"])
        session.stateLock.lock()
        session.sessionAnchorSeconds = 0
        session.stateLock.unlock()
        session.followLiveSubtitles(tracks, headers: [:])
        XCTAssertTrue(spinMainRunLoop(seconds: 5) {
            ["/en-old.m3u8", "/es-old.m3u8"].allSatisfy { path in origin.requests.contains { $0.path == path } }
        }, "the initial subtitle pollers never requested their playlists")

        // Recovery re-reads the same master, now with renewed URLs and reversed rendition order.
        try writeMaster("new", languages: ["es", "en"])
        XCTAssertNotNil(session.trimmedLiveSource(input, headers: [:]))
        session.stateLock.lock()
        let source = session.sourcePlaylist
        let uris = session.liveSubtitleURIs
        session.stateLock.unlock()
        XCTAssertTrue(source?.contains("video-new.m3u8") == true)
        for track in tracks {
            XCTAssertEqual(uris[track.index], "\(origin.base)/\(track.language)-new.m3u8")
        }
        XCTAssertTrue(spinMainRunLoop(seconds: 5) {
            ["/en-new.m3u8", "/es-new.m3u8"].allSatisfy { path in origin.requests.contains { $0.path == path } }
        }, "the running pollers kept using the original subtitle URLs")

        // A temporarily missing rendition must not retain its expired URL or lose its track index.
        let spanish = try XCTUnwrap(tracks.first { $0.language == "es" })
        try writeMaster("new", languages: ["en"])
        XCTAssertNotNil(session.trimmedLiveSource(input, headers: [:]))
        session.stateLock.lock()
        let missingURI = session.liveSubtitleURIs[spanish.index]
        session.stateLock.unlock()
        XCTAssertNil(missingURI)
        try writeMaster("new", languages: ["es", "en"])
        XCTAssertNotNil(session.trimmedLiveSource(input, headers: [:]))
        session.stateLock.lock()
        let restoredURI = session.liveSubtitleURIs[spanish.index]
        session.stateLock.unlock()
        XCTAssertEqual(restoredURI, "\(origin.base)/es-new.m3u8")
        XCTAssertEqual(session.liveTextTracks().map(\.language), ["en", "es"])
    }
}
