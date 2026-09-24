import AVFoundation
import XCTest

@testable import TomoEngine

final class FastLinkPlaybackTests: XCTestCase {
    func testPreparingOriginalVideoDoesNotSendPlaceholderBytes() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 6))
        defer { session.stop() }
        guard case .segment(let contentType, let lead, let padding, _) = session.segmentResponse(0) else {
            return XCTFail("an incomplete original segment must wait for its media")
        }
        XCTAssertEqual(contentType, "video/iso.segment")
        XCTAssertTrue(lead.isEmpty, "placeholder bytes start throughput measurement before media is ready")
        XCTAssertTrue(padding.isEmpty, "original media must not trickle padding while it is being prepared")
    }

    func testPreparingOriginalAudioDoesNotSendPlaceholderBytes() throws {
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 6,
            audioTracks: [RemuxAudioTrack(index: 1, name: "English", language: "eng", serverAudioUrl: "")]))
        defer { session.stop() }
        session.sourceReady = true
        guard case .segment(let contentType, let lead, let padding, _) = session.segmentResponse(0, prefix: "a0") else {
            return XCTFail("an incomplete original audio segment must wait for its media")
        }
        XCTAssertEqual(contentType, "video/iso.segment")
        XCTAssertTrue(lead.isEmpty)
        XCTAssertTrue(padding.isEmpty)
    }

    func testActualSourceDoesNotRequestServerTranscoding() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["TOMO_FAST_LINK_SOURCE"] else {
            throw XCTSkip("set TOMO_FAST_LINK_SOURCE to a local video file")
        }
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: environment["FFPROBE"] ?? "/Applications/Jellyfin.app/Contents/MacOS/ffprobe")
        probe.arguments = ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]
        let output = Pipe()
        probe.standardOutput = output
        try probe.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        probe.waitUntilExit()
        XCTAssertEqual(probe.terminationStatus, 0)
        let metadata = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let streams = try XCTUnwrap(metadata["streams"] as? [[String: Any]])
        let video = try XCTUnwrap(streams.first { $0["codec_type"] as? String == "video" })
        let format = try XCTUnwrap(metadata["format"] as? [String: Any])
        let duration = try XCTUnwrap((format["duration"] as? String).flatMap(Double.init))
        let bandwidth = try XCTUnwrap((format["bit_rate"] as? String).flatMap(Int.init))
        let width = try XCTUnwrap(video["width"] as? Int)
        let height = try XCTUnwrap(video["height"] as? Int)
        let grid = "#EXTM3U\n" + (0..<Int(ceil(duration / 6))).map { segment in
            String(format: "#EXTINF:%.6f,\nseg%d.ts\n", min(6, duration - Double(segment) * 6), segment)
        }.joined() + "#EXT-X-ENDLIST\n"
        let lock = NSLock()
        var transcodeRequests: [String] = []
        let origin = LocalHTTPServer { request in
            switch request {
            case "/source": return .file(URL(fileURLWithPath: path), contentType: "application/octet-stream")
            case "/tier.m3u8": return .data(Data(grid.utf8), contentType: "application/vnd.apple.mpegurl")
            default:
                lock.lock()
                transcodeRequests.append(request)
                lock.unlock()
                return .notFound
            }
        }
        let originPort = try origin.start()
        defer { origin.stop() }
        let base = "http://127.0.0.1:\(originPort)"
        let tracks = try streams.filter { $0["codec_type"] as? String == "audio" }.map { stream in
            var track = RemuxAudioTrack(index: try XCTUnwrap(stream["index"] as? Int), name: "Audio", language: "eng", serverAudioUrl: "\(base)/audio.m3u8")
            track.serverAudioChannels = 2
            return track
        }
        let offset = try XCTUnwrap(Double(environment["TOMO_FAST_LINK_START"] ?? "0"))
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: duration, inputUrl: "\(base)/source", audioTracks: tracks,
            codecs: "", width: width, height: height, bandwidth: bandwidth,
            tierPlaylistUrl: "\(base)/tier.m3u8", tierBandwidth: 260_000,
            tierCodecs: "avc1.64000C,mp4a.40.2", tierWidth: 256, tierHeight: 144,
            startOffsetSeconds: offset))
        session.start()
        defer { session.stop() }
        let server = LocalHTTPServer { request in
            session.route(String(request.dropFirst()))
        }
        let port = try server.start()
        defer { server.stop() }
        let item = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/master.m3u8")))
        item.startsOnFirstEligibleVariant = true
        let player = AVPlayer(playerItem: item)
        player.play()
        defer { player.pause() }
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, player.currentTime().seconds < offset + 15, item.status != .failed {
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
        XCTAssertGreaterThan(player.currentTime().seconds, offset + 10, "AVPlayer did not advance: \(String(describing: item.error))")
        XCTAssertEqual(item.presentationSize.width, CGFloat(width))
        XCTAssertEqual(item.presentationSize.height, CGFloat(height))
        XCTAssertNil(item.error)
        lock.lock()
        let requested = transcodeRequests
        lock.unlock()
        XCTAssertTrue(requested.isEmpty, "requested server transcoding: \(requested)")
        let events = try XCTUnwrap(item.accessLog()?.events)
        XCTAssertFalse(events.isEmpty)
        for event in events {
            XCTAssertTrue(event.uri?.hasSuffix("/media.m3u8") == true)
        }
        for event in item.errorLog()?.events ?? [] {
            XCTFail("AVPlayer error \(event.errorStatusCode): \(event.errorComment ?? "") at \(event.uri ?? "")")
        }
    }

    func testPreparingOriginalSegmentDoesNotStartServerRenditions() throws {
        let master = """
        #EXTM3U
        #EXT-X-VERSION:10
        #EXT-X-STREAM-INF:BANDWIDTH=120000,AVERAGE-BANDWIDTH=120000,SCORE=2,CODECS="avc1.42C00A,mp4a.40.2",RESOLUTION=128x96
        media.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=60000,AVERAGE-BANDWIDTH=60000,SCORE=1,CODECS="avc1.42C00A,mp4a.40.2",RESOLUTION=128x96
        t0.m3u8

        """
        try checkPlayback(master: master, timeout: 10) { source, _ in
            source.stateLock.lock()
            source.renditions.first?.completed.remove(0)
            source.stateLock.unlock()
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                source.stateLock.lock()
                source.renditions.first?.completed.insert(0)
                source.stateLock.unlock()
            }
            return source.segmentResponse(0)
        }
    }

    func testSlowServerPreparationKeepsThePlayerAlive() throws {
        let master = """
        #EXTM3U
        #EXT-X-VERSION:7
        #EXT-X-STREAM-INF:BANDWIDTH=120000,CODECS="avc1.42C00A,mp4a.40.2",RESOLUTION=128x96
        media.m3u8

        """
        try checkPlayback(master: master, timeout: 17) { _, segment in
            .segment(contentType: "video/iso.segment", lead: RemuxSession.stypBox, padding: RemuxSession.freeBox) { _ in
                Thread.sleep(forTimeInterval: 7)
                return segment
            }
        }
    }

    private func checkPlayback(master: String, timeout: Double, segmentResponse: @escaping (RemuxSession, URL) -> LocalHTTPResponse) throws {
        let fixture = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/tier-segment.mpegts")
        let source = try RemuxSession(config: makeConfig(
            durationSeconds: 2, inputUrl: fixture.absoluteString,
            audioTracks: [RemuxAudioTrack(index: 1, name: "English", language: "eng", serverAudioUrl: "")],
            width: 128, height: 96, frameRate: 12, bandwidth: 120_000))
        source.start()
        defer { source.stop() }
        let segment = try XCTUnwrap(source.segmentURL(0))
        let initializer = try XCTUnwrap(source.initSegmentURL())
        let lock = NSLock()
        var fallbackRequests: [String] = []
        let server = LocalHTTPServer { path in
            switch path {
            case "/master.m3u8":
                return .data(Data(master.utf8), contentType: "application/vnd.apple.mpegurl")
            case "/media.m3u8":
                return .data(Data(source.mediaPlaylist().utf8), contentType: "application/vnd.apple.mpegurl")
            case "/init.mp4":
                return .file(initializer, contentType: "video/mp4")
            case "/seg0.m4s":
                return segmentResponse(source, segment)
            default:
                lock.lock()
                fallbackRequests.append(path)
                lock.unlock()
                return .notFound
            }
        }
        let port = try server.start()
        defer { server.stop() }
        let item = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/master.m3u8")))
        item.startsOnFirstEligibleVariant = true
        let player = AVPlayer(playerItem: item)
        player.play()
        defer { player.pause() }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, player.currentTime().seconds < 1.5, item.status != .failed {
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
        XCTAssertGreaterThan(player.currentTime().seconds, 0.5, "AVPlayer did not advance: \(String(describing: item.error))")
        lock.lock()
        let requested = fallbackRequests
        lock.unlock()
        XCTAssertTrue(requested.isEmpty, "fast link requested fallback: \(requested)")
        for event in item.accessLog()?.events ?? [] {
            NSLog("[FastLinkPlayback] playlist=%@ observed=%.0f indicated=%.0f", event.uri ?? "", event.observedBitrate, event.indicatedBitrate)
        }
    }
}
