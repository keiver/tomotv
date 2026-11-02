import Foundation
import XCTest

/// A real-time live HLS feed from the host's ffmpeg: 2s segments in a six-segment window, written to
/// `root/live.m3u8`. Returns once the window holds `segments` of them; the caller terminates it.
/// `keyframes` replaces the 2s keyframe interval with an ffmpeg force_key_frames expression; `audio` replaces the AAC-LC encoder arguments.
func startLiveFeed(in root: URL, segments: Int = 3, keyframes: String? = nil, tsOffsetSeconds: Int = 0, audio: [String] = ["-c:a", "aac"]) throws -> Process {
    let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    guard FileManager.default.isExecutableFile(atPath: ffmpeg) else { throw XCTSkip("no ffmpeg at \(ffmpeg)") }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let feed = Process()
    feed.executableURL = URL(fileURLWithPath: ffmpeg)
    let gop = keyframes.map { ["-g", "1000", "-keyint_min", "1000", "-force_key_frames", $0] } ?? ["-g", "50", "-keyint_min", "50"]
    feed.arguments = ["-hide_banner", "-loglevel", "error", "-re",
                      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
                      "-c:v", "libx264"] + gop + ["-sc_threshold", "0"] + audio + ["-output_ts_offset", "\(tsOffsetSeconds)",
                      "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_flags", "delete_segments",
                      root.appendingPathComponent("live.m3u8").path]
    try feed.run()
    let published = Date().addingTimeInterval(20)
    while Date() < published, ((try? String(contentsOf: root.appendingPathComponent("live.m3u8"), encoding: .utf8)) ?? "").components(separatedBy: "#EXTINF").count <= segments {
        Thread.sleep(forTimeInterval: 0.25)
    }
    return feed
}

/// A continuous real-time MPEG-TS feed from the host's ffmpeg into a FIFO, the shape of a tuner or Xtream TS stream: a
/// keyframe every `keyframeSeconds` at `fps` (a ffmpeg rate such as "25" or "30000/1001"), H.264 or MPEG-2 video, AAC audio.
/// ffmpeg opens the FIFO when the reader does, so the source starts with the session. The caller terminates it.
/// `muxing` adds MPEG-TS muxer arguments.
func startContinuousFeed(fps: String, keyframeSeconds: Double, codec: String = "h264", muxing: [String] = []) throws -> (feed: Process, path: String) {
    let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    guard FileManager.default.isExecutableFile(atPath: ffmpeg) else { throw XCTSkip("no ffmpeg at \(ffmpeg)") }
    let path = FileManager.default.temporaryDirectory.appendingPathComponent("continuous-\(UUID().uuidString).ts").path
    guard mkfifo(path, 0o600) == 0 else { throw XCTSkip("mkfifo failed at \(path)") }
    let rate = fps.split(separator: "/").map { Double($0) ?? 1 }
    let gop = String(Int((keyframeSeconds * (rate.count == 2 ? rate[0] / rate[1] : rate[0])).rounded()))
    let video = codec == "mpeg2" ? ["-c:v", "mpeg2video", "-b:v", "4M"] : ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    let feed = Process()
    feed.executableURL = URL(fileURLWithPath: ffmpeg)
    feed.arguments = ["-hide_banner", "-loglevel", "error", "-re",
                      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=\(fps)", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]
        + video + ["-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-c:a", "aac"] + muxing + ["-f", "mpegts", "-y", path]
    try feed.run()
    return (feed, path)
}
