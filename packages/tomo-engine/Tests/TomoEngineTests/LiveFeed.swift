import Foundation
import XCTest

/// A real-time live HLS feed from the host's ffmpeg: 2s segments in a six-segment window, written to
/// `root/live.m3u8`. Returns once the window holds `segments` of them; the caller terminates it.
/// `keyframes` replaces the 2s keyframe interval with an ffmpeg force_key_frames expression.
func startLiveFeed(in root: URL, segments: Int = 3, keyframes: String? = nil) throws -> Process {
    let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    guard FileManager.default.isExecutableFile(atPath: ffmpeg) else { throw XCTSkip("no ffmpeg at \(ffmpeg)") }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let feed = Process()
    feed.executableURL = URL(fileURLWithPath: ffmpeg)
    let gop = keyframes.map { ["-g", "1000", "-keyint_min", "1000", "-force_key_frames", $0] } ?? ["-g", "50", "-keyint_min", "50"]
    feed.arguments = ["-hide_banner", "-loglevel", "error", "-re",
                      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
                      "-c:v", "libx264"] + gop + ["-sc_threshold", "0", "-c:a", "aac",
                      "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_flags", "delete_segments",
                      root.appendingPathComponent("live.m3u8").path]
    try feed.run()
    let published = Date().addingTimeInterval(20)
    while Date() < published, ((try? String(contentsOf: root.appendingPathComponent("live.m3u8"), encoding: .utf8)) ?? "").components(separatedBy: "#EXTINF").count <= segments {
        Thread.sleep(forTimeInterval: 0.25)
    }
    return feed
}
