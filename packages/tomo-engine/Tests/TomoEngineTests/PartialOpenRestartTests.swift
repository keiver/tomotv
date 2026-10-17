import Foundation
import Libavformat
import Libavutil
import XCTest
@testable import TomoEngine

/// An MPEG-TS seek returns the same keyframe for the same target, so a restart whose keyframe lands
/// past the segment's start has to seek earlier or it withholds that segment forever (Apple TV,
/// The Daily Dweebs resumed at 245s: segment 40 re-seeked every 2s until the app gave up).
final class PartialOpenRestartTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0

    /// Keyframes every 5s against the 6s grid: segment 7 (42 to 48s) has no keyframe before 45s.
    private static let fixture = makeFixture(named: "gop5s-60s.ts", gopFrames: 120)
    /// The Daily Dweebs recording's shape: keyframes every 2.08s, never on the 6s grid.
    private static let unalignedFixture = makeFixture(named: "gop2s-60s.ts", gopFrames: 50)
    /// Matroska with cues at the end, keyframes every 2s, three minutes.
    private static let matroskaSeconds = 180.0
    private static let matroskaFixture = makeFixture(named: "gop2s-180s.mkv", gopFrames: 48, format: "matroska", seconds: matroskaSeconds)
    /// Keyframes every 10s: the probe reads one, so the keyframe index seeks for the cues.
    private static let longGopMatroskaFixture = makeFixture(named: "gop10s-180s.mkv", gopFrames: 240, format: "matroska", seconds: matroskaSeconds)

    private static func makeFixture(named name: String, gopFrames: Int, format: String = "mpegts", seconds: Double = PartialOpenRestartTests.seconds) -> URL? {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", String(seconds),
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-g", String(gopFrames), "-keyint_min", String(gopFrames), "-sc_threshold", "0", "-an", "-f", format, out.path,
        ]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        return p.terminationStatus == 0 && FileManager.default.fileExists(atPath: out.path) ? out : nil
    }

    func testARestartOnAKeyframePastTheSegmentStartStillServesTheSegment() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.fixture, "libx264 produced no fixture"))
        // Four times realtime: the forward read needs 10s to reach segment 7, so the request seeks instead.
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds / 4)))
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/gop.ts",
                                                          codecs: "avc1.64000D", width: 320, height: 180, frameRate: 24))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(7), "segment 7 is served, not withheld on every restart")
    }

    /// An MPEG-TS seek lands on a packet, and the next keyframe is past the segment's start: one seek, not two.
    func testAnMPEGTSResumeSeeksOnce() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.unalignedFixture, "libx264 produced no fixture"))
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds / 4)))
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/gop.ts",
                                                          codecs: "avc1.64000D", width: 320, height: 180, frameRate: 24))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(7))
        session.stateLock.lock()
        let restarts = session.seekRestarts
        session.stateLock.unlock()
        XCTAssertEqual(restarts, 1, "the seek starts a segment early, so the requested one opens whole")
    }

    /// A seek back whose HTTP request times out reads on from the old connection while FFmpeg's Matroska
    /// seek reports success: the restart seeks again instead of failing the session, on every visit. The
    /// server answers the ranged probe with 200, so the session reads through FFmpeg's HTTP.
    func testARestartWhoseSeekRequestStallsStillServesTheSegment() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.matroskaFixture, "libx264 produced no fixture"))
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: bytes.count / 4)
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.matroskaSeconds, inputUrl: "http://127.0.0.1:\(server.port)/gop.mkv",
                                                          codecs: "avc1.64000D", width: 320, height: 180, frameRate: 24))
        session.start()
        defer { session.stop() }
        for visit in 1...3 {
            XCTAssertNotNil(session.segmentURL(28), "visit \(visit)")
            server.stallRequests(below: bytes.count / 2)
            XCTAssertNotNil(session.segmentURL(1), "the restart for segment 1 failed the session on visit \(visit)")
        }
        XCTAssertFalse(session.hasFailed)
    }

    /// The seek's request stalls once: the read stays where it was until the seek repeats.
    func testASeekWhoseRequestStallsLandsOnItsTarget() throws {
        let (server, input) = try openMatroska(readingTo: 120)
        defer { close(input, server) }
        XCTAssertGreaterThanOrEqual(seekBackward(input, stream: -1, to: 6_000_000), 0)
        XCTAssertEqual(try firstVideoKeyframeSeconds(input), 6, accuracy: 0.01)
    }

    /// The first seek fetches the cues at the end; the requests back from there stall, leaving the read
    /// at the cues. The seek repeats until the read sits on its cue.
    func testASeekLeftAtTheCuesRepeats() throws {
        let (server, input) = try openMatroska(readingTo: nil)
        defer { close(input, server) }
        let pb = try XCTUnwrap(input.pointee.pb)
        server.stallRequests(2, below: Int(avio_tell(pb)) + 1)
        XCTAssertGreaterThanOrEqual(seekBackward(input, stream: -1, to: 0), 0)
        XCTAssertEqual(try firstVideoKeyframeSeconds(input), 0, accuracy: 0.01)
    }

    /// The keyframe index loads the cues with a seek to the start; that seek stalling the same way still
    /// leaves the read at the start, where the session's first generation opens.
    func testTheKeyframeIndexSeekLeftAtTheCuesRepeats() throws {
        let (server, input) = try openMatroska(readingTo: nil, fixture: Self.longGopMatroskaFixture)
        defer { close(input, server) }
        let video = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        let stream = try XCTUnwrap(input.pointee.streams[Int(video)])
        guard avformat_index_get_entries_count(stream) < 2 else { throw XCTSkip("the probe indexed the keyframes: no cue seek") }
        let pb = try XCTUnwrap(input.pointee.pb)
        server.stallRequests(2, below: Int(avio_tell(pb)) + 1)
        XCTAssertNotNil(KeyframeIndex.read(input: input, streamIndex: video))
        XCTAssertEqual(try firstVideoKeyframeSeconds(input), 0, accuracy: 0.01)
    }

    /// The fixture opened over loopback HTTP as a session opens it, read to `seconds` after a first seek
    /// that parses the cues, then the next request stalls. `nil` leaves the cues unread and nothing stalled.
    private func openMatroska(readingTo seconds: Double?, fixture: URL? = matroskaFixture) throws -> (ThrottledFileServer, UnsafeMutablePointer<AVFormatContext>) {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(fixture, "libx264 produced no fixture"))
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: bytes.count / 4)
        var opts = sourceHttpOptions(headers: [:], file: true)
        defer { av_dict_free(&opts) }
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, "http://127.0.0.1:\(server.port)/gop.mkv", nil, &opts) >= 0, let input = ctx else {
            server.stop()
            throw XCTSkip("could not open the fixture over loopback")
        }
        XCTAssertGreaterThanOrEqual(probeStreamInfo(input), 0)
        if let seconds {
            XCTAssertGreaterThanOrEqual(seekBackward(input, stream: -1, to: 0), 0)
            XCTAssertGreaterThanOrEqual(try firstVideoKeyframeSeconds(input, atOrAfter: seconds), seconds)
            server.stallRequests()
        }
        return (server, input)
    }

    private func firstVideoKeyframeSeconds(_ input: UnsafeMutablePointer<AVFormatContext>, atOrAfter floor: Double = 0) throws -> Double {
        var pkt: UnsafeMutablePointer<AVPacket>? = av_packet_alloc()
        defer { av_packet_free(&pkt) }
        let packet = try XCTUnwrap(pkt)
        while av_read_frame(input, packet) >= 0 {
            defer { av_packet_unref(packet) }
            guard let stream = input.pointee.streams[Int(packet.pointee.stream_index)],
                  stream.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_VIDEO,
                  packet.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0 else { continue }
            let seconds = Double(packet.pointee.pts) * av_q2d(stream.pointee.time_base)
            if seconds >= floor { return seconds }
        }
        XCTFail("the read ended before a video keyframe")
        return -1
    }

    private func close(_ input: UnsafeMutablePointer<AVFormatContext>, _ server: ThrottledFileServer) {
        var closing: UnsafeMutablePointer<AVFormatContext>? = input
        avformat_close_input(&closing)
        server.stop()
    }

    func testTheRestartSeeksEarlierPerLateOpeningAndStopsWithholdingAtTheCap() {
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 0), 40)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 1), 39)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 9), 40 - RemuxSession.partialOpenLookback)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 1, partialOpens: 3), 0)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 0, prerolls: true), 39)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 40, partialOpens: 9, prerolls: true), 40 - RemuxSession.partialOpenLookback)
        XCTAssertEqual(RemuxSession.restartSeekSegment(for: 0, partialOpens: 0, prerolls: true), 0)
        XCTAssertTrue(RemuxSession.withholdsPartialOpen(partialOpens: RemuxSession.partialOpenLookback))
        XCTAssertFalse(RemuxSession.withholdsPartialOpen(partialOpens: RemuxSession.partialOpenLookback + 1),
                       "past the lookback a short head is published: a gap plays, an endless restart does not")
    }
}
