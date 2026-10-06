import XCTest

@testable import TomoEngine

/// The server lanes' I-frame rendition: a frame provider reads the original file and the shim names
/// it in the server's master. Measured against Jellyfin 2026-10-05: its fMP4 segments start at the
/// source's time from its start, its TS segments 10 s later; every entry is the server's picture there.
final class ServerLaneIFrameTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures/server-lane", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private static func run(_ arguments: [String]) -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y"] + arguments
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return false }
        p.waitUntilExit()
        return p.terminationStatus == 0
    }

    /// The source, and the server's copy of it as HLS in `container` ("fmp4" or "mpegts").
    private static func prepare(_ container: String) -> (source: URL, master: URL)? {
        let source = fixtureDir.appendingPathComponent("source.mkv")
        if !FileManager.default.fileExists(atPath: source.path) {
            guard run(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440", "-t", String(seconds),
                       "-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-bf", "2",
                       "-pix_fmt", "yuv420p", "-c:a", "aac", source.path]) else { return nil }
        }
        let dir = fixtureDir.appendingPathComponent("jellyfin-\(container)", isDirectory: true)
        let media = dir.appendingPathComponent("media.m3u8")
        if !FileManager.default.fileExists(atPath: media.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            // Jellyfin's own stream-copy HLS command (its FFmpeg.DirectStream log): timestamps kept from the source's start.
            guard run(["-fflags", "+genpts", "-i", source.path, "-map", "0:0", "-map", "0:1", "-c:v", "copy", "-bsf:v", "h264_mp4toannexb", "-start_at_zero",
                       "-c:a", "aac", "-copyts", "-avoid_negative_ts", "disabled", "-max_muxing_queue_size", "2048",
                       "-f", "hls", "-max_delay", "5000000", "-hls_time", "6", "-hls_segment_type", container, "-hls_playlist_type", "vod"]
                      + (container == "fmp4" ? ["-hls_segment_options", "movflags=+frag_discont+skip_sidx"] : [])
                      + ["-hls_segment_filename", dir.appendingPathComponent(container == "fmp4" ? "s%d.m4s" : "s%d.ts").path,
                       media.path]) else { return nil }
        }
        let master = dir.appendingPathComponent("master.m3u8")
        let codecs = "avc1.64000D,mp4a.40.2"
        try? Data("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=900000,CODECS=\"\(codecs)\",RESOLUTION=320x180\nmedia.m3u8\n".utf8).write(to: master)
        return (source, master)
    }

    private func assertAligned(_ container: String) throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let (source, master) = try XCTUnwrap(Self.prepare(container), "ffmpeg produced no \(container) server stream")
        let serverDir = master.deletingLastPathComponent()
        let origin = LocalHTTPServer { request in
            let name = String(request.dropFirst()).components(separatedBy: "?")[0]
            if name == "source.mkv" { return .file(source, contentType: "application/octet-stream") }
            let file = serverDir.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: file.path) else { return .notFound }
            return .file(file, contentType: name.hasSuffix(".m3u8") ? "application/vnd.apple.mpegurl" : "video/iso.segment")
        }
        let originPort = try origin.start()
        defer { origin.stop() }

        let provider = try FrameProvider(inputUrl: "http://127.0.0.1:\(originPort)/source.mkv", itemId: "",
                                         iframes: (transcode: false, durationSeconds: Self.seconds))
        defer { provider.stop() }
        var shim: PlaylistShim?
        let loopback = LocalHTTPServer { request in
            let parts = request.split(separator: "/").map(String.init)
            guard parts.count == 2 else { return .notFound }
            if parts[0] == "provider" { return provider.iframes?.route(parts[1]) ?? .notFound }
            guard let shim else { return .notFound }
            if parts[1] == "master.m3u8" { return shim.masterResponse() }
            if parts[1].hasPrefix("p"), let n = Int(parts[1].dropFirst().dropLast(5)) { return shim.mediaResponse(n) }
            return .notFound
        }
        let port = try loopback.start()
        defer { loopback.stop() }
        let line = "#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=900000,CODECS=\"avc1.64000D\",RESOLUTION=320x180,URI=\"http://127.0.0.1:\(port)/provider/iframes.m3u8\""
        shim = PlaylistShim(masterUrl: try XCTUnwrap(URL(string: "http://127.0.0.1:\(originPort)/master.m3u8")), startOffsetSeconds: 0, iframeStreamInf: line)

        let rendition = try IFrameOracle.rendition(master: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/shim/master.m3u8")))
        XCTAssertEqual(rendition.entries.count, Int(Self.seconds / 2), "one entry per source keyframe")
        // The main variant through the shim, on its timeline: time from its first picture (fMP4 starts at 0, TS 10.083 s later).
        let main = try XCTUnwrap(IFrameOracle.decode("http://127.0.0.1:\(port)/shim/master.m3u8"), "the shimmed main variant does not decode").frames
        let origin0 = try XCTUnwrap(main.first).seconds
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(main.last).seconds - origin0, Self.seconds - 1, "the whole main variant decodes")
        for (k, entry) in rendition.entries.enumerated() {
            XCTAssertEqual(entry.status, 200, "entry \(k)")
            XCTAssertEqual(entry.packets, 1, "entry \(k) holds one sample")
            guard entry.frames.count == 1, let picture = entry.frames.first else {
                XCTFail("entry \(k) decodes to \(entry.frames.count) pictures")
                continue
            }
            XCTAssertTrue(picture.key, "entry \(k)")
            XCTAssertEqual(picture.seconds, entry.start, accuracy: 0.5 / 24, "entry \(k) plays at its start")
            let shown = try XCTUnwrap(main.min { abs($0.seconds - origin0 - entry.start) < abs($1.seconds - origin0 - entry.start) })
            XCTAssertEqual(picture.distance(to: shown), 0, "entry \(k) at \(entry.start) is the server's picture at \(shown.seconds - origin0)")
        }
    }

    func testIFramesLineUpWithAnFmp4ServerStream() throws { try assertAligned("fmp4") }
    func testIFramesLineUpWithATsServerStream() throws { try assertAligned("mpegts") }
}
