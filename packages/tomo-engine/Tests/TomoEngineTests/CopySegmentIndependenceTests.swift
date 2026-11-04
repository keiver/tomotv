import AVFoundation
import Foundation
import Libavcodec
import Libavformat
import XCTest
@testable import TomoEngine

/// Issue 115: a copied VOD segment has to decode on its own, the init then that one fragment, as a
/// player decodes the segment a far seek lands on. Sources with a keyframe every 10 s against 6 s
/// segments, the shape the report measured (H.264 Main, 24 fps, AC-3).
final class CopySegmentIndependenceTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 120.0
    /// Far jumps that land mid-GOP on a 6 s grid with keyframes every 10 s.
    private static let farSeconds = [54.0, 84.0, 108.0]

    private static let dir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private static func h264(gop: Int) -> [String] {
        ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-bf", "3",
         "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-b:v", "300k"]
    }

    /// x265 opens a GOP on a CRA by default: its leading B-frames reference the previous GOP.
    private static func hevc(openGop: Bool) -> [String] {
        ["-c:v", "libx265", "-preset", "veryfast",
         "-x265-params", "keyint=240:min-keyint=240:scenecut=0:bframes=3:open-gop=\(openGop ? 1 : 0):log-level=error",
         "-pix_fmt", "yuv420p", "-b:v", "300k", "-tag:v", "hvc1"]
    }

    /// `toPipe` writes through stdout, which the Matroska muxer cannot seek, so it leaves out the Cues.
    private static func fixture(_ name: String, video: [String], audio: [String] = ["-c:a", "ac3", "-b:a", "96k"],
                                format: [String] = [], toPipe: Bool = false) -> URL? {
        let out = dir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: out.path) { return out }
        guard FileManager.default.isExecutableFile(atPath: ffmpeg) else { return nil }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y",
                       "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
                       "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(seconds)]
            + video + audio + format + [toPipe ? "pipe:1" : out.path]
        let partial = out.appendingPathExtension("partial")
        if toPipe {
            FileManager.default.createFile(atPath: partial.path, contents: nil)
            guard let handle = try? FileHandle(forWritingTo: partial) else { return nil }
            p.standardOutput = handle
        } else {
            p.standardOutput = FileHandle.nullDevice
        }
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return nil }
        if toPipe { try? FileManager.default.moveItem(at: partial, to: out) }
        return FileManager.default.fileExists(atPath: out.path) ? out : nil
    }

    private static let mkvWithCues = fixture("gop10-h264-ac3.mkv", video: h264(gop: 240))
    private static let mkvWithoutCues = fixture("gop10-h264-ac3-nocues.mkv", video: h264(gop: 240), format: ["-f", "matroska"], toPipe: true)
    private static let mp4 = fixture("gop10-h264-ac3.mp4", video: h264(gop: 240), format: ["-movflags", "+faststart"])
    private static let mpegts = fixture("gop10-h264-ac3.ts", video: h264(gop: 240), format: ["-f", "mpegts"])
    private static let hevcMkv = fixture("gop10-hevc-closed-ac3.mkv", video: hevc(openGop: false))
    private static let openGopHevcMkv = fixture("gop10-hevc-ac3.mkv", video: hevc(openGop: true))
    /// AAC's priming packet at -0.021 s, the opening keyframe decoded at -0.083 s and presented at 0 (ffprobe).
    private static let aacMp4 = fixture("gop10-h264-aac.mp4", video: h264(gop: 240), audio: ["-c:a", "aac", "-b:a", "96k"], format: ["-movflags", "+faststart"])
    private static let longGopMp4 = fixture("gop25-h264-ac3.mp4", video: h264(gop: 600), format: ["-movflags", "+faststart"])

    /// Matroska's Cues element ID: present in a file that carries a keyframe index.
    private static func hasCues(_ data: Data) -> Bool { data.range(of: Data([0x1C, 0x53, 0xBB, 0x6B])) != nil }

    struct SegmentReading {
        let index: Int
        let firstPacketIsKey: Bool
        let packets: Int
        let decoded: Int
        /// Presentation seconds of the fragment's first video and first audio packet, nil without them.
        let firstVideoSeconds: Double?
        let firstAudioSeconds: Double?
    }

    /// The init and one fragment, read alone: whether the first video packet is a keyframe, how many of its
    /// video packets decode to a picture, and where its audio starts.
    static func read(initSegment: Data, fragment: Data, index: Int) -> SegmentReading? {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("copy-segment-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: file) }
        guard (try? (initSegment + fragment).write(to: file)) != nil,
              let decoded = IFrameOracle.decode(file.path) else { return nil }
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, file.path, nil, nil) >= 0, let input = ctx else { return nil }
        defer { avformat_close_input(&ctx) }
        guard avformat_find_stream_info(input, nil) >= 0 else { return nil }
        let video = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        let audio = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, -1, nil, 0)
        var packetPtr = av_packet_alloc()
        defer { av_packet_free(&packetPtr) }
        guard video >= 0, let packet = packetPtr else { return nil }
        var firstIsKey: Bool?
        var firstVideo: Double?
        var firstAudio: Double?
        while av_read_frame(input, packet) >= 0, firstIsKey == nil || (audio >= 0 && firstAudio == nil) {
            defer { av_packet_unref(packet) }
            if packet.pointee.stream_index == video, firstIsKey == nil, let stream = input.pointee.streams[Int(video)] {
                firstIsKey = packet.pointee.flags & 1 != 0 // AV_PKT_FLAG_KEY
                firstVideo = Double(packet.pointee.pts) * av_q2d(stream.pointee.time_base)
            } else if packet.pointee.stream_index == audio, firstAudio == nil, let stream = input.pointee.streams[Int(audio)] {
                firstAudio = Double(packet.pointee.pts) * av_q2d(stream.pointee.time_base)
            }
        }
        return SegmentReading(index: index, firstPacketIsKey: firstIsKey ?? false, packets: decoded.packets,
                              decoded: decoded.frames.count, firstVideoSeconds: firstVideo, firstAudioSeconds: firstAudio)
    }

    private func readings(session: RemuxSession, segments: [Int]) throws -> [SegmentReading] {
        try segments.map { n in
            let segment = try XCTUnwrap(session.segmentURL(n), "segment \(n) is served")
            let initSegment = try Data(contentsOf: try XCTUnwrap(session.initSegmentURL(), "the init is served"))
            let reading = try XCTUnwrap(Self.read(initSegment: initSegment, fragment: try Data(contentsOf: segment), index: n), "segment \(n) reads")
            NSLog("[CopySegmentIndependence] segment %d: first video packet %@, %d of %d packets decode",
                  n, reading.firstPacketIsKey ? "is a keyframe" : "is NOT a keyframe", reading.decoded, reading.packets)
            return reading
        }
    }

    private func assertIndependent(_ readings: [SegmentReading], _ label: String) {
        for r in readings {
            XCTAssertTrue(r.firstPacketIsKey, "\(label): segment \(r.index) opens on a keyframe")
            XCTAssertEqual(r.decoded, r.packets, "\(label): every video packet of segment \(r.index) decodes on its own")
        }
    }

    private func session(for file: URL?, bytesPerSecondOfMedia speed: Double, codecs: String) throws -> (RemuxSession, ThrottledFileServer) {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let url = try XCTUnwrap(file, "ffmpeg produced no fixture")
        let bytes = try Data(contentsOf: url)
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / Self.seconds * speed))
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/\(url.lastPathComponent)",
                                                          codecs: codecs, width: 320, height: 180, frameRate: 24, bandwidth: 600_000))
        session.start()
        return (session, server)
    }

    private struct PlaylistShape {
        let target: Int
        let durations: [Double]
    }

    private func shape(_ playlist: String) -> PlaylistShape {
        let lines = playlist.split(separator: "\n")
        let target = lines.first { $0.hasPrefix("#EXT-X-TARGETDURATION:") }.flatMap { Int($0.dropFirst(22)) } ?? 0
        let durations = lines.compactMap { $0.hasPrefix("#EXTINF:") ? Double($0.dropFirst(8).split(separator: ",").first ?? "") : nil }
        return PlaylistShape(target: target, durations: durations)
    }

    private func onKeyframeGrid(_ session: RemuxSession) -> Bool {
        session.stateLock.lock()
        defer { session.stateLock.unlock() }
        return !session.keyframeStarts.isEmpty
    }

    /// The playlist a keyframe grid publishes: lengths adding up to the runtime, none under a second at the end,
    /// a target that covers the longest.
    private func assertPlaylistShape(_ session: RemuxSession, _ label: String) {
        let shape = shape(session.mediaPlaylist())
        XCTAssertFalse(shape.durations.isEmpty, "\(label): the playlist lists segments")
        XCTAssertEqual(shape.durations.reduce(0, +), Self.seconds, accuracy: 0.05, "\(label): the lengths add up to the runtime")
        XCTAssertGreaterThan(shape.durations.last ?? 0, 1, "\(label): the last segment is longer than a second")
        XCTAssertGreaterThanOrEqual(Double(shape.target), (shape.durations.max() ?? 0).rounded(.up), "\(label): the target covers the longest segment")
    }

    /// Far segments asked for while the read is near the start: each is reached through a seek-restart and decodes alone.
    private func assertFarSeeks(_ file: URL?, codecs: String = "avc1.4D400D,ac-3", label: String) throws {
        let (session, server) = try session(for: file, bytesPerSecondOfMedia: 2, codecs: codecs)
        defer {
            session.stop()
            server.stop()
        }
        XCTAssertNotNil(session.segmentURL(0))
        XCTAssertTrue(onKeyframeGrid(session), "\(label): the session cuts on the source's keyframes")
        assertPlaylistShape(session, label)
        let far = try readings(session: session, segments: Self.farSeconds.map { session.segmentIndex(atSeconds: $0) })
        session.stateLock.lock()
        let restarts = session.seekRestarts
        session.stateLock.unlock()
        XCTAssertGreaterThanOrEqual(restarts, 1, "\(label): the far segments were reached through a seek")
        assertIndependent(far, label)
    }

    /// Every segment in order off a fast link, one generation from the start: no seek involved.
    private func assertForwardRun(_ file: URL?, codecs: String = "avc1.4D400D,ac-3", label: String) throws {
        let (session, server) = try session(for: file, bytesPerSecondOfMedia: 50, codecs: codecs)
        defer {
            session.stop()
            server.stop()
        }
        let count = session.mediaPlaylist().components(separatedBy: "#EXTINF:").count - 1
        XCTAssertGreaterThan(count, 0, "\(label): the playlist lists segments")
        assertIndependent(try readings(session: session, segments: Array(0..<count)), label)
    }

    func testTheMatroskaFixtureCarriesCues() throws {
        let file = try XCTUnwrap(Self.mkvWithCues, "ffmpeg produced no fixture")
        XCTAssertTrue(Self.hasCues(try Data(contentsOf: file)))
        let piped = try XCTUnwrap(Self.mkvWithoutCues, "ffmpeg produced no fixture")
        XCTAssertFalse(Self.hasCues(try Data(contentsOf: piped)), "written through a pipe, the Matroska file has no Cues")
    }

    func testFarSeeksInAMatroskaFileWithCues() throws { try assertFarSeeks(Self.mkvWithCues, label: "mkv with Cues") }
    func testFarSeeksInAnMP4File() throws { try assertFarSeeks(Self.mp4, label: "mp4") }
    func testFarSeeksInAnHEVCMatroskaFile() throws { try assertFarSeeks(Self.hevcMkv, codecs: "hvc1.1.6.L60.90,ac-3", label: "hevc mkv") }

    func testAForwardRunOfAMatroskaFileWithCues() throws { try assertForwardRun(Self.mkvWithCues, label: "mkv with Cues, forward") }
    func testAForwardRunOfAnMP4File() throws { try assertForwardRun(Self.mp4, label: "mp4, forward") }
    func testAForwardRunOfAnHEVCMatroskaFile() throws { try assertForwardRun(Self.hevcMkv, codecs: "hvc1.1.6.L60.90,ac-3", label: "hevc mkv, forward") }

    /// An open-GOP source's segments open on its CRA keyframes; alone, only the leading B-frames that
    /// reference the previous GOP (3 here) do not decode. A copy cannot change the source's GOP.
    func testAnOpenGOPHEVCFileLosesOnlyItsLeadingPictures() throws {
        let (session, server) = try session(for: Self.openGopHevcMkv, bytesPerSecondOfMedia: 50, codecs: "hvc1.1.6.L60.90,ac-3")
        defer {
            session.stop()
            server.stop()
        }
        _ = session.mediaPlaylist()
        XCTAssertTrue(onKeyframeGrid(session))
        for r in try readings(session: session, segments: Array(0..<session.segmentCount)) {
            XCTAssertTrue(r.firstPacketIsKey, "segment \(r.index) opens on a keyframe")
            XCTAssertGreaterThanOrEqual(r.decoded, r.packets - 3, "segment \(r.index) loses at most its leading pictures")
        }
    }

    /// Sources whose index lists only what was read stay on the fixed grid, and still open on their first keyframe.
    private func assertFixedGridKeepsTheOpening(_ file: URL?, label: String) throws {
        let (session, server) = try session(for: file, bytesPerSecondOfMedia: 50, codecs: "avc1.4D400D,ac-3")
        defer {
            session.stop()
            server.stop()
        }
        XCTAssertEqual(shape(session.mediaPlaylist()).durations.count, 20, "\(label): the fixed 6 s grid")
        XCTAssertFalse(onKeyframeGrid(session), "\(label): no keyframe grid without a full index")
        assertIndependent(try readings(session: session, segments: [0]), label)
    }

    func testAMatroskaFileWithoutCuesStaysOnTheFixedGrid() throws { try assertFixedGridKeepsTheOpening(Self.mkvWithoutCues, label: "mkv without Cues") }
    func testAnMPEGTSFileStaysOnTheFixedGrid() throws { try assertFixedGridKeepsTheOpening(Self.mpegts, label: "mpegts") }

    /// Back to the start after a far jump: the MP4's opening keyframe decodes before it presents, and segment 0
    /// still opens whole on it rather than being withheld and restarted.
    func testScrubbingBackToTheStartOfAnMP4ServesSegmentZeroOnce() throws {
        let (session, server) = try session(for: Self.mp4, bytesPerSecondOfMedia: 2, codecs: "avc1.4D400D,ac-3")
        defer {
            session.stop()
            server.stop()
        }
        XCTAssertNotNil(session.segmentURL(0))
        XCTAssertNotNil(session.segmentURL(session.segmentIndex(atSeconds: 84)))
        session.pruneSegments(outside: 5...30)
        session.stateLock.lock()
        let before = session.seekRestarts
        session.stateLock.unlock()
        assertIndependent(try readings(session: session, segments: [0]), "mp4, back to the start")
        session.stateLock.lock()
        let restarts = session.seekRestarts - before
        session.stateLock.unlock()
        XCTAssertEqual(restarts, 1, "one restart serves segment 0")
    }

    /// AAC's priming packet sits before the opening keyframe: on the first read and restarted to segment 0, the
    /// audio starts at the opening picture, never before it.
    func testARestartToTheStartKeepsAACPrimingOut() throws {
        let (session, server) = try session(for: Self.aacMp4, bytesPerSecondOfMedia: 2, codecs: "avc1.4D400D,mp4a.40.2")
        defer {
            session.stop()
            server.stop()
        }
        let opening = try readings(session: session, segments: [0])
        XCTAssertNotNil(session.segmentURL(session.segmentIndex(atSeconds: 84)))
        session.pruneSegments(outside: 5...30)
        let again = try readings(session: session, segments: [0])
        for (label, reading) in [("first read", opening[0]), ("after a restart", again[0])] {
            let audio = try XCTUnwrap(reading.firstAudioSeconds, "\(label): segment 0 carries audio")
            let picture = try XCTUnwrap(reading.firstVideoSeconds, "\(label): segment 0 carries video")
            XCTAssertTrue(reading.firstPacketIsKey, "\(label): segment 0 opens on its keyframe")
            XCTAssertGreaterThanOrEqual(audio, picture - 0.001, "\(label): no audio before the opening picture")
        }
    }

    /// A 25 s keyframe interval makes 25 s segments: the read ahead still covers about the seconds it did on the fixed grid.
    func testLongSegmentsKeepTheReadAheadInSeconds() throws {
        let (session, server) = try session(for: Self.longGopMp4, bytesPerSecondOfMedia: 50, codecs: "avc1.4D400D,ac-3")
        defer {
            session.stop()
            server.stop()
        }
        assertPlaylistShape(session, "25 s GOP")
        XCTAssertTrue(onKeyframeGrid(session))
        session.stateLock.lock()
        let ahead = session.aheadWindow
        let count = session.keyframeStarts.count
        session.stateLock.unlock()
        let mean = Self.seconds / Double(count)
        XCTAssertLessThanOrEqual(Double(ahead) * mean, Double(RemuxSession.defaultAheadWindow) * RemuxSession.segmentDuration + mean,
                                 "read ahead stays within one segment of 30 s")
    }

    /// A session with a server rung on Jellyfin's grid: an equal 6 s list, as Jellyfin 12.2.0 answers a transcode
    /// playlist (measured: 235 segments of 6.000 s), and the film served with byte ranges, as Jellyfin serves it.
    /// `linkBps` stands in for the measured link.
    private func rungSession(linkBps: Double) throws -> (RemuxSession, LocalHTTPServer, ThrottledFileServer) {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let file = try XCTUnwrap(Self.mkvWithCues, "ffmpeg produced no fixture")
        let bytes = try Data(contentsOf: file)
        let source = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / Self.seconds * 50))
        let grid = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n"
            + (0..<20).map { "#EXTINF:6.000000,\nseg\($0).ts\n" }.joined() + "#EXT-X-ENDLIST\n"
        let origin = LocalHTTPServer { request in
            request == "/tier.m3u8" ? .data(Data(grid.utf8), contentType: "application/vnd.apple.mpegurl") : .notFound
        }
        let port = try origin.start()
        let base = "http://127.0.0.1:\(port)"
        var track = RemuxAudioTrack(index: 1, name: "Audio", language: "eng", serverAudioUrl: "\(base)/audio.m3u8")
        track.serverAudioChannels = 2
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(source.port)/source.mkv", audioTracks: [track],
            codecs: "avc1.4D400D,ac-3", width: 320, height: 180, frameRate: 24, bandwidth: 600_000,
            tierPlaylistUrl: "\(base)/tier.m3u8", tierBandwidth: 260_000, tierCodecs: "avc1.64000C,mp4a.40.2", tierWidth: 256, tierHeight: 144))
        session.testLinkBps = linkBps
        session.start()
        return (session, origin, source)
    }

    private func videoVariants(_ master: String) -> Int {
        master.split(separator: "\n").filter { $0.hasPrefix("#EXT-X-STREAM-INF") }.count
    }

    /// On a link that carries the copy, a session with rungs cuts the copy on its keyframes and lists it alone, as
    /// Jellyfin never lists a copy beside re-encodes; a master re-served after a subtitle swap lists it alone too.
    func testARungSessionOnALinkThatCarriesTheCopyListsItAloneOnItsKeyframes() throws {
        let (session, origin, source) = try rungSession(linkBps: 50_000_000)
        defer {
            session.stop()
            origin.stop()
            source.stop()
        }
        let master = session.masterPlaylist()
        XCTAssertEqual(videoVariants(master), 1, "the copy alone: \(master)")
        XCTAssertTrue(onKeyframeGrid(session), "the copy cuts on the source's keyframes")
        session.stateLock.lock()
        let adopted = session.adoptedStarts.count
        let latched = session.copyLatched
        session.stateLock.unlock()
        XCTAssertEqual(adopted, 0, "the rungs' grid is let go")
        XCTAssertTrue(latched)
        assertPlaylistShape(session, "copy beside rungs")
        assertIndependent(try readings(session: session, segments: Array(0..<session.segmentCount)), "copy beside rungs")
        session.testLinkBps = 100_000
        guard case .data(let again, _) = session.route("master1.m3u8") else { return XCTFail("no re-served master") }
        XCTAssertEqual(videoVariants(String(decoding: again, as: UTF8.self)), 1, "a slower link later still lists the copy alone")
    }

    /// On a link that cannot carry the copy, the session lets the source go and plays the rungs on Jellyfin's grid.
    func testARungSessionOnASlowLinkKeepsTheRungGrid() throws {
        let (session, origin, source) = try rungSession(linkBps: 100_000)
        defer {
            session.stop()
            origin.stop()
            source.stop()
        }
        XCTAssertTrue(spinMainRunLoop(seconds: 15) {
            session.stateLock.lock()
            defer { session.stateLock.unlock() }
            return session.sourceReleased
        }, "the source is let go")
        session.stateLock.lock()
        let adopted = session.adoptedStarts.count
        let latched = session.copyLatched
        session.stateLock.unlock()
        XCTAssertEqual(adopted, 20, "the rungs' 20-segment grid")
        XCTAssertFalse(latched)
        XCTAssertFalse(onKeyframeGrid(session))
    }

    /// The host's AVPlayer, the way a progress bar jumps: play, then seek far into segments that are not on disk, so
    /// each jump is served by a restart. Recorded per jump: where the first picture after the seek sits, the segments
    /// asked for, the clock and any error. The jump waits for AVPlayer's own requests to settle: a request still
    /// pending 30 s behind the target re-asserts its own seek against the jump's (a separate, older defect).
    func testAVPlayerFarJumpsShowThePictureAtTheTarget() throws {
        let (session, origin) = try session(for: Self.mkvWithCues, bytesPerSecondOfMedia: 50, codecs: "avc1.4D400D,ac-3")
        defer {
            session.stop()
            origin.stop()
        }
        let lock = NSLock()
        var requests: [String] = []
        let (server, url) = try serveOverLoopback(session) { name in
            lock.lock()
            requests.append(name)
            lock.unlock()
        }
        defer { server.stop() }
        let item = AVPlayerItem(url: url)
        // A short forward buffer, so a far jump lands outside what AVPlayer already holds.
        item.preferredForwardBufferDuration = 5
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: nil)
        item.add(output)
        let player = AVPlayer(playerItem: item)
        player.play()
        defer { player.pause() }
        XCTAssertTrue(spinMainRunLoop(seconds: 30) { player.currentTime().seconds > 1 }, "never played: \(String(describing: player.currentItem?.error))")
        for target in Self.farSeconds {
            var lastCount = -1
            var quietSince = Date()
            _ = spinMainRunLoop(seconds: 20) {
                lock.lock()
                let count = requests.count
                lock.unlock()
                if count != lastCount { lastCount = count; quietSince = Date() }
                return Date().timeIntervalSince(quietSince) >= 3
            }
            let landing = session.segmentIndex(atSeconds: target)
            session.pruneSegments(outside: max(0, landing - 4)...max(0, landing - 2))
            lock.lock()
            requests.removeAll()
            lock.unlock()
            var done = false
            player.seek(to: CMTime(seconds: target, preferredTimescale: 600)) { _ in done = true }
            _ = spinMainRunLoop(seconds: 10) { done }
            var shown: [Double] = []
            let watch = Date()
            while Date().timeIntervalSince(watch) < 14, shown.first(where: { $0 >= target - 0.5 }) == nil {
                let itemTime = output.itemTime(forHostTime: CACurrentMediaTime())
                if output.hasNewPixelBuffer(forItemTime: itemTime) {
                    var display = CMTime.invalid
                    if output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: &display) != nil, display.isNumeric { shown.append(display.seconds) }
                }
                RunLoop.main.run(until: Date().addingTimeInterval(0.02))
            }
            let first = shown.first { $0 >= target - 0.5 }
            lock.lock()
            let segments = requests.filter { $0.hasSuffix(".m4s") }
            lock.unlock()
            NSLog("[CopySegmentIndependence] AVPlayer jump to %.0fs: first picture at %@, clock %.1fs, asked %@, error %@",
                  target, first.map { String(format: "%.2fs", $0) } ?? "none", player.currentTime().seconds,
                  segments.joined(separator: " "), String(describing: player.currentItem?.error))
            let picture = try XCTUnwrap(first, "a picture after the jump to \(target)s")
            XCTAssertLessThanOrEqual(picture, target + 0.1, "the first picture after the jump to \(target)s sits at the target")
            XCTAssertTrue(segments.contains("seg\(session.segmentIndex(atSeconds: target)).m4s"), "the jump to \(target)s asked for its segment")
        }
        for event in player.currentItem?.errorLog()?.events ?? [] {
            NSLog("[CopySegmentIndependence] AVPlayer error log %d: %@", event.errorStatusCode, event.errorComment ?? "")
        }
    }

    /// A real film over its real link: TOMO_COPY_SOURCE (a URL), TOMO_COPY_DURATION, TOMO_COPY_SECONDS (comma list of jump targets).
    func testARealFilmsSegmentsStandAlone() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let url = environment["TOMO_COPY_SOURCE"], let duration = environment["TOMO_COPY_DURATION"].flatMap(Double.init) else {
            throw XCTSkip("set TOMO_COPY_SOURCE and TOMO_COPY_DURATION")
        }
        let targets = (environment["TOMO_COPY_SECONDS"] ?? "0,600,120,1500,450").split(separator: ",").compactMap { Double($0) }
        let session = try RemuxSession(config: makeConfig(durationSeconds: duration, inputUrl: url, codecs: "", width: 1920, height: 1080, bandwidth: 8_000_000))
        session.start()
        defer { session.stop() }
        _ = session.mediaPlaylist()
        let segments = targets.filter { $0 < duration }.map { session.segmentIndex(atSeconds: $0) }
        assertIndependent(try readings(session: session, segments: segments), "real film")
    }
}
