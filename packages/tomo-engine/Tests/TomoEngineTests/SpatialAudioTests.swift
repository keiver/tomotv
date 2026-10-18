import AVFoundation
import Libavcodec
import Libavformat
import SpatialAudioBridge
import XCTest

@testable import TomoEngine

/// TrueHD Atmos and DTS:X through the real pipeline as APAC, played by the host's own AVPlayer.
/// The media cases opt in with TOMO_SPATIAL_SOURCE, an MKV of several minutes whose first audio
/// track is TrueHD Atmos or DTS:X with H.264 or HEVC video.
final class SpatialAudioTests: XCTestCase {
    override func setUp() {
        super.setUp()
        SpatialAudio.forgetTracks()
    }

    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private func serve(_ session: RemuxSession) throws -> (LocalHTTPServer, URL) {
        let server = LocalHTTPServer { path in
            let parts = path.split(separator: "/").map(String.init)
            guard parts.count == 2, parts[0] == session.token else { return .notFound }
            return session.route(parts[1])
        }
        let port = try server.start()
        return (server, try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/\(session.token)/master.m3u8")))
    }

    @discardableResult
    private func spin(seconds: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// The source's duration and its first audio stream, read the way the pipeline reads them.
    private func probe(_ path: String) throws -> (duration: Double, audio: Int) {
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, path, nil, nil) >= 0, let input = ctx else { throw XCTSkip("cannot open \(path)") }
        defer { avformat_close_input(&ctx) }
        guard avformat_find_stream_info(input, nil) >= 0 else { throw XCTSkip("no stream info in \(path)") }
        let audio = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, -1, nil, 0)
        guard audio >= 0 else { throw XCTSkip("no audio in \(path)") }
        return (Double(input.pointee.duration) / Double(AV_TIME_BASE), Int(audio))
    }

    private func session(for path: String, extraTrack: Int? = nil) throws -> RemuxSession {
        let (duration, audio) = try probe(path)
        let tracks = [RemuxAudioTrack(index: audio, name: "Atmos", language: "eng", serverAudioUrl: "")]
            + (extraTrack.map { [RemuxAudioTrack(index: $0, name: "Commentary", language: "eng", serverAudioUrl: "")] } ?? [])
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: duration, inputUrl: path, audioTracks: tracks,
            width: 1920, height: 1080, frameRate: 23.976, bandwidth: 40_000_000, readAheadSegments: 1))
        session.start()
        return session
    }

    private var fixtureDir: URL {
        get throws {
            let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent(".build/spatial-fixtures", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir
        }
    }

    /// A fixture made from `source`, named after it so another source makes its own.
    private func derived(from source: String, _ suffix: String) throws -> URL {
        try fixtureDir.appendingPathComponent("\(URL(fileURLWithPath: source).deletingPathExtension().lastPathComponent)-\(suffix).mkv")
    }

    private func ffmpeg(_ arguments: [String], output: URL) throws -> URL {
        if FileManager.default.fileExists(atPath: output.path) { return output }
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y"] + arguments + [output.path]
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw XCTSkip("ffmpeg could not write \(output.lastPathComponent)") }
        return output
    }

    func testSpatialTrackPlaysAsAPACThroughSeeks() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let session = try session(for: path)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }

        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("apac.31.03"), master)
        XCTAssertTrue(master.contains("CHANNELS=\"12\",URI=\"a0.m3u8\""), master)
        XCTAssertTrue(session.mediaPlaylist(prefix: "a0").contains("#EXTINF:3.200000,\na0-seg0.m4s"))

        // A short buffer keeps the read near the playhead, so the jump below lands past it.
        let player = AVPlayer(playerItem: {
            let item = AVPlayerItem(url: url)
            item.preferredForwardBufferDuration = 4
            return item
        }())
        player.play()
        XCTAssertTrue(spin(seconds: 60) { player.currentItem?.status == .readyToPlay }, "never ready: \(String(describing: player.currentItem?.error))")
        XCTAssertTrue(spin(seconds: 60) { player.currentTime().seconds >= 8 }, "stalled at \(player.currentTime().seconds)s: \(String(describing: player.currentItem?.error))")
        XCTAssertTrue(SpatialAudioOutput.playsSpatialAudio(try XCTUnwrap(player.currentItem)))

        // A jump past the produced range restarts the read, and so does one back into a range
        // the prune has dropped; the audio follows on its grid both times.
        for target in [session.config.durationSeconds * 0.6, 30] {
            let restarts = session.seekRestarts
            player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            XCTAssertTrue(spin(seconds: 60) { player.currentTime().seconds >= target + 4 && player.currentTime().seconds < target + 30 },
                          "stalled at \(player.currentTime().seconds)s after the seek to \(target)s: \(String(describing: player.currentItem?.error))")
            XCTAssertGreaterThan(session.seekRestarts, restarts, "the seek to \(target)s restarted nothing")
        }
        XCTAssertNil(player.currentItem?.error)
        XCTAssertFalse(session.hasFailed)
    }

    /// A scrub leaves requests the player no longer waits on: only the newest one moves the read,
    /// and the segment it gets opens with the lead a held response sends at once.
    func testOnlyTheNewestSpatialRequestRestartsTheRead() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let session = try session(for: path)
        defer { session.stop() }
        XCTAssertTrue(session.masterPlaylist().contains("apac.31.03"))
        let spatial = try XCTUnwrap(session.spatialRendition("a0"))
        let index = { (seconds: Double) in Int(seconds / SpatialAudio.startSeconds(1)) }

        let waiters = DispatchGroup()
        var requests: [SegmentRequest] = []
        for seconds in [60.0, 90, 120, 150] {
            let request = SegmentRequest()
            requests.append(request)
            DispatchQueue.global().async(group: waiters) { _ = session.spatialSegmentURL(index(seconds), spatial, request: request) }
            usleep(300_000)
        }
        defer {
            requests.forEach { $0.abandon() }
            waiters.wait()
        }
        XCTAssertTrue(spin(seconds: 20) { spatial.has(index(150)) }, "the newest request was never served")
        let restarts = session.seekRestarts
        // The older ones stay stranded and would re-assert every 2 s.
        spin(seconds: 5) { false }
        XCTAssertEqual(session.seekRestarts, restarts, "a request a newer one replaced moved the read")

        let segment = try Data(contentsOf: session.dir.appendingPathComponent(spatial.segmentName(index(150))))
        XCTAssertTrue(segment.starts(with: RemuxSession.stypBox), "opens with \(Array(segment.prefix(32)))")
    }

    /// The player asking for video far from a spatial request it left waiting moves the read there for
    /// good: the spatial request does not drag it back.
    func testANewerVideoRequestFarAwayOutranksAWaitingSpatialRequest() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let session = try session(for: path)
        defer { session.stop() }
        XCTAssertTrue(session.masterPlaylist().contains("apac.31.03"))
        let spatial = try XCTUnwrap(session.spatialRendition("a0"))
        let request = SegmentRequest()
        let waiter = DispatchGroup()
        DispatchQueue.global().async(group: waiter) { _ = session.spatialSegmentURL(Int(300 / SpatialAudio.startSeconds(1)), spatial, request: request) }
        defer {
            request.abandon()
            waiter.wait()
        }
        // The video request follows the spatial one, before its segment can land.
        let entered = Date().addingTimeInterval(5)
        while session.stateLock.withLock({ session.spatialWaiters }) == 0, Date() < entered { usleep(1000) }
        XCTAssertNotNil(session.segmentURL(10))
        let restarts = session.seekRestarts
        spin(seconds: 5) { false }
        XCTAssertEqual(session.seekRestarts, restarts, "the waiting spatial request moved the read back")
    }

    /// A video and a spatial seek asked in one control pass: one position takes the earlier target,
    /// two take the one nearer the newest request.
    func testAVideoAndASpatialSeekAskedTogether() {
        let seek = { (video: Int?, spatial: Int?, playhead: Int) in RemuxSession.combinedSeek(video: video, spatial: spatial, playhead: playhead, window: 4) }
        XCTAssertNil(seek(nil, nil, 0))
        XCTAssertEqual(seek(50, nil, 50), 50)
        XCTAssertEqual(seek(nil, 49, 50), 49)
        XCTAssertEqual(seek(50, 49, 50), 49)
        XCTAssertEqual(seek(50, 12, 50), 50, "a scrub's leftover spatial seek")
        XCTAssertEqual(seek(10, 49, 50), 49, "a scrub's leftover video seek")
        XCTAssertNil(seek(nil, 12, 50), "a leftover spatial seek after a video request served from disk")
    }

    /// After a burst of skips (measured on Apple TV: 147 to 152 and back for 20 s), a spatial segment ahead
    /// of the read waits for the video requests the read reaches on its way instead of jumping over them.
    func testASpatialSegmentAheadYieldsToVideoRequestsOnTheWay() {
        let restarts = { (video: Int, producing: Int, stranded: Bool, waiting: [Int], queued: Bool) in
            RemuxSession.spatialRestarts(videoSegment: video, producing: producing, stranded: stranded, waiting: waiting, seekQueued: queued, window: 20)
        }
        XCTAssertTrue(restarts(152, 140, false, [152], false), "nothing waits on the way")
        XCTAssertFalse(restarts(152, 147, false, [148, 150, 152], false), "the read reaches the burst's requests first")
        XCTAssertFalse(restarts(152, 147, false, [152], true), "a restart is already queued")
        XCTAssertFalse(restarts(152, 151, false, [152], false), "the read is about to reach it")
        XCTAssertTrue(restarts(152, 100, false, [120, 152], false), "too far ahead to wait for the read")
        XCTAssertTrue(restarts(152, 152, true, [152], false), "the running session will not reach it")
        XCTAssertFalse(restarts(152, 152, true, [152], true), "stranded, behind a queued restart")
    }

    /// The video requests a burst of skips leaves (measured on Apple TV: 119 to 135, re-asserting in turn
    /// for 18 s behind a spatial track's slower read) wait; only the newest and its neighbours move the read.
    func testOnlyTheNewestVideoRequestAndItsNeighboursReassert() {
        XCTAssertTrue(RemuxSession.reasserts(135, newest: 135))
        XCTAssertTrue(RemuxSession.reasserts(134, newest: 135), "the other track at the playhead")
        XCTAssertTrue(RemuxSession.reasserts(137, newest: 135))
        XCTAssertFalse(RemuxSession.reasserts(122, newest: 135), "left behind by the burst")
        XCTAssertFalse(RemuxSession.reasserts(140, newest: 135))
    }

    /// A spatial rendition is never measured: the master counts the APAC rate for it when the source
    /// declares less.
    func testTheMasterCountsTheAPACRateForASpatialRendition() throws {
        let track = RemuxAudioTrack(index: 1, name: "Atmos", language: "eng", serverAudioUrl: "")
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60, audioTracks: [track]))
        defer { session.stop() }
        session.stateLock.withLock {
            session.indexedSourcePeak = 10_000_000
            session.spatialAnnounced = ["a0"]
        }
        XCTAssertEqual(session.originalPeakBandwidths([track], splitAudio: true, fallback: 1).original, 10_000_000 + SpatialAudio.bitRate)
    }

    /// The average counts it too, over a known video rate.
    func testTheMasterAverageCountsTheAPACRate() throws {
        var config = makeConfig(durationSeconds: 60, audioTracks: [RemuxAudioTrack(index: 1, name: "Atmos", language: "eng", serverAudioUrl: "")])
        config.primaryVideoBandwidth = 10_000_000
        let session = try RemuxSession(config: config)
        defer { session.stop() }
        session.stateLock.withLock {
            session.spatialSplit = true
            session.resolvedAudioCodecs["a0"] = SpatialAudio.codecs
        }
        XCTAssertTrue(session.masterPlaylist().contains("AVERAGE-BANDWIDTH=\(10_000_000 + SpatialAudio.bitRate)"))
    }

    /// A session whose pipeline never runs, holding one spatial rendition the test drives by hand.
    private func unstartedSpatialSession(trueHD: Bool = true) throws -> (RemuxSession, RemuxSession.Rendition, SpatialAudio) {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60))
        let spatial = SpatialAudio(prefix: "a0", streamIndex: 1, trueHD: trueHD, priming: 2048, totalFrames: 60 * 48_000, dir: session.dir, refusalKey: "test#1")
        let rendition = RemuxSession.Rendition(prefix: "a0", inputStreams: [1], transcoder: nil)
        rendition.spatial = spatial
        session.stateLock.withLock {
            session.renditions = [rendition]
            session.sourceReady = true
        }
        return (session, rendition, spatial)
    }

    func testDTSSyncPointsAcceptEveryCorePackingAndHDSubstreams() throws {
        let (session, _, spatial) = try unstartedSpatialSession(trueHD: false)
        defer { session.stop() }
        let syncWords: [[UInt8]] = [[0x7F, 0xFE, 0x80, 0x01], [0xFE, 0x7F, 0x01, 0x80],
                                    [0x1F, 0xFF, 0xE8, 0x00], [0xFF, 0x1F, 0x00, 0xE8],
                                    [0x64, 0x58, 0x20, 0x25]]
        for word in syncWords {
            XCTAssertTrue(spatial.isSyncPoint(Data(word + [0, 0, 0, 0])))
            XCTAssertFalse(spatial.isSyncPoint(Data(word.prefix(3))))
        }
        XCTAssertFalse(spatial.isSyncPoint(Data([0, 0, 0, 0])))
    }

    func testInputEndingBeforeASpatialSessionStartsFallsBack() throws {
        guard #available(macOS 26, *) else { throw XCTSkip("SpatialAudioBridge needs macOS 26") }
        let (session, _, spatial) = try unstartedSpatialSession()
        defer { session.stop() }
        spatial.finish()
        XCTAssertNotNil(spatial.failure)
        XCTAssertFalse(spatial.isAccepted)
        spatial.decline("another refusal")
        let refusal = spatial.failure
        spatial.finish()
        XCTAssertEqual(spatial.failure, refusal)
    }

    func testAStagedSegmentFromBeforeResetCannotReplaceTheCurrentFile() throws {
        let (session, _, spatial) = try unstartedSpatialSession()
        defer { session.stop() }
        let old = session.dir.appendingPathComponent(".old-segment")
        let current = session.dir.appendingPathComponent(".current-segment")
        let oldInit = session.dir.appendingPathComponent(".old-init")
        let currentInit = session.dir.appendingPathComponent(".current-init")
        for url in [old, oldInit] { try Data([1]).write(to: url) }
        for url in [current, currentInit] { try Data([2]).write(to: url) }

        spatial.reset()
        try spatial.install(current, index: 0, generation: 1)
        try spatial.install(currentInit, index: nil, generation: 1)
        try spatial.install(old, index: 0, generation: 0)
        try spatial.install(oldInit, index: nil, generation: 0)

        XCTAssertEqual(try Data(contentsOf: session.dir.appendingPathComponent(spatial.segmentName(0))), Data([2]))
        XCTAssertEqual(try Data(contentsOf: session.dir.appendingPathComponent(spatial.initName)), Data([2]))
        XCTAssertTrue(spatial.has(0))
        XCTAssertTrue(spatial.isAccepted)
        XCTAssertNil(spatial.failure)
    }

    /// AirPlay starting on a player of a session that plays spatial audio sends it back to FLAC, and no
    /// session converts until it stops.
    func testAirPlaySendsSpatialAudioBackToFLAC() throws {
        let (session, _, spatial) = try unstartedSpatialSession()
        defer { session.stop() }
        SpatialAudioOutput.name(["Atmos"], session: session)
        defer { SpatialAudioOutput.forget(token: session.token) }
        var atmos = AVCodecParameters()
        atmos.codec_id = AV_CODEC_ID_TRUEHD
        atmos.profile = AV_PROFILE_TRUEHD_ATMOS
        atmos.sample_rate = 48_000
        let item = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:1/\(session.token)/master.m3u8")))

        SpatialAudioOutput.externalPlayback(true, id: "player", item: item)
        XCTAssertNotNil(spatial.failure)
        XCTAssertFalse(SpatialAudio.eligible(atmos))
        spatial.rememberRefusal(reopening: true)
        SpatialAudioOutput.externalPlayback(false, id: "player", item: nil)
        XCTAssertTrue(SpatialAudio.eligible(atmos))
        XCTAssertFalse(SpatialAudio.takesRefusal("test#1"), "AirPlay must not leave a refusal for the next local playback")
    }

    /// TrueHD converts only with an Atmos presentation; DTS-HD MA is tried, since FFmpeg reads
    /// alternate DTS:X as plain; DTS core never; nothing but 48 kHz.
    func testOnlyAtmosAndLosslessDTSAreEligible() {
        let parameters = { (codec: AVCodecID, profile: Int32, rate: Int32) -> AVCodecParameters in
            var parameters = AVCodecParameters()
            parameters.codec_id = codec
            parameters.profile = profile
            parameters.sample_rate = rate
            return parameters
        }
        XCTAssertTrue(SpatialAudio.eligible(parameters(AV_CODEC_ID_TRUEHD, AV_PROFILE_TRUEHD_ATMOS, 48_000)))
        XCTAssertFalse(SpatialAudio.eligible(parameters(AV_CODEC_ID_TRUEHD, AV_PROFILE_UNKNOWN, 48_000)))
        XCTAssertTrue(SpatialAudio.eligible(parameters(AV_CODEC_ID_DTS, AV_PROFILE_DTS_HD_MA, 48_000)))
        XCTAssertTrue(SpatialAudio.eligible(parameters(AV_CODEC_ID_DTS, AV_PROFILE_DTS_HD_MA_X, 48_000)))
        XCTAssertFalse(SpatialAudio.eligible(parameters(AV_CODEC_ID_DTS, AV_PROFILE_DTS, 48_000)))
        XCTAssertFalse(SpatialAudio.eligible(parameters(AV_CODEC_ID_TRUEHD, AV_PROFILE_TRUEHD_ATMOS, 96_000)))
    }

    /// Only content the library will never render is held against the track for the process; a
    /// discontinuity starts a new session, and any other error costs this session alone.
    func testOnlyContentRefusalsAreRemembered() throws {
        guard #available(macOS 26, *) else { throw XCTSkip("SpatialAudioBridge needs macOS 26") }
        XCTAssertEqual(SpatialAudio.disposition(of: SpatialAudioError.unsupported("no Atmos presentation")), .remember)
        XCTAssertEqual(SpatialAudio.disposition(of: SpatialAudioError.invalidConfiguration("layout")), .remember)
        XCTAssertEqual(SpatialAudio.disposition(of: SpatialAudioError.discontinuity("The audio timestamps jump")), .newSession)
        XCTAssertEqual(SpatialAudio.disposition(of: SpatialAudioError.decoding("truncated")), .refuse)
        XCTAssertEqual(SpatialAudio.disposition(of: SpatialAudioError.source("range ignored")), .refuse)
        XCTAssertEqual(SpatialAudio.disposition(of: SpatialAudioError.encoding("encoder")), .refuse)
        XCTAssertEqual(SpatialAudio.disposition(of: URLError(.timedOut)), .refuse)
    }

    /// A segment the conversion alone puts below realtime sends the track back to FLAC; one the rest
    /// of the read makes slow is the device's verdict as before.
    func testOnlyAConversionThatAloneIsTooSlowGoesBack() {
        XCTAssertTrue(SpatialAudio.slowsSegment(produced: 7, converting: 2, segment: 6))
        XCTAssertFalse(SpatialAudio.slowsSegment(produced: 9, converting: 2, segment: 6), "slow without the conversion too")
        XCTAssertFalse(SpatialAudio.slowsSegment(produced: 5, converting: 2, segment: 6), "realtime")
        XCTAssertFalse(SpatialAudio.slowsSegment(produced: 7, converting: 0, segment: 6), "nothing converted")
    }

    /// A refusal whose rebuild has not run when the master's budget ends holds the master until it has:
    /// the FLAC name must not serve the spatial playlist.
    func testTheMasterWaitsPastItsBudgetForARefusedTracksRebuild() throws {
        let (session, rendition, spatial) = try unstartedSpatialSession()
        defer { session.stop() }
        spatial.decline("refused")
        let returned = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            session.awaitSpatialVerdict()
            returned.signal()
        }
        XCTAssertEqual(returned.wait(timeout: .now() + RemuxSession.masterBudgetSeconds + 1), .timedOut, "the master went out before the rebuild")
        session.stateLock.withLock { rendition.spatial = nil }
        XCTAssertEqual(returned.wait(timeout: .now() + 2), .success)
    }

    /// A source retry rebuilds the renditions: a waiting spatial request follows the one serving its
    /// prefix now, here rebuilt without spatial audio, not the instance it was routed to.
    func testAWaitingSpatialRequestFollowsARebuiltRendition() throws {
        let (session, rendition, spatial) = try unstartedSpatialSession()
        defer { session.stop() }
        let request = SegmentRequest()
        let answered = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            _ = session.spatialSegmentURL(5, spatial, request: request)
            answered.signal()
        }
        defer { request.abandon() }
        usleep(300_000)
        session.stateLock.withLock { session.renditions = [RemuxSession.Rendition(prefix: "a0", inputStreams: rendition.inputStreams, transcoder: nil)] }
        XCTAssertEqual(answered.wait(timeout: .now() + 2), .success, "the request waited on the instance it was routed to")
    }

    /// A source retry that no longer builds the spatial rendition, its refusal remembered, still
    /// builds the audio rendition the master lists.
    func testASourceRetryKeepsTheSpatialAudioGroup() throws {
        let source = try ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=12",
                                 "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12",
                                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25", "-c:a", "aac", "-t", "12"],
                                output: try fixtureDir.appendingPathComponent("video-and-aac.mkv"))
        let (duration, audio) = try probe(source.path)
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: duration, inputUrl: source.path,
            audioTracks: [RemuxAudioTrack(index: audio, name: "Stereo", language: "eng", serverAudioUrl: "")],
            width: 320, height: 240, frameRate: 25, bandwidth: 2_000_000, readAheadSegments: 1))
        defer { session.stop() }
        // What the source pipeline's first run leaves behind.
        session.spatialSplit = true
        session.start()

        XCTAssertTrue(session.masterPlaylist().contains("URI=\"a0.m3u8\""))
        XCTAssertTrue(spin(seconds: 10) { session.rendition(withPrefix: "a0") != nil }, "the master lists a0 and the pipeline never built it")
    }

    /// The activator follows the selection: another track turns it off, the spatial one back on.
    func testSelectingAnotherTrackLeavesSpatialOutput() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let source = try ffmpeg(["-i", path, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                                 "-map", "0:v", "-map", "0:a:0", "-map", "1:a", "-c:v", "copy", "-c:a:0", "copy",
                                 "-c:a:1", "ac3", "-ac:a:1", "6", "-t", "60"],
                                output: try derived(from: path, "and-ac3"))
        let session = try session(for: source.path, extraTrack: 2)
        defer { session.stop() }
        let (server, url) = try serve(session)
        defer { server.stop() }

        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("apac.31.03") && master.contains("ac-3"), master)
        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spin(seconds: 60) { player.currentItem?.status == .readyToPlay }, "never ready: \(String(describing: player.currentItem?.error))")
        let item = try XCTUnwrap(player.currentItem)
        let group = try XCTUnwrap(item.asset.mediaSelectionGroup(forMediaCharacteristic: .audible))
        XCTAssertTrue(SpatialAudioOutput.playsSpatialAudio(item))

        item.select(group.options[1], in: group)
        XCTAssertFalse(SpatialAudioOutput.playsSpatialAudio(item))
        let switched = player.currentTime().seconds
        XCTAssertTrue(spin(seconds: 60) { player.currentTime().seconds >= switched + 6 }, "stalled after the switch: \(String(describing: item.error))")
        item.select(group.options[0], in: group)
        XCTAssertTrue(SpatialAudioOutput.playsSpatialAudio(item))
        XCTAssertNil(item.error)
    }

    /// Timestamps that jump 2 s at 0.6 s end the library's session: a new one takes over at the next
    /// sync, on the grid, and the track stays APAC.
    func testATimestampJumpStartsANewSession() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let source = try ffmpeg(["-i", path, "-map", "0:v", "-map", "0:a:0", "-c", "copy", "-t", "20",
                                 "-bsf:a", "setts=pts='if(gte(PTS*TB,0.6),PTS+2/TB,PTS)':dts='if(gte(DTS*TB,0.6),DTS+2/TB,DTS)'"],
                                output: try derived(from: path, "gap"))
        let session = try session(for: source.path)
        defer { session.stop() }

        XCTAssertTrue(session.masterPlaylist().contains("apac.31.03"))
        let spatial = try XCTUnwrap(session.spatialRendition("a0"))
        XCTAssertTrue(spin(seconds: 30) { spatial.has(2) }, "no segment after the jump")
        XCTAssertTrue(spatial.has(0) && spatial.has(1), "the segment the jump interrupted is missing")
        XCTAssertNil(spatial.failure)
        XCTAssertFalse(session.hasFailed)
    }

    /// Timestamps that jump in the last packets leave no packet to open a new session on: the track
    /// goes back to FLAC rather than leave its last segment unmade.
    func testATimestampJumpAtTheEndFallsBack() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let source = try ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=4", "-t", "4", "-i", path,
                                 "-map", "0:v", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25", "-c:a", "copy",
                                 "-bsf:a", "setts=pts='if(gte(PTS*TB,3.9),PTS+2/TB,PTS)':dts='if(gte(DTS*TB,3.9),DTS+2/TB,DTS)'"],
                                output: try derived(from: path, "end-gap"))
        let session = try session(for: source.path)
        defer { session.stop() }
        XCTAssertTrue(spin(seconds: 30) { session.stateLock.withLock { session.reachedEnd } })
        XCTAssertTrue(spin(seconds: 30) {
            guard let spatial = session.spatialRendition("a0") else { return session.rendition(withPrefix: "a0")?.transcoder != nil }
            return (0..<spatial.segmentCount).allSatisfy(spatial.has)
        }, "the last segment is neither made nor handed to the transcoder")
        XCTAssertFalse(session.hasFailed)
    }

    /// Every packet of the first audio track of `path`, fed as the pipeline feeds them.
    private func feed(_ spatial: SpatialAudio, from path: String) throws {
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, path, nil, nil) >= 0, let input = ctx else { throw XCTSkip("cannot open \(path)") }
        defer { avformat_close_input(&ctx) }
        guard avformat_find_stream_info(input, nil) >= 0 else { throw XCTSkip("no stream info in \(path)") }
        let audio = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, -1, nil, 0)
        let timeBase = try XCTUnwrap(input.pointee.streams[Int(audio)]).pointee.time_base
        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        let pkt = try XCTUnwrap(packet)
        while av_read_frame(input, pkt) >= 0 {
            if pkt.pointee.stream_index == audio { spatial.feed(pkt, timeBase: timeBase) }
            av_packet_unref(pkt)
        }
    }

    /// A converter writing to `dir`, and four seconds of the source's first audio track alone to feed it.
    @available(macOS 26, *)
    private func fourSecondConverter(totalFrames: Int64, dir: URL) throws -> (SpatialAudio, String) {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let source = try ffmpeg(["-i", path, "-map", "0:a:0", "-c", "copy", "-t", "4"], output: try derived(from: path, "audio-4s")).path
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, source, nil, nil) >= 0, let input = ctx else { throw XCTSkip("cannot open \(source)") }
        let trueHD = try XCTUnwrap(input.pointee.streams[0]).pointee.codecpar.pointee.codec_id == AV_CODEC_ID_TRUEHD
        avformat_close_input(&ctx)
        let spatial = SpatialAudio(prefix: "a0", streamIndex: 0, trueHD: trueHD, priming: try APACConfiguration().encoderPrimingDuration().value,
                                   totalFrames: totalFrames, dir: dir, refusalKey: "test#0")
        return (spatial, source)
    }

    /// A segment the cache will not take sends the track back to FLAC instead of leaving its request waiting.
    func testASegmentTheCacheWillNotTakeFallsBack() throws {
        guard #available(macOS 26, *) else { throw XCTSkip("SpatialAudioBridge needs macOS 26") }
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let (spatial, source) = try fourSecondConverter(totalFrames: 8 * 48_000, dir: missing)
        defer { spatial.stop() }
        spatial.open(atSessionStart: true)
        try feed(spatial, from: source)
        spatial.finish()
        XCTAssertTrue(spin(seconds: 30) { spatial.failure != nil }, "the track stayed APAC with nothing written")
        XCTAssertFalse(spatial.has(0))
    }

    /// A new session after the input ended does not wait behind the silence the last one still pads.
    func testANewSessionDoesNotWaitBehindTheLastOnesPadding() throws {
        guard #available(macOS 26, *) else { throw XCTSkip("SpatialAudioBridge needs macOS 26") }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let (spatial, source) = try fourSecondConverter(totalFrames: 20 * 60 * 48_000, dir: dir)
        defer { spatial.stop() }
        spatial.open(atSessionStart: true)
        try feed(spatial, from: source)
        spatial.finish()
        XCTAssertTrue(spin(seconds: 30) { spatial.has(2) })

        spatial.reset()
        spatial.prune(outside: 1200...1200)
        spatial.open(atSessionStart: true)
        let started = Date()
        try feed(spatial, from: source)
        spatial.finish()
        XCTAssertTrue(spin(seconds: 10) { spatial.has(0) }, "the new session waited behind the last one's padding")
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
        XCTAssertNil(spatial.failure)
    }

    /// Small copied video beside the source's spatial track, so the read runs ahead of the conversion.
    private func shortCopy(from path: String, length: Int) throws -> RemuxSession {
        let source = try ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=\(length)", "-i", path,
                                 "-map", "0:v", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25",
                                 "-c:a", "copy", "-t", "\(length)"],
                                output: try derived(from: path, "copy-of-\(length)"))
        return try session(for: source.path)
    }

    /// A refusal that lands once the read has parked at the end of the file is still acted on.
    func testRefusalAfterTheReadEndsFallsBack() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let session = try shortCopy(from: path, length: 4)
        defer { session.stop() }
        XCTAssertTrue(spin(seconds: 30) { session.stateLock.withLock { session.reachedEnd } })
        try XCTUnwrap(session.spatialRendition("a0")).decline("refused")
        XCTAssertTrue(spin(seconds: 30) { session.spatialRendition("a0") == nil && session.rendition(withPrefix: "a0")?.transcoder != nil })
        XCTAssertFalse(session.hasFailed)
    }

    /// A refusal that lands while the read holds at its read-ahead cap is acted on without a request.
    func testRefusalWhileTheReadHoldsFallsBack() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let session = try shortCopy(from: path, length: 40)
        defer { session.stop() }
        XCTAssertTrue(spin(seconds: 30) { session.stateLock.withLock { session.producingSegment >= 2 } })
        spin(seconds: 1) { false }
        try XCTUnwrap(session.spatialRendition("a0")).decline("refused")
        XCTAssertTrue(spin(seconds: 30) { session.spatialRendition("a0") == nil && session.rendition(withPrefix: "a0")?.transcoder != nil })
        XCTAssertFalse(session.hasFailed)
    }

    /// Of two lossless tracks only the preferred one converts: one encoder per read.
    func testOnlyThePreferredTrackConverts() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let source = try ffmpeg(["-i", path, "-map", "0:v", "-map", "0:a:0", "-map", "0:a:0", "-c", "copy", "-t", "20"],
                                output: try derived(from: path, "twice"))
        let session = try session(for: source.path, extraTrack: 2)
        defer { session.stop() }
        let master = session.masterPlaylist()
        XCTAssertEqual(master.components(separatedBy: "apac.31.03").count - 1, 1, master)
        XCTAssertNotNil(session.spatialRendition("a0"))
        XCTAssertNil(session.spatialRendition("a1"))
        XCTAssertNotNil(session.rendition(withPrefix: "a1")?.transcoder)
    }

    /// A refusal the process remembers plays the track as FLAC in the same audio-only rendition, so
    /// the layout does not change between plays.
    func testARememberedRefusalKeepsTheLayout() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let remembered = SpatialAudio(prefix: "a0", streamIndex: Int32(try probe(path).audio), trueHD: true, priming: 2048, totalFrames: 1,
                                      dir: FileManager.default.temporaryDirectory, refusalKey: SpatialAudio.refusalKey(inputUrl: path, streamIndex: Int32(try probe(path).audio)))
        remembered.decline("no Atmos presentation", remembered: true)
        remembered.rememberRefusal(reopening: false)
        let session = try session(for: path)
        defer { session.stop() }
        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("URI=\"a0.m3u8\"") && !master.contains("apac"), master)
        XCTAssertNil(session.spatialRendition("a0"))
        XCTAssertNotNil(session.rendition(withPrefix: "a0")?.transcoder)
    }

    /// With no configured tracks the master has no member to list a split rendition under: the
    /// stream the demuxer picks stays muxed with the video, on the transcoder.
    func testUnconfiguredTrackStaysMuxed() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let session = try RemuxSession(config: makeConfig(durationSeconds: try probe(path).duration, inputUrl: path, width: 1920, height: 1080, readAheadSegments: 1))
        session.start()
        defer { session.stop() }
        let master = session.masterPlaylist()
        XCTAssertFalse(master.contains("AUDIO=\"audio\"") || master.contains("apac"), master)
        XCTAssertNil(session.rendition(withPrefix: "a0"))
        XCTAssertNotNil(session.rendition(withPrefix: "")?.transcoder)
    }

    /// Two sessions failing on one track at once each leave their own replacement on FLAC.
    func testEachFailedSessionLeavesItsReplacementOnFLAC() {
        for _ in 0..<2 {
            let failing = SpatialAudio(prefix: "a0", streamIndex: 1, trueHD: true, priming: 2048, totalFrames: 1,
                                       dir: FileManager.default.temporaryDirectory, refusalKey: "shared#1")
            failing.decline("encoder")
            failing.rememberRefusal(reopening: true)
        }
        XCTAssertTrue(SpatialAudio.takesRefusal("shared#1"))
        XCTAssertTrue(SpatialAudio.takesRefusal("shared#1"))
        XCTAssertFalse(SpatialAudio.takesRefusal("shared#1"), "a third session converts again")
    }

    /// A refusal holds for one track of one media source on one server, whatever key the URL carries.
    func testRefusalKeysKeepServersAndMediaSourcesApart() {
        let key = { SpatialAudio.refusalKey(inputUrl: $0, streamIndex: 1) }
        let url = "http://a.test:8096/Videos/item/stream?Static=true&MediaSourceId=one&ApiKey=k1"
        XCTAssertEqual(key(url), key(url.replacingOccurrences(of: "k1", with: "k2")))
        XCTAssertNotEqual(key(url), key(url.replacingOccurrences(of: "MediaSourceId=one", with: "MediaSourceId=two")))
        XCTAssertNotEqual(key(url), key(url.replacingOccurrences(of: "a.test", with: "b.test")))
        XCTAssertNotEqual(key(url), SpatialAudio.refusalKey(inputUrl: url, streamIndex: 2))
        XCTAssertNotEqual(key("http://a.test/Videos/item/stream"), key("https://a.test/Videos/item/stream"))
        XCTAssertEqual(key("https://a.test/Videos/item/stream"), key("https://A.test:443/Videos/item/stream"))
    }

    /// Beside a ladder whose rungs carry the server's audio under the same names, the spatial track
    /// is withdrawn before the master: it plays as FLAC, and the process does not hold it against
    /// the track, so a session on a faster link still offers it.
    func testLadderWithServerAudioWithdrawsSpatialAudio() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let (duration, audio) = try probe(path)
        let rungs = LocalHTTPServer { requested in
            guard requested.hasSuffix(".m3u8") else { return .notFound }
            let segments = (0..<Int(duration / 6)).map { "#EXTINF:6.0,\nseg\($0).m4s\n" }.joined()
            return .data(Data("#EXTM3U\n#EXT-X-TARGETDURATION:6\n\(segments)#EXT-X-ENDLIST\n".utf8), contentType: "application/vnd.apple.mpegurl")
        }
        let base = "http://127.0.0.1:\(try rungs.start())"
        defer { rungs.stop() }
        var track = RemuxAudioTrack(index: audio, name: "Atmos", language: "eng", serverAudioUrl: "\(base)/audio.m3u8")
        track.serverAudioChannels = 2
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: duration, inputUrl: path, audioTracks: [track], width: 1920, height: 1080, bandwidth: 40_000_000,
            readAheadSegments: 1, tiers: [TierConfig(playlistUrl: "\(base)/t0.m3u8", bandwidth: 1_500_000, codecs: "avc1.64001F", width: 854, height: 480)]))
        // The link carries the copy as the session opens, and no longer by the master.
        session.testLinkBps = 1_000_000_000
        session.start()
        defer { session.stop() }
        XCTAssertTrue(spin(seconds: 30) { session.spatialRendition("a0") != nil && session.tierActive })
        session.stateLock.lock()
        session.testLinkBps = 1_000_000
        session.stateLock.unlock()

        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("audio-lo") && !master.contains("apac"), master)
        XCTAssertTrue(spin(seconds: 10) { session.spatialRendition("a0") == nil && session.rendition(withPrefix: "a0")?.transcoder != nil })
        XCTAssertFalse(session.hasFailed)

        let next = try self.session(for: path)
        defer { next.stop() }
        XCTAssertTrue(spin(seconds: 30) { next.spatialRendition("a0") != nil })
    }

    private func plainFixture(_ encoder: String, _ args: [String]) throws -> URL {
        try ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25", "-c:a", encoder] + args,
                   output: try fixtureDir.appendingPathComponent("plain-\(encoder).mkv"))
    }

    private func assertRefusedOntoTheTranscoder(_ path: String) throws {
        let session = try session(for: path)
        defer { session.stop() }
        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("fLaC") && !master.contains("apac"), master)
        XCTAssertNil(session.spatialRendition("a0"))
        XCTAssertNotNil(session.rendition(withPrefix: "a0")?.transcoder)
    }

    /// A refusal after the master that the process does not remember still holds for the session that
    /// reopens the engine, so a lasting encoder error cannot loop; the session after converts again.
    func testARefusalThatReopensHoldsForTheReopenedSession() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_SPATIAL_SOURCE"] else { throw XCTSkip("set TOMO_SPATIAL_SOURCE") }
        let first = try session(for: path)
        defer { first.stop() }
        XCTAssertTrue(first.masterPlaylist().contains("apac.31.03"))
        try XCTUnwrap(first.spatialRendition("a0")).decline("encoder")
        XCTAssertTrue(spin(seconds: 30) { first.hasFailed }, "the named track's refusal did not end the session")

        let reopened = try session(for: path)
        defer { reopened.stop() }
        XCTAssertFalse(reopened.masterPlaylist().contains("apac"))
        let later = try session(for: path)
        defer { later.stop() }
        XCTAssertTrue(later.masterPlaylist().contains("apac.31.03"))
    }

    /// TrueHD without an Atmos presentation takes the transcoder untried.
    func testPlainTrueHDStaysOnTheTranscoder() throws {
        let session = try session(for: try plainFixture("truehd", ["-strict", "-2", "-ac", "2"]).path)
        defer { session.stop() }
        XCTAssertFalse(session.masterPlaylist().contains("apac"))
        XCTAssertNil(session.rendition(withPrefix: "a0"))
        XCTAssertNotNil(session.rendition(withPrefix: "")?.transcoder)
    }

    /// Plain DTS-HD MA, the same: TOMO_PLAIN_DTS_SOURCE is a file whose first audio track is one.
    /// The engine converts only beside video, so a small one is muxed in.
    func testPlainDTSHDMAIsRefusedOntoTheTranscoder() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_PLAIN_DTS_SOURCE"] else { throw XCTSkip("set TOMO_PLAIN_DTS_SOURCE") }
        let source = try ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=12", "-i", path,
                                 "-map", "0:v", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25",
                                 "-c:a", "copy", "-shortest"],
                                output: try derived(from: path, "with-video"))
        try assertRefusedOntoTheTranscoder(source.path)
    }

    /// Fed to a converter anyway, plain TrueHD and DTS core are refused by the probe before any
    /// segment, and the refusal holds for the process.
    func testTheProbeRefusesATrackThatNeverRendersForTheProcess() throws {
        guard #available(macOS 26, *) else { throw XCTSkip("SpatialAudioBridge needs macOS 26") }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        for (encoder, trueHD) in [("truehd", true), ("dca", false)] {
            let source = try plainFixture(encoder, ["-strict", "-2", "-ac", "2"])
            let spatial = SpatialAudio(prefix: encoder, streamIndex: 1, trueHD: trueHD, priming: try APACConfiguration().encoderPrimingDuration().value,
                                       totalFrames: 3 * 48_000, dir: dir, refusalKey: "\(encoder)#1")
            defer { spatial.stop() }
            spatial.open(atSessionStart: true)
            try feed(spatial, from: source.path)
            XCTAssertTrue(spin(seconds: 10) { spatial.failure != nil }, "\(encoder) passed the probe")
            spatial.rememberRefusal(reopening: false)
            XCTAssertTrue(SpatialAudio.takesRefusal("\(encoder)#1"))
            XCTAssertTrue(SpatialAudio.takesRefusal("\(encoder)#1"), "\(encoder) was refused for one session only")
            XCTAssertFalse(spatial.has(0))
        }
    }

    /// DTS without its lossless extension never carries DTS:X: it takes the transcoder untried.
    func testDTSCoreStaysOnTheTranscoder() throws {
        let session = try session(for: try plainFixture("dca", ["-strict", "-2", "-ac", "2"]).path)
        defer { session.stop() }
        XCTAssertFalse(session.masterPlaylist().contains("apac"))
        XCTAssertNil(session.rendition(withPrefix: "a0"))
        XCTAssertNotNil(session.rendition(withPrefix: "")?.transcoder)
    }
}
