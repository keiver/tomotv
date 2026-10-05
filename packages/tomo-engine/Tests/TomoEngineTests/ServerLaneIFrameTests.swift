import AVFoundation
import XCTest

@testable import TomoEngine

/// The server lanes' I-frame rendition: a frame provider reads the original file and the shim names
/// it in the server's master. Measured against Jellyfin 2026-10-05: its fMP4 segments start at the
/// source's time from its start, its TS segments 10 s later, and AVPlayer lines an I-frame rendition
/// on the source's time up with both (6 of 6 frames pixel-identical at their times).
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

    private func hash(_ pb: CVPixelBuffer) -> UInt64 {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0)?.assumingMemoryBound(to: UInt8.self) else { return 0 }
        let rows = CVPixelBufferGetHeightOfPlane(pb, 0), stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0), width = CVPixelBufferGetWidthOfPlane(pb, 0)
        var h: UInt64 = 1469598103934665603
        for y in Swift.stride(from: 0, to: rows, by: 7) {
            for x in Swift.stride(from: 0, to: width, by: 5) { h = (h ^ UInt64(base[y * stride + x] >> 3)) &* 1099511628211 }
        }
        return h
    }

    private func pump(_ seconds: Double) { RunLoop.main.run(until: Date().addingTimeInterval(seconds)) }

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

        let item = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/shim/master.m3u8")))
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        item.add(output)
        let ready = Date().addingTimeInterval(20)
        while item.status == .unknown, Date() < ready { pump(0.05) }
        XCTAssertEqual(item.status, .readyToPlay, String(describing: item.error))
        XCTAssertTrue(item.canPlayFastForward)
        player.seek(to: CMTime(seconds: 10, preferredTimescale: 600))
        pump(1)
        player.rate = 8
        var shown: [(time: CMTime, hash: UInt64)] = []
        let end = Date().addingTimeInterval(4)
        while Date() < end {
            pump(0.02)
            let host = output.itemTime(forHostTime: CACurrentMediaTime())
            var at = CMTime.invalid
            if output.hasNewPixelBuffer(forItemTime: host), let pb = output.copyPixelBuffer(forItemTime: host, itemTimeForDisplay: &at), at.isValid {
                shown.append((at, hash(pb)))
            }
        }
        player.rate = 0
        // The server's stream alone, in a player of its own, gives each trick frame's time its main frame.
        let mainItem = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(originPort)/master.m3u8")))
        let mainPlayer = AVPlayer(playerItem: mainItem)
        mainPlayer.isMuted = true
        let mainOutput = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        mainItem.add(mainOutput)
        let mainReady = Date().addingTimeInterval(20)
        while mainItem.status == .unknown, Date() < mainReady { pump(0.05) }
        var aligned = 0
        var report: [String] = []
        for frame in shown.dropFirst().prefix(5) {
            var done = false
            mainPlayer.seek(to: frame.time, toleranceBefore: .zero, toleranceAfter: .zero) { _ in done = true }
            let s = Date()
            while !done, Date().timeIntervalSince(s) < 10 { pump(0.05) }
            var main: (UInt64, Double)?
            let w = Date()
            while main == nil, Date().timeIntervalSince(w) < 5 {
                pump(0.05)
                var at = CMTime.invalid
                if mainOutput.hasNewPixelBuffer(forItemTime: frame.time), let pb = mainOutput.copyPixelBuffer(forItemTime: frame.time, itemTimeForDisplay: &at) {
                    main = (hash(pb), at.seconds)
                }
            }
            if main?.0 == frame.hash { aligned += 1 }
            report.append(String(format: "%.3f->%@", frame.time.seconds, main.map { String(format: "%.3f%@", $0.1, $0.0 == frame.hash ? "=" : "!") } ?? "none"))
        }
        XCTAssertGreaterThanOrEqual(aligned, 4, "trick frame time -> main frame time: \(report)")
    }

    func testIFramesLineUpWithAnFmp4ServerStream() throws { try assertAligned("fmp4") }
    func testIFramesLineUpWithATsServerStream() throws { try assertAligned("mpegts") }
}
