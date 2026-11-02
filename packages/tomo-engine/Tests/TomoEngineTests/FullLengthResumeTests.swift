import AVFoundation
import Network
import XCTest

@testable import TomoEngine

/// Issue 109's geometry at full scale: a 6629 s open-GOP HEVC MP4 (CRA sync samples listed in a
/// healthy stss, AAC and E-AC3 tracks, hvc1, PQ) resumed at 49:00 over the ranged reader. The
/// fixture is too large for the repository, so the test reads its path from TOMO_FULL_REPLICA
/// and skips when the variable is unset.
final class FullLengthResumeTests: XCTestCase {
    func testAResumeAtFortyNineMinutesIntoASixtySixHundredSecondFileIsServedFromTheTarget() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_FULL_REPLICA"] else {
            throw XCTSkip("TOMO_FULL_REPLICA unset")
        }
        let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        // 10 MB/s: reading forward from byte 0 to the resume point takes longer than the 20 s
        // request deadline, while the 9 s the seek leaves to cover is under a megabyte.
        let server = try RangedFileServer(data: bytes, bytesPerSecond: 10 << 20)
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 6629, inputUrl: "http://127.0.0.1:\(server.port)/movie.mp4",
            videoRange: "PQ", codecs: "hvc1.2.4.L120.B0,mp4a.40.2,ec-3",
            width: 3840, height: 2160, frameRate: 24, startOffsetSeconds: 2940))
        session.start()
        defer { session.stop() }
        let started = Date()
        let url = session.segmentURL(490)
        XCTAssertNotNil(url, "segment 490 is served from the seek's landing, not after a read from byte 0")
        XCTAssertLessThan(Date().timeIntervalSince(started), 18)
    }

    /// The same session consumed the way the app consumes it: AVPlayer on the loopback master,
    /// the resume carried only by EXT-X-START. Records which segments AVPlayer asks for.
    /// `splitAudio` mirrors the reporter's file: AAC and E-AC3 as separate audio renditions.
    func testAVPlayerStartsAtTheResumeOffsetNotAtSegmentZero() throws {
        try assertAVPlayerResumes(splitAudio: false)
    }

    /// No player, no segment request: does generation 0 grind forward from byte 0 toward the resume
    /// offset on its own? Records every 2 MiB range the input reads over 8 s of silence.
    func testGenerationZeroBeforeAnyRequest() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_FULL_REPLICA"] else {
            throw XCTSkip("TOMO_FULL_REPLICA unset")
        }
        let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        let server = try RangedFileServer(data: bytes, bytesPerSecond: 40 << 20)
        defer { server.stop() }
        let lock = NSLock()
        var ranges: [(Int, Int)] = []
        server.onRange = { s, e in
            lock.lock(); ranges.append((s, e)); lock.unlock()
        }
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 6629, inputUrl: "http://127.0.0.1:\(server.port)/movie.mp4",
            videoRange: "PQ", codecs: "hvc1.2.4.L120.B0,mp4a.40.2,ec-3",
            width: 3840, height: 2160, frameRate: 24, startOffsetSeconds: 2940))
        session.start()
        defer { session.stop() }
        _ = session.masterPlaylist()
        spinMainRunLoop(seconds: 8) { false }
        lock.lock()
        let served = ranges
        lock.unlock()
        let fixed = served.filter { $0.1 - $0.0 + 1 == 2 << 20 }.map(\.0).sorted()
        NSLog("[Test] no request for 8 s: %d ranges, %d of 2 MiB, 2 MiB starts %d..%d (resume byte ~1.29 GB, segment 490)",
              served.count, fixed.count, fixed.first ?? -1, fixed.last ?? -1)
    }

    func testAVPlayerResumesWithTwoAudioRenditions() throws {
        try assertAVPlayerResumes(splitAudio: true)
    }

    /// A server ladder is offered (the app offers one for every streamable item with audio) and the
    /// server answers its Jellyfin-style transcode URLs in one of the ways a Jellyfin-compatible
    /// server might.
    func testAVPlayerResumesWhenTheServerLadderAnswers404() throws {
        try assertAVPlayerResumes(splitAudio: true) { _ in .notFound }
    }

    func testAVPlayerResumesWhenTheServerLadderPlaylistIsValidButItsSegmentsAre404() throws {
        let playlist = Self.tierPlaylist(segmentSeconds: 6, total: 6629)
        try assertAVPlayerResumes(splitAudio: true) { path in
            path.hasSuffix("main.m3u8") ? .data(Data(playlist.utf8), contentType: "application/vnd.apple.mpegurl") : .notFound
        }
    }

    func testAVPlayerResumesWhenTheServerLadderUsesAThreeSecondGrid() throws {
        let playlist = Self.tierPlaylist(segmentSeconds: 3, total: 6629)
        try assertAVPlayerResumes(splitAudio: true) { path in
            path.hasSuffix("main.m3u8") ? .data(Data(playlist.utf8), contentType: "application/vnd.apple.mpegurl") : .notFound
        }
    }

    /// The link probe's three open-ended range requests get their first byte after 4 s (over the 3 s the
    /// probe allows), the server's rung answers 404, and the ranged reads are observed for 30 s.
    func testAVPlayerResumesWhenTheLinkProbeTimesOutAndTheServerLadderAnswers404() throws {
        try assertAVPlayerResumes(splitAudio: true, openEndedFirstByteDelay: 4, observeSeconds: 30) { _ in .notFound }
    }

    /// Issue 109: a static file host (206 on byte ranges, no transcode endpoints, so every rung URL
    /// 404s) read over a link whose open-ended requests (the probe's `bytes=0-` shape) crawl at
    /// 300 KB/s per connection, under 1.2x the declared 8 Mb/s source, while bounded 2 MiB ranges run
    /// at 10 MB/s. The ladder is offered (the default), every rung 404s, the probe reads slow, and the
    /// copy must carry the resume instead of 503ing behind a rung that can never serve.
    func testAVPlayerResumesOnAStaticHostWhenTheLinkProbeReadsSlowAndEveryRung404s() throws {
        try assertAVPlayerResumes(splitAudio: true, observeSeconds: 30, openEndedBytesPerSecond: 300 * 1024) { _ in .notFound }
    }

    /// Issue 109: a Jellyfin-compatible server that answers the rung's canonical playlist with a
    /// valid HLS body (so the engine adopts the ladder) but then 404s every rung segment, read over
    /// a link whose open-ended probe crawls under 1.2x the source. The opening rung never delivers,
    /// so the master must lead with the copy rather than open AVPlayer on a rung that cannot serve.
    func testAVPlayerResumesWhenTheRungPlaylistAdoptsButItsSegments404OnASlowProbe() throws {
        let playlist = Self.tierPlaylist(segmentSeconds: 6, total: 6629)
        try assertAVPlayerResumes(splitAudio: true, observeSeconds: 30, openEndedBytesPerSecond: 300 * 1024) { path in
            path.hasSuffix("main.m3u8") ? .data(Data(playlist.utf8), contentType: "application/vnd.apple.mpegurl") : .notFound
        }
    }

    private static func tierPlaylist(segmentSeconds: Double, total: Double) -> String {
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:\(Int(segmentSeconds))\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI=\"main.mp4\"\n"
        var acc = 0.0
        var i = 0
        while acc < total {
            let d = min(segmentSeconds, total - acc)
            out += String(format: "#EXTINF:%.6f, nodesc\nseg%d.m4s\n", d, i)
            acc += d
            i += 1
        }
        return out + "#EXT-X-ENDLIST\n"
    }

    private func assertAVPlayerResumes(splitAudio: Bool, file: StaticString = #filePath, line: UInt = #line,
                                       openEndedFirstByteDelay: TimeInterval = 0, observeSeconds: TimeInterval = 0,
                                       openEndedBytesPerSecond: Int? = nil,
                                       tierServer: ((String) -> LocalHTTPResponse)? = nil) throws {
        let env = ProcessInfo.processInfo.environment
        var server: RangedFileServer?
        let inputUrl: String
        let rangeLock = NSLock()
        var ranges: [(Int, Int)] = []
        if let url = env["TOMO_REPLICA_URL"] {
            inputUrl = url
        } else if let path = env["TOMO_FULL_REPLICA"] {
            let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
            server = try RangedFileServer(data: bytes, bytesPerSecond: 10 << 20)
            server!.openEndedFirstByteDelay = openEndedFirstByteDelay
            server!.openEndedBytesPerSecond = openEndedBytesPerSecond
            server!.onRange = { start, end in
                rangeLock.lock()
                ranges.append((start, end))
                rangeLock.unlock()
            }
            inputUrl = "http://127.0.0.1:\(server!.port)/movie.mp4"
        } else {
            throw XCTSkip("TOMO_FULL_REPLICA unset")
        }
        defer { server?.stop() }
        var tierHttp: LocalHTTPServer?
        var tiers: [TierConfig] = []
        if let tierServer {
            let http = LocalHTTPServer(route: tierServer)
            let port = try http.start()
            tierHttp = http
            tiers = [TierConfig(playlistUrl: "http://127.0.0.1:\(port)/rung0/main.m3u8", bandwidth: 2_000_000, codecs: "hvc1.1.6.L120.B0", width: 1280, height: 720)]
        }
        defer { tierHttp?.stop() }
        let tracks = splitAudio ? [RemuxAudioTrack(index: 1, name: "AAC", language: "eng", serverAudioUrl: ""),
                                   RemuxAudioTrack(index: 2, name: "E-AC3", language: "eng", serverAudioUrl: "")] : []
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 6629, inputUrl: inputUrl,
            audioTracks: tracks,
            videoRange: "PQ", codecs: "hvc1.2.4.L120.B0,mp4a.40.2,ec-3",
            width: 3840, height: 2160, frameRate: 24, tiers: tiers, startOffsetSeconds: 2940))
        session.start()
        defer { session.stop() }
        let lock = NSLock()
        var requests: [String] = []
        let (loopback, url) = try serveOverLoopback(session) { name in
            lock.lock()
            requests.append(name)
            lock.unlock()
        }
        defer { loopback.stop() }

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        XCTAssertTrue(spinMainRunLoop(seconds: 60) { item.status != .unknown }, "never ready", file: file, line: line)
        XCTAssertEqual(item.status, .readyToPlay, "item failed: \(String(describing: item.error))", file: file, line: line)
        player.play()
        XCTAssertTrue(spinMainRunLoop(seconds: 30) { player.currentTime().seconds > 1 && player.rate > 0 },
                      "never played: clock at \(player.currentTime().seconds)s, error \(String(describing: item.error))", file: file, line: line)
        if observeSeconds > 0 {
            spinMainRunLoop(seconds: observeSeconds) { false }
            rangeLock.lock()
            let served = ranges
            rangeLock.unlock()
            let fixed = served.filter { $0.1 - $0.0 + 1 == 2 << 20 }
            let lowest = fixed.map(\.0).min() ?? -1
            let highest = fixed.map(\.0).max() ?? -1
            NSLog("[Test] %d ranges served, %d of 2 MiB; 2 MiB starts from %d to %d; player at %.1fs rate %.1f",
                  served.count, fixed.count, lowest, highest, player.currentTime().seconds, player.rate)
        }
        let at = player.currentTime().seconds
        lock.lock()
        let segments = requests.filter { $0.hasPrefix("seg") || ($0.hasPrefix("a") && $0.contains("-seg")) }
        lock.unlock()
        NSLog("[Test] playing at %.1fs; requests: %@", at, requests.joined(separator: " "))
        XCTAssertGreaterThan(at, 2900, "AVPlayer plays near the resume offset, not from the start", file: file, line: line)
        let first = try XCTUnwrap(segments.first, "no media segment was requested", file: file, line: line)
        let index = Int(first.drop { !$0.isNumber }.prefix { $0.isNumber }) ?? -1
        XCTAssertGreaterThanOrEqual(index, 488, "the first media request honours EXT-X-START: \(first)", file: file, line: line)
    }
}
