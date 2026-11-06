import AVFoundation
import XCTest

@testable import TomoEngine

/// The engine's live output through the host's own AVPlayer, served over the loopback the way the
/// app serves it. Answers what only a player can: does it play keyframe-cut long-GOP segments, does
/// it see a declared caption group, and what happens when a pause outlives the window. Opt in with
/// the TOMO_LIVE_SOURCE_* variables of LivePipelineTests.
/// TOMO_PLAIN_LOOPBACK: an LL-HLS session is read straight off the loopback instead of through LowLatencyPlayerAsset.
final class LiveAVPlayerTests: XCTestCase {
    private func serve(_ session: RemuxSession, onRequest: ((String) -> Void)? = nil) throws -> (LocalHTTPServer, URL) {
        try serveOverLoopback(session, onRequest: onRequest)
    }

    @discardableResult
    private func spin(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
        spinMainRunLoop(seconds: seconds, until: condition)
    }

    /// Waits until the session holds `seconds` of output.
    private func awaitStartBuffer(_ session: RemuxSession, seconds: Double) {
        XCTAssertTrue(spin(seconds: 40) { (session.progress()["bufferedSeconds"] as? Double ?? 0) >= seconds }, "the engine never held \(seconds)s")
    }

    private func startedSession(source: String, subtitles: [RemuxSubtitle] = [], liveWindowSeconds: Double = 300, bufferSeconds: Double = 0) throws -> RemuxSession {
        var config = makeConfig(
            durationSeconds: 0, inputUrl: source, subtitles: subtitles, width: 1280, height: 720, isLive: true,
            liveSegmentSeconds: ProcessInfo.processInfo.environment["TOMO_LIVE_SEGMENT"].flatMap(Double.init) ?? 2, liveWindowSeconds: liveWindowSeconds)
        config.liveBufferSeconds = bufferSeconds
        let session = try RemuxSession(config: config)
        session.start()
        return session
    }

    /// A source whose keyframe interval grows mid-stream (2s, then 10s) makes copied segments longer
    /// than the TARGETDURATION the first playlist published. Recorded: the target served across the
    /// change, the longest EXTINF, any wait, and whether the item fails.
    func testAVPlayerAcrossAKeyframeIntervalThatGrows() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-gop-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let feed = try startLiveFeed(in: root, segments: 2, keyframes: "expr:if(lt(t,24),gte(t,n_forced*2),gte(t,24+(n_forced-12)*10))")
        defer { feed.terminate() }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let session = try startedSession(source: "\(origin.base)/live.m3u8", bufferSeconds: 8)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }
        awaitStartBuffer(session, seconds: 8)

        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 0.5 }, "never played: \(String(describing: player.currentItem?.error))")
        let firstTarget = session.mediaPlaylist().split(separator: "\n").first { $0.hasPrefix("#EXT-X-TARGETDURATION:") } ?? ""
        var waited = 0.0
        let watched = Date()
        while Date().timeIntervalSince(watched) < 60, player.currentItem?.error == nil {
            spin(seconds: 0.25) { false }
            if player.timeControlStatus == .waitingToPlayAtSpecifiedRate { waited += 0.25 }
        }
        let playlist = session.mediaPlaylist()
        let lastTarget = playlist.split(separator: "\n").first { $0.hasPrefix("#EXT-X-TARGETDURATION:") } ?? ""
        let longest = playlist.split(separator: "\n").compactMap { $0.hasPrefix("#EXTINF:") ? Double($0.dropFirst(8).dropLast()) : nil }.max() ?? 0
        NSLog("[LiveAVPlayerTests] keyframe interval 2s -> 10s: target %@ -> %@, longest EXTINF %.2f, waited %.2fs, clock %.1fs, error %@",
              String(firstTarget), String(lastTarget), longest, waited, player.currentTime().seconds, String(describing: player.currentItem?.error))
        XCTAssertNil(player.currentItem?.error)
    }

    /// An LL-HLS session read through LowLatencyPlayerAsset, as the app's player reads it: AVPlayer takes low-latency mode
    /// (no -15410), fetches parts, and plays.
    func testLowLatencySessionPlaysInLowLatencyModeThroughThePlayerAsset() throws {
        let (feed, path) = try startContinuousFeed(fps: "25", keyframeSeconds: 1)
        defer {
            feed.terminate()
            try? FileManager.default.removeItem(atPath: path)
        }
        var config = makeConfig(durationSeconds: 0, inputUrl: path, videoRange: "", codecs: "", width: 0, height: 0, frameRate: 0, bandwidth: 0,
                                isLive: true, liveSegmentSeconds: 1)
        config.describesInput = true
        config.liveBufferSeconds = 2
        config.liveCopyCutSeconds = 0.4
        config.liveTargetNearest = true
        config.liveLowLatency = true
        config.liveLowLatencyTargetSeconds = 0
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let lock = NSLock()
        var partFetches = 0
        let (server, url) = try serve(session) { name in
            guard RemuxSession.partIndices(Substring(name.split(separator: "/").last ?? "")) != nil else { return }
            lock.lock()
            partFetches += 1
            lock.unlock()
        }
        defer { server.stop() }
        XCTAssertTrue(spin(seconds: 20) { session.servesParts }, "the session never took LL-HLS")
        let asset = try XCTUnwrap(LowLatencyPlayerAsset.asset(for: url))
        XCTAssertEqual(asset.url.scheme, "tomo-ll")
        let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        player.play()
        XCTAssertTrue(spin(seconds: 20) { player.currentTime().seconds > 3 }, "never played: \(String(describing: player.currentItem?.error))")
        let errors = player.currentItem?.errorLog()?.events.map { "\($0.errorStatusCode) \($0.errorComment ?? "")" } ?? []
        lock.lock()
        let fetched = partFetches
        lock.unlock()
        NSLog("[LiveAVPlayerTests] through LowLatencyPlayerAsset: %d part fetches, player errors %@", fetched, errors)
        XCTAssertFalse(errors.contains { $0.hasPrefix("-15410") }, "\(errors)")
        XCTAssertGreaterThan(fetched, 0)
        XCTAssertNil(player.currentItem?.error)
        session.stop()
        XCTAssertNil(LowLatencyPlayerAsset.asset(for: url), "a stopped session is no longer read through the loader")
    }

    func testOnlyALoopbackSessionServingPartsGetsThePlayerAsset() {
        let url = URL(string: "http://127.0.0.1:5000/TOKEN-1/master.m3u8")!
        XCTAssertEqual(LowLatencyPlayerAsset.sessionToken(url), "TOKEN-1")
        XCTAssertNil(LowLatencyPlayerAsset.asset(for: url))
        LowLatencyPlayerAsset.register(token: "TOKEN-1")
        defer { LowLatencyPlayerAsset.unregister(token: "TOKEN-1") }
        XCTAssertEqual(LowLatencyPlayerAsset.asset(for: url)?.url.absoluteString, "tomo-ll://127.0.0.1:5000/TOKEN-1/master.m3u8")
        XCTAssertNil(LowLatencyPlayerAsset.asset(for: URL(string: "http://example.com:5000/TOKEN-1/master.m3u8")!))
        XCTAssertEqual(LowLatencyPlayerAsset.loopbackURL(URL(string: "tomo-ll://127.0.0.1:5000/TOKEN-1/media.m3u8?_HLS_msn=4&_HLS_part=1")!)?.absoluteString,
                       "http://127.0.0.1:5000/TOKEN-1/media.m3u8?_HLS_msn=4&_HLS_part=1")
    }

    /// A source that pauses for longer than three target durations, read through LowLatencyPlayerAsset: the held reload
    /// is asked again past the engine's 503, AVPlayer logs no invalid blocking reload, and it plays on once the source resumes.
    func testLowLatencyThroughThePlayerAssetRidesASourcePause() throws {
        let (feed, path) = try startContinuousFeed(fps: "25", keyframeSeconds: 1)
        defer {
            kill(feed.processIdentifier, SIGCONT)
            feed.terminate()
            try? FileManager.default.removeItem(atPath: path)
        }
        var config = makeConfig(durationSeconds: 0, inputUrl: path, videoRange: "", codecs: "", width: 0, height: 0, frameRate: 0, bandwidth: 0,
                                isLive: true, liveSegmentSeconds: 1)
        config.describesInput = true
        config.liveBufferSeconds = 2
        config.liveCopyCutSeconds = 0.4
        config.liveTargetNearest = true
        config.liveLowLatency = true
        config.liveLowLatencyTargetSeconds = 0
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }
        XCTAssertTrue(spin(seconds: 20) { session.servesParts }, "the session never took LL-HLS")
        let player = AVPlayer(playerItem: AVPlayerItem(asset: try XCTUnwrap(LowLatencyPlayerAsset.asset(for: url))))
        player.play()
        XCTAssertTrue(spin(seconds: 20) { player.currentTime().seconds > 3 }, "never played: \(String(describing: player.currentItem?.error))")
        kill(feed.processIdentifier, SIGSTOP)
        spin(seconds: 7) { false }
        kill(feed.processIdentifier, SIGCONT)
        let resumedAt = player.currentTime().seconds
        let resumed = spin(seconds: 20) { player.currentTime().seconds > resumedAt + 3 }
        let errors = player.currentItem?.errorLog()?.events.map { "\($0.errorStatusCode) \($0.errorComment ?? "")" } ?? []
        NSLog("[LiveAVPlayerTests] LL source pause 7s through the asset: resumed %@, clock %.1fs, player errors %@, item error %@",
              resumed ? "yes" : "no", player.currentTime().seconds, errors, String(describing: player.currentItem?.error))
        XCTAssertTrue(resumed)
        XCTAssertFalse(errors.contains { $0.contains("blocking reload") }, "\(errors)")
        XCTAssertNil(player.currentItem?.error)
    }

    /// LL-HLS as the app configures it (1 s segments, 0.4 s copy cut, target learned from the first segment) on a
    /// continuous TS whose keyframe interval grows from 1 s to 4 s: the player keeps playing past the change.
    func testLowLatencyAcrossAKeyframeIntervalThatGrows() throws {
        let (feed, path) = try startContinuousFeed(fps: "25", keyframeSeconds: 1, forcedKeyframes: "expr:if(lt(t,20),gte(t,n_forced*1),gte(t,20+(n_forced-20)*4))")
        defer {
            feed.terminate()
            try? FileManager.default.removeItem(atPath: path)
        }
        var config = makeConfig(durationSeconds: 0, inputUrl: path, videoRange: "", codecs: "", width: 0, height: 0, frameRate: 0, bandwidth: 0,
                                isLive: true, liveSegmentSeconds: 1)
        config.describesInput = true
        config.liveBufferSeconds = 2
        config.liveCopyCutSeconds = 0.4
        config.liveTargetNearest = true
        config.liveLowLatency = true
        config.liveLowLatencyTargetSeconds = 0
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }
        XCTAssertTrue(spin(seconds: 20) { session.servesParts }, "the session never took LL-HLS")
        let player = AVPlayer(playerItem: AVPlayerItem(asset: LowLatencyPlayerAsset.asset(for: url) ?? AVURLAsset(url: url)))
        player.play()
        XCTAssertTrue(spin(seconds: 30) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 0.5 }, "never played: \(String(describing: player.currentItem?.error))")
        let firstTarget = session.mediaPlaylist().split(separator: "\n").first { $0.hasPrefix("#EXT-X-TARGETDURATION:") } ?? ""
        let start = player.currentTime().seconds
        spin(seconds: 45) { player.currentItem?.error != nil }
        let playlist = session.mediaPlaylist()
        let longest = playlist.split(separator: "\n").compactMap { $0.hasPrefix("#EXTINF:") ? Double($0.dropFirst(8).dropLast()) : nil }.max() ?? 0
        NSLog("[LiveAVPlayerTests] LL keyframe interval 1s -> 4s: target %@, longest EXTINF %.2f, played %.1fs, error %@",
              String(firstTarget), longest, player.currentTime().seconds - start, String(describing: player.currentItem?.error))
        XCTAssertNil(player.currentItem?.error)
        XCTAssertGreaterThan(player.currentTime().seconds - start, 35)
    }

    /// A live session from the channel's URL alone, as liveSessionConfig builds it (no codecs, size,
    /// range or tracks configured; the input describes itself): its master names the variant and plays.
    func testAVPlayerPlaysALiveSessionThatDescribesItself() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-described-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let feed = try startLiveFeed(in: root)
        defer { feed.terminate() }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        var config = makeConfig(durationSeconds: 0, inputUrl: "\(origin.base)/live.m3u8", videoRange: "", codecs: "",
                                width: 0, height: 0, frameRate: 0, bandwidth: 0, isLive: true, liveSegmentSeconds: 2)
        config.describesInput = true
        config.liveBufferSeconds = 15
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }
        awaitStartBuffer(session, seconds: 15)

        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 2 }, "never played: \(String(describing: player.currentItem?.error))")
        let master = session.masterPlaylist()
        NSLog("[LiveAVPlayerTests] self-described live master: %@", master.split(separator: "\n").filter { $0.hasPrefix("#EXT-X-STREAM-INF") || $0.hasPrefix("#EXT-X-MEDIA") }.joined(separator: " | "))
        XCTAssertTrue(master.contains("RESOLUTION=320x180"), master)
        XCTAssertNil(player.currentItem?.error)
    }

    /// Where AVPlayer accepts the session's start point: per start buffer and source backlog, the published target, the
    /// start offset, whether AVPlayer logged -16831 (START-TIME too close to live), the time to a moving clock, and how far
    /// behind the newest output it then plays. Recorded, not asserted. Opt in with TOMO_START_BUFFERS=2,4,6 (seconds).
    func testWhereAVPlayerAcceptsALiveStartPoint() throws {
        guard let buffers = ProcessInfo.processInfo.environment["TOMO_START_BUFFERS"].map({ $0.split(separator: ",").compactMap { Double($0) } }) else {
            throw XCTSkip("set TOMO_START_BUFFERS")
        }
        let backlogs = ProcessInfo.processInfo.environment["TOMO_START_BACKLOGS"].map { $0.split(separator: ",").compactMap { Int($0) } } ?? [1, 6]
        for backlog in backlogs {
            for buffer in buffers {
                let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-start-\(UUID().uuidString)")
                defer { try? FileManager.default.removeItem(at: root) }
                let env = ProcessInfo.processInfo.environment
                let segment = env["TOMO_START_SEGMENT"].flatMap(Double.init) ?? 2
                let feed = try startLiveFeed(in: root, segments: backlog, keyframes: env["TOMO_START_KEYFRAMES"])
                defer { feed.terminate() }
                let origin = try RecordingDirectoryServer(root: root)
                defer { origin.stop() }
                if backlog > 1 { spin(seconds: Double(backlog * 2 + 2)) { false } }
                var config = makeConfig(durationSeconds: 0, inputUrl: "\(origin.base)/live.m3u8", videoRange: "", codecs: "",
                                        width: 0, height: 0, frameRate: 0, bandwidth: 0, isLive: true, liveSegmentSeconds: segment)
                config.describesInput = true
                config.liveBufferSeconds = buffer
                let session = try RemuxSession(config: config)
                let opened = Date()
                session.start()
                defer { session.stop() }
                let (server, url) = try serve(session)
                defer { server.stop() }
                awaitStartBuffer(session, seconds: buffer)
                let buffered = Date().timeIntervalSince(opened)
                let player = AVPlayer(url: url)
                let bound = Date()
                player.play()
                let played = spin(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 0.5 }
                let toPlay = Date().timeIntervalSince(bound)
                let media = session.mediaPlaylist().split(separator: "\n")
                let target = media.first { $0.hasPrefix("#EXT-X-TARGETDURATION:") } ?? ""
                let start = media.first { $0.hasPrefix("#EXT-X-START:") } ?? "(none)"
                let tooClose = player.currentItem?.errorLog()?.events.contains { $0.errorStatusCode == -16831 } ?? false
                let edge = player.currentItem?.seekableTimeRanges.last?.timeRangeValue.end.seconds ?? 0
                let behind = edge - player.currentTime().seconds
                NSLog("[LiveAVPlayerTests] start point: backlog %d, buffer %.0fs, buffered after %.1fs, %@, %@, -16831 %@, playing after %.1fs, %.1fs behind the edge, played %@",
                      backlog, buffer, buffered, String(target), String(start), tooClose ? "yes" : "no", toPlay, behind, played ? "yes" : "no")
                player.pause()
            }
        }
    }

    /// Open to moving picture on a continuous real-time TS source, timed from `session.start()` as the app opens a channel. Recorded, not asserted.
    /// Opt in with TOMO_CONTINUOUS_START=25:1,30000/1001:2:mpeg2,25:2::20 (fps:keyframe s[:codec[:bind after s]]); TOMO_START_RUNS, _WATCH, _BUFFER, TOMO_LIVE_SEGMENT, TOMO_LIVE_COPY_CUT, TOMO_TARGET_NEAREST, TOMO_LOW_LATENCY (part seconds), TOMO_LL_TARGET, TOMO_LOG_REQUESTS.
    func testLiveStartOnAContinuousSource() throws {
        let env = ProcessInfo.processInfo.environment
        guard let specs = env["TOMO_CONTINUOUS_START"]?.split(separator: ",").map({ $0.split(separator: ":", omittingEmptySubsequences: false).map(String.init) }) else {
            throw XCTSkip("set TOMO_CONTINUOUS_START")
        }
        let runs = env["TOMO_START_RUNS"].flatMap(Int.init) ?? 5
        let watch = env["TOMO_START_WATCH"].flatMap(Double.init) ?? 60
        let segment = env["TOMO_LIVE_SEGMENT"].flatMap(Double.init) ?? 1
        let buffer = env["TOMO_START_BUFFER"].flatMap(Double.init) ?? 2
        for spec in specs {
            let fps = spec[0]
            let keyframes = spec.count > 1 ? Double(spec[1]) ?? 2 : 2
            let codec = spec.count > 2 && !spec[2].isEmpty ? spec[2] : "h264"
            let lead = spec.count > 3 ? Double(spec[3]) ?? 0 : 0
            var starts: [Double] = []
            for run in 1...runs {
                let (feed, path) = try startContinuousFeed(fps: fps, keyframeSeconds: keyframes, codec: codec)
                defer {
                    feed.terminate()
                    try? FileManager.default.removeItem(atPath: path)
                }
                var config = makeConfig(durationSeconds: 0, inputUrl: path, videoRange: "", codecs: "", width: 0, height: 0, frameRate: 0, bandwidth: 0,
                                        isLive: true, liveSegmentSeconds: segment)
                config.describesInput = true
                config.liveBufferSeconds = buffer
                config.liveCopyCutSeconds = env["TOMO_LIVE_COPY_CUT"].flatMap(Double.init) ?? 0
                config.liveTargetNearest = env["TOMO_TARGET_NEAREST"] != nil
                let partSeconds = env["TOMO_LOW_LATENCY"].flatMap(Double.init)
                config.liveLowLatency = partSeconds != nil
                config.livePartSeconds = partSeconds ?? 0.5
                if let target = env["TOMO_LL_TARGET"].flatMap(Int.init) { config.liveLowLatencyTargetSeconds = target }
                let session = try RemuxSession(config: config)
                let opened = Date()
                session.start()
                defer { session.stop() }
                let requestLock = NSLock()
                var blockingReloads = 0
                var partFetches = 0
                let (server, url) = try serve(session) { name in
                    requestLock.lock()
                    if env["TOMO_LOG_REQUESTS"] != nil { NSLog("[LiveAVPlayerTests] GET %@ at %.2fs", name, Date().timeIntervalSince(opened)) }
                    if name.contains("_HLS_msn=") { blockingReloads += 1 }
                    if RemuxSession.partIndices(Substring(name.split(separator: "-").last ?? "")) != nil { partFetches += 1 }
                    requestLock.unlock()
                }
                defer { server.stop() }
                // An LL-HLS session holds its own first answer until a part exists: the player binds at the open.
                if lead > 0 { spin(seconds: lead) { false } } else if partSeconds == nil { awaitStartBuffer(session, seconds: buffer) } else { spin(seconds: 20) { session.servesParts } }
                let bound = Date().timeIntervalSince(opened)
                let asset = env["TOMO_PLAIN_LOOPBACK"] == nil ? LowLatencyPlayerAsset.asset(for: url) ?? AVURLAsset(url: url) : AVURLAsset(url: url)
                let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
                player.play()
                var moving: Double?
                var startPosition: Double?
                var stalls = 0
                var wasPlaying = false
                let end = Date().addingTimeInterval(watch)
                while Date() < end {
                    RunLoop.main.run(until: Date().addingTimeInterval(0.05))
                    let position = player.currentTime().seconds
                    let playing = player.timeControlStatus == .playing
                    if playing, startPosition == nil, position.isFinite { startPosition = position }
                    if moving == nil, let first = startPosition, position > first + 0.2 { moving = Date().timeIntervalSince(opened) - 0.2 }
                    if moving != nil, wasPlaying, !playing { stalls += 1 }
                    wasPlaying = playing
                }
                let behind = player.currentItem?.currentDate().map { Date().timeIntervalSince($0) } ?? .nan
                var playlist = session.mediaPlaylist()
                if case .data(let data, _) = session.route("media.m3u8") { playlist = String(decoding: data, as: UTF8.self) }
                let media = playlist.split(separator: "\n")
                if env["TOMO_LOG_REQUESTS"] != nil { NSLog("[LiveAVPlayerTests] master:\n%@\nmedia:\n%@", session.masterPlaylist(), playlist) }
                let longest = media.compactMap { $0.hasPrefix("#EXTINF:") ? Double($0.dropFirst(8).split(separator: ",").first ?? "") : nil }.max() ?? 0
                let target = (media.first { $0.hasPrefix("#EXT-X-TARGETDURATION:") }.map(String.init) ?? "(none)") + String(format: ", longest segment %.3fs", longest)
                if let moving { starts.append(lead > 0 ? moving - bound : moving) }
                requestLock.lock()
                let reloads = blockingReloads
                let fetches = partFetches
                requestLock.unlock()
                let errors = player.currentItem?.errorLog()?.events.map { "\($0.errorStatusCode) \($0.errorComment ?? "")" }.joined(separator: "; ") ?? ""
                NSLog("[LiveAVPlayerTests] continuous start low latency: parts %@, %d blocking reloads, %d part fetches, player errors [%@]",
                      partSeconds.map { String(format: "%.2fs", $0) } ?? "off", reloads, fetches, errors)
                NSLog("[LiveAVPlayerTests] continuous start: %@ fps, keyframe %.2fs, %@, segment %.2fs, buffer %.0fs, run %d: %@, bound at %.2fs, moving at %@, %d stalls in %.0fs, %.2fs behind the cut clock, error %@",
                      fps, keyframes, codec, segment, buffer, run, target, bound, moving.map { String(format: "%.2fs", $0) } ?? "never", stalls, watch, behind,
                      String(describing: player.currentItem?.error))
                player.pause()
            }
            let sorted = starts.sorted()
            NSLog("[LiveAVPlayerTests] continuous start median: %@ fps, keyframe %.2fs, %@, bind after %.0fs: %@ (%@) over %d of %d runs",
                  fps, keyframes, codec, lead, sorted.isEmpty ? "never" : String(format: "%.2fs", sorted[sorted.count / 2]), lead > 0 ? "from the bind" : "from the open",
                  sorted.count, runs)
        }
    }

    /// A self-described live session bound at each start buffer plays with an enabled audio track, AAC and AC-3 alike.
    func testAVPlayerPlaysALiveSessionWithItsAudioAtEachStartBuffer() throws {
        for buffer in [2.0, 15.0] {
            for codec in ["aac", "ac3"] {
                let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-audio-\(UUID().uuidString)")
                defer { try? FileManager.default.removeItem(at: root) }
                let feed = try startLiveFeed(in: root, segments: 1, audio: ["-c:a", codec])
                defer { feed.terminate() }
                let origin = try RecordingDirectoryServer(root: root)
                defer { origin.stop() }
                var config = makeConfig(durationSeconds: 0, inputUrl: "\(origin.base)/live.m3u8", videoRange: "", codecs: "",
                                        width: 0, height: 0, frameRate: 0, bandwidth: 0, isLive: true, liveSegmentSeconds: 2)
                config.describesInput = true
                config.liveBufferSeconds = buffer
                let session = try RemuxSession(config: config)
                session.start()
                defer { session.stop() }
                let (server, url) = try serve(session)
                defer { server.stop() }
                awaitStartBuffer(session, seconds: buffer)

                let player = AVPlayer(url: url)
                player.play()
                let played = spin(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 4 }
                let audible = player.currentItem?.tracks.contains { $0.assetTrack?.mediaType == .audio && $0.isEnabled } ?? false
                let master = session.masterPlaylist().split(separator: "\n").filter { $0.hasPrefix("#EXT-X-MEDIA") || $0.hasPrefix("#EXT-X-STREAM-INF") }.joined(separator: " | ")
                NSLog("[LiveAVPlayerTests] %@ at a %.0fs start buffer: played %@, audio track %@, master %@, error %@",
                      codec, buffer, played ? "yes" : "no", audible ? "yes" : "no", master, String(describing: player.currentItem?.error))
                XCTAssertTrue(played, "\(codec) at \(buffer)s never played")
                XCTAssertTrue(audible, "\(codec) at \(buffer)s played without an audio track")
                player.pause()
            }
        }
    }

    /// The start buffer: AVPlayer bound once the session holds 15s, as the app binds it, starts with them ahead.
    func testAVPlayerBoundAfterTheStartBufferStartsWithItAhead() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-gate-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let feed = try startLiveFeed(in: root, segments: 1)
        defer { feed.terminate() }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let session = try startedSession(source: "\(origin.base)/live.m3u8", bufferSeconds: 15)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }
        awaitStartBuffer(session, seconds: 15)

        let bound = Date()
        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 0.5 }, "never played: \(String(describing: player.currentItem?.error))")
        let started = Date().timeIntervalSince(bound)
        spin(seconds: 3) { false }
        let ahead = player.currentItem?.loadedTimeRanges.last.map { $0.timeRangeValue.end.seconds - player.currentTime().seconds } ?? -1
        NSLog("[LiveAVPlayerTests] bound after the start buffer: playing after %.1fs with %.1fs loaded ahead; error %@", started, ahead, String(describing: player.currentItem?.error))
        XCTAssertNil(player.currentItem?.error)
        XCTAssertGreaterThanOrEqual(ahead, 12, "the player did not start with the buffer ahead of it")
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

    /// Bound once the engine holds 15s, AVPlayer plays through a 13s feed silence the engine reopens in the session,
    /// waiting no longer than the part of the outage its loaded buffer did not cover.
    func testAVPlayerStartsBehindItsBufferAndRidesAFeedGap() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-avplayer-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let feed = try startLiveFeed(in: root)
        defer { feed.terminate() }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let session = try startedSession(source: "\(origin.base)/live.m3u8")
        defer { session.stop() }
        let lock = NSLock()
        var reopenedAt: Date?
        session.onLive = { payload in
            guard payload["event"] as? String == "reopened" else { return }
            lock.lock()
            reopenedAt = reopenedAt ?? Date()
            lock.unlock()
        }
        XCTAssertTrue(spin(seconds: 40) { (session.progress()["bufferedSeconds"] as? Double ?? 0) >= 15 }, "the engine never held 15s")
        let (server, url) = try serve(session)
        defer { server.stop() }

        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 30) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 0.5 }, "never played: \(String(describing: player.currentItem?.error))")
        func loadedAhead() -> Double {
            guard let range = player.currentItem?.loadedTimeRanges.last?.timeRangeValue else { return -1 }
            return range.end.seconds - player.currentTime().seconds
        }
        spin(seconds: 4) { false }
        let startAhead = loadedAhead()

        var waited = 0.0
        origin.goSilent()
        let gap = Date()
        while Date().timeIntervalSince(gap) < 13 {
            spin(seconds: 0.25) { false }
            if player.timeControlStatus == .waitingToPlayAtSpecifiedRate { waited += 0.25 }
        }
        origin.speakAgain()
        let before = player.currentTime().seconds
        let after = Date()
        while Date().timeIntervalSince(after) < 20 {
            spin(seconds: 0.25) { false }
            if player.timeControlStatus == .waitingToPlayAtSpecifiedRate { waited += 0.25 }
        }
        lock.lock()
        let reopened = reopenedAt
        lock.unlock()
        let back = try XCTUnwrap(reopened, "the engine never reopened the silent feed")
        let uncovered = max(0, back.timeIntervalSince(gap) + 2 - startAhead)
        NSLog("[LiveAVPlayerTests] loaded %.1fs ahead 4s in; reopened %.1fs into the gap, %.1fs uncovered; waited %.2fs; clock %.1fs -> %.1fs; error %@",
              startAhead, back.timeIntervalSince(gap), uncovered, waited, before, player.currentTime().seconds, String(describing: player.currentItem?.error))
        XCTAssertLessThanOrEqual(waited, uncovered + 0.5, "the player waited longer than the outage its buffer did not cover")
        XCTAssertNil(player.currentItem?.error)
        XCTAssertGreaterThan(player.currentTime().seconds, before + 10, "the clock did not carry on past the gap")
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
