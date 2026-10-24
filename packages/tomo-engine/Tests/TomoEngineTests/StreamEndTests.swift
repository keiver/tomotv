import AVFoundation
import XCTest

@testable import TomoEngine

/// Files whose streams end at different times. The video track decides where an item ends: audio
/// past the last frame is not played, and audio that stops first is carried on with silence, since
/// AVPlayer ends an item with its audio (measured here). Jellyfin's runtime is the LONGEST stream,
/// so before this the playlist promised segments past the picture that were never written, a 404
/// AVPlayer turns into a hard -1100. Measured on Apple TV: an episode whose audio ran 8s past its
/// picture stopped at the picture's end with "Video not found on server", and the Up Next
/// countdown never started.
final class StreamEndTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let ffprobe = "/opt/homebrew/bin/ffprobe"

    private struct Shape {
        let name: String
        let video: Double
        let audio: Double
        let tracks: Int
        let ext: String
    }

    // Short side 20s, long side 34s: the long side's last segment (24s on) opens past where the
    // short side stops, the case the grid's remainder cannot absorb.
    private static let audioTailMuxed = Shape(name: "audio-tail-muxed", video: 20, audio: 34, tracks: 1, ext: "mp4")
    private static let audioTailSplit = Shape(name: "audio-tail-split", video: 20, audio: 34, tracks: 2, ext: "mp4")
    private static let audioTailMatroska = Shape(name: "audio-tail-muxed", video: 20, audio: 34, tracks: 1, ext: "mkv")
    private static let videoTailMuxed = Shape(name: "video-tail-muxed", video: 34, audio: 20, tracks: 1, ext: "mp4")
    private static let videoTailSplit = Shape(name: "video-tail-split", video: 34, audio: 20, tracks: 2, ext: "mp4")

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func fixture(_ shape: Shape) throws -> URL {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let out = Self.fixtureDir.appendingPathComponent("\(shape.name)-v\(Int(shape.video))-a\(Int(shape.audio)).\(shape.ext)")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        var args = ["-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=\(shape.video)"]
        for track in 0..<shape.tracks {
            args += ["-f", "lavfi", "-i", "sine=frequency=\(440 + 220 * track):sample_rate=48000:duration=\(shape.audio)"]
        }
        args += ["-map", "0:v"] + (1...shape.tracks).flatMap { ["-map", "\($0):a"] }
        // Written aside and moved into place, so a run that dies mid-encode leaves nothing the cache would reuse.
        let partial = Self.fixtureDir.appendingPathComponent("partial-\(out.lastPathComponent)")
        args += ["-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "high", "-g", "48", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-b:a", "64k", partial.path]
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw XCTSkip("ffmpeg could not build \(out.lastPathComponent)") }
        try FileManager.default.moveItem(at: partial, to: out)
        return out
    }

    /// The container's duration, the way Jellyfin's probe reports RunTimeTicks.
    private func runtime(_ url: URL) throws -> Double {
        guard FileManager.default.isExecutableFile(atPath: Self.ffprobe) else { throw XCTSkip("no ffprobe at \(Self.ffprobe)") }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffprobe)
        p.arguments = ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url.path]
        let pipe = Pipe()
        p.standardOutput = pipe
        try p.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return try XCTUnwrap(Double(String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    private func session(_ shape: Shape) throws -> (RemuxSession, ThrottledFileServer, Double) {
        let url = try fixture(shape)
        let duration = try runtime(url)
        let server = try ThrottledFileServer(data: try Data(contentsOf: url), bytesPerSecond: 50_000_000)
        let tracks = shape.tracks > 1
            ? (1...shape.tracks).map { RemuxAudioTrack(index: $0, name: "Track \($0)", language: "eng", serverAudioUrl: "") }
            : []
        let session = try RemuxSession(config: makeConfig(durationSeconds: duration, inputUrl: "http://127.0.0.1:\(server.port)/clip.\(shape.ext)",
                                                          audioTracks: tracks, codecs: "avc1.64000D,mp4a.40.2", width: 320, height: 180, frameRate: 24))
        return (session, server, duration)
    }

    /// The grid ends at the last frame, and every rendition answers every segment it declares, in
    /// order, the way AVPlayer walks them. The master goes first, as AVPlayer's does: it waits for the
    /// opened input, which is where the picture's length is read.
    private func assertEveryDeclaredSegmentIsServed(_ shape: Shape, file: StaticString = #filePath, line: UInt = #line) throws {
        let (session, server, duration) = try session(shape)
        defer { server.stop() }
        session.start()
        defer { session.stop() }
        _ = session.masterPlaylist()
        XCTAssertEqual(session.durationSeconds, shape.video, accuracy: 0.1, "\(shape.name).\(shape.ext): the grid does not end at the picture",
                       file: file, line: line)
        let prefixes = [""] + (shape.tracks > 1 ? (0..<shape.tracks).map { session.audioPrefix($0) } : [])
        var missing: [String] = []
        for n in 0..<session.segmentCount {
            for prefix in prefixes where session.segmentURL(n, prefix: prefix) == nil {
                missing.append("\(prefix.isEmpty ? "seg" : "\(prefix)-seg")\(n)")
            }
        }
        XCTAssertEqual(missing, [], "\(shape.name).\(shape.ext): declared \(session.segmentCount) segments for \(duration)s, never served \(missing)",
                       file: file, line: line)
    }

    func testAudioOutlastingMuxedVideoServesEverySegment() throws {
        try assertEveryDeclaredSegmentIsServed(Self.audioTailMuxed)
    }

    func testAudioOutlastingSplitVideoServesEverySegment() throws {
        try assertEveryDeclaredSegmentIsServed(Self.audioTailSplit)
    }

    func testAudioOutlastingVideoInMatroskaServesEverySegment() throws {
        try assertEveryDeclaredSegmentIsServed(Self.audioTailMatroska)
    }

    func testVideoOutlastingMuxedAudioServesEverySegment() throws {
        try assertEveryDeclaredSegmentIsServed(Self.videoTailMuxed)
    }

    func testVideoOutlastingSplitAudioServesEverySegment() throws {
        try assertEveryDeclaredSegmentIsServed(Self.videoTailSplit)
    }

    /// The player's view: from `from` (default: shortly before the short stream stops), the item
    /// plays to the picture's last frame and posts DidPlayToEndTime there, the notification the Up
    /// Next countdown starts on, with the item's duration the picture's.
    private func assertAVPlayerEndsWithThePicture(_ shape: Shape, from: Double? = nil, file: StaticString = #filePath, line: UInt = #line) throws {
        let (session, server, duration) = try session(shape)
        defer { server.stop() }
        session.start()
        defer { session.stop() }
        let (loopback, url) = try serveOverLoopback(session)
        defer { loopback.stop() }

        let item = AVPlayerItem(url: url)
        var ended = false
        var failure: Error?
        let center = NotificationCenter.default
        let endObserver = center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in ended = true }
        let failObserver = center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { note in
            failure = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
        }
        defer {
            center.removeObserver(endObserver)
            center.removeObserver(failObserver)
        }
        let player = AVPlayer(playerItem: item)
        XCTAssertTrue(spinMainRunLoop(seconds: 60) { item.status != .unknown }, "never ready", file: file, line: line)
        XCTAssertEqual(item.status, .readyToPlay, "item failed: \(String(describing: item.error))", file: file, line: line)
        XCTAssertEqual(item.duration.seconds, shape.video, accuracy: 0.5, "\(shape.name).\(shape.ext): the item's duration is not the picture's",
                       file: file, line: line)
        var sought = false
        player.seek(to: CMTime(seconds: from ?? min(shape.video, shape.audio) - 4, preferredTimescale: 600)) { _ in sought = true }
        XCTAssertTrue(spinMainRunLoop(seconds: 30) { sought }, "seek never completed", file: file, line: line)
        player.play()
        spinMainRunLoop(seconds: duration + 30) { ended || failure != nil || item.status == .failed }
        let at = player.currentTime().seconds
        XCTAssertNil(failure ?? item.error, "\(shape.name).\(shape.ext) failed at \(at)s of \(duration)s: \(String(describing: failure ?? item.error))",
                     file: file, line: line)
        XCTAssertTrue(ended, "\(shape.name).\(shape.ext) never reached its end: clock at \(at)s of \(duration)s", file: file, line: line)
        XCTAssertEqual(at, shape.video, accuracy: 0.5, "\(shape.name).\(shape.ext) ended at \(at)s, not with the picture", file: file, line: line)
    }

    func testAVPlayerEndsAudioOutlastingMuxedVideoWithThePicture() throws {
        try assertAVPlayerEndsWithThePicture(Self.audioTailMuxed)
    }

    func testAVPlayerEndsAudioOutlastingSplitVideoWithThePicture() throws {
        try assertAVPlayerEndsWithThePicture(Self.audioTailSplit)
    }

    func testAVPlayerPlaysVideoOutlastingMuxedAudioToItsLastFrame() throws {
        try assertAVPlayerEndsWithThePicture(Self.videoTailMuxed)
    }

    func testAVPlayerPlaysVideoOutlastingSplitAudioToItsLastFrame() throws {
        try assertAVPlayerEndsWithThePicture(Self.videoTailSplit)
    }

    /// A seek into the silent stretch after the audio stopped plays on to the last frame.
    func testAVPlayerSeekingPastTheAudioPlaysThePictureOut() throws {
        try assertAVPlayerEndsWithThePicture(Self.videoTailSplit, from: 28)
    }
}
