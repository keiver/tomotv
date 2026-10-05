import Foundation
import XCTest

@testable import TomoEngine

/// MPEG-TS has no index, and FFmpeg's timestamp seek binary-searches it over HTTP: 5 to 17
/// requests a seek on a real recording. A byte estimate on the session's map takes one or two.
final class ByteSeekTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0

    // MARK: - Map

    func testThePositionInterpolatesBetweenKnownPoints() throws {
        let map = ByteTimeMap(size: 188_000, startSeconds: 0, endSeconds: 100)
        XCTAssertEqual(map.position(forSeconds: 50), 94_000)
        // Half the bytes hold the first 20 seconds.
        map.record(pos: 94_000, seconds: 20)
        XCTAssertEqual(map.position(forSeconds: 10), 47_000)
        XCTAssertEqual(map.position(forSeconds: 60), 141_000)
        XCTAssertEqual(map.position(forSeconds: -5), 0)
        XCTAssertEqual(map.position(forSeconds: 500), 188_000)
    }

    func testPositionsLandOnPacketBoundaries() throws {
        let map = ByteTimeMap(size: 1_000_000, startSeconds: 0, endSeconds: 7)
        XCTAssertEqual(try XCTUnwrap(map.position(forSeconds: 3)) % 188, 0)
    }

    func testTimeRunningBackwardsRetiresTheMap() throws {
        let map = ByteTimeMap(size: 188_000, startSeconds: 0, endSeconds: 100)
        map.record(pos: 94_000, seconds: 60)
        map.record(pos: 141_000, seconds: 30)
        XCTAssertTrue(map.broken)
        XCTAssertNil(map.position(forSeconds: 40))
    }

    func testATickPastTheEstimatedEndIsNotAWrap() throws {
        let map = ByteTimeMap(size: 188_000, startSeconds: 0, endSeconds: 100)
        map.record(pos: 187_812, seconds: 100.5)
        XCTAssertFalse(map.broken)
    }

    // MARK: - Pipeline

    private static func fixture(_ name: String, video: [String]) -> URL? {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("byteseek-\(name)-60s.ts")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y"] + video
            + ["-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-t", String(seconds), "-f", "mpegts", out.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        return p.terminationStatus == 0 && FileManager.default.fileExists(atPath: out.path) ? out : nil
    }

    private static let uniform = fixture("uniform", video: [
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440",
        "-b:v", "1M", "-minrate", "1M", "-maxrate", "1M", "-bufsize", "1M",
    ])

    /// Thirty quiet seconds, then thirty of noise at many times the rate: bytes and time part ways.
    private static let variable = fixture("variable", video: [
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=30",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=30,noise=alls=90:allf=t",
        "-f", "lavfi", "-i", "sine=frequency=440",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-crf", "20",
    ])

    private func firstVideoSeconds(segment: URL) throws -> Double {
        let initData = try Data(contentsOf: segment.deletingLastPathComponent().appendingPathComponent("init.mp4"))
        let data = try Data(contentsOf: segment)
        func u32(_ d: Data, _ at: Int) -> UInt64 { (0..<4).reduce(UInt64(0)) { ($0 << 8) | UInt64(d[at + $1]) } }
        let mdhd = try XCTUnwrap(initData.range(of: Data("mdhd".utf8))).upperBound
        let timescale = u32(initData, mdhd + (initData[mdhd] == 1 ? 20 : 12))
        let tfdt = try XCTUnwrap(data.range(of: Data("tfdt".utf8))).upperBound
        let decodeTime = data[tfdt] == 1 ? (u32(data, tfdt + 4) << 32) | u32(data, tfdt + 8) : u32(data, tfdt + 4)
        return Double(decodeTime) / Double(timescale)
    }

    /// Segment 8 (48 s) asked for while the read is near the start seeks there, in at most `limit`
    /// requests to the origin, and the segment it serves starts where it says.
    private func assertSeek(_ file: URL?, limit: Int) throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(file, "ffmpeg produced no fixture"))
        // Twice realtime: the forward read is still near the start when segment 8 is asked for.
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds / 2)))
        defer { server.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/rec.ts",
                                                          codecs: "avc1.64000D,mp4a.40.2", width: 320, height: 180, frameRate: 24, bandwidth: 1_200_000))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        let before = server.requestCount
        let segment = try XCTUnwrap(session.segmentURL(8), "segment 8 is served after the seek")
        let requests = server.requestCount - before
        session.stateLock.lock()
        let restarts = session.seekRestarts
        let mapped = session.byteMap != nil
        session.stateLock.unlock()
        XCTAssertTrue(mapped)
        XCTAssertGreaterThanOrEqual(restarts, 1, "segment 8 was reached through a seek")
        XCTAssertLessThanOrEqual(requests, limit, "the seek took \(requests) requests")
        XCTAssertEqual(try firstVideoSeconds(segment: segment), 48, accuracy: 2.1)
    }

    func testAUniformRecordingSeeksInOneRequest() throws { try assertSeek(Self.uniform, limit: 1) }
    func testAVariableRecordingSeeksWithinTheTryBudget() throws { try assertSeek(Self.variable, limit: RemuxSession.byteSeekTries) }

    /// A real recording over its real link: TOMO_TS_SOURCE (a URL), TOMO_TS_DURATION, TOMO_TS_SEGMENTS (comma list).
    func testARealRecordingSeeksOnTheMap() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let url = environment["TOMO_TS_SOURCE"], let duration = environment["TOMO_TS_DURATION"].flatMap(Double.init) else {
            throw XCTSkip("set TOMO_TS_SOURCE and TOMO_TS_DURATION")
        }
        let segments = (environment["TOMO_TS_SEGMENTS"] ?? "100,20,250,75").split(separator: ",").compactMap { Int($0) }
        let session = try RemuxSession(config: makeConfig(durationSeconds: duration, inputUrl: url, codecs: "", width: 1920, height: 1080, bandwidth: 2_000_000))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        for n in segments {
            let started = Date()
            let segment = try XCTUnwrap(session.segmentURL(n), "segment \(n)")
            let seconds = Date().timeIntervalSince(started)
            NSLog("[ByteSeekTests] segment %d served %.2fs after it was asked for, starts at %.2fs", n, seconds, try firstVideoSeconds(segment: segment))
            XCTAssertEqual(try firstVideoSeconds(segment: segment), Double(n) * RemuxSession.segmentDuration, accuracy: 3)
        }
        // Scrub thumbnails off the same map: one grid entry each, read by the grabber.
        session.iframeTranscodes = session.iframeTranscodes ?? false
        for k in segments {
            let started = Date()
            guard case .data(let fragment, _) = session.route("kf\(k).m4s") else { return XCTFail("no thumbnail for entry \(k)") }
            NSLog("[ByteSeekTests] thumbnail %d made in %.2fs (%d bytes)", k, Date().timeIntervalSince(started), fragment.count)
        }
    }
}
