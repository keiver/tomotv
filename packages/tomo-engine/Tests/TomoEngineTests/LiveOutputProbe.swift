import Foundation
import XCTest

/// One segment of an engine media playlist, with the MAP in force and whether a DISCONTINUITY follows.
struct PlaylistEntry {
    let name: String
    let duration: Double
    let map: String
    let closedBySplice: Bool
}

/// Segments in playlist order.
func playlistEntries(_ playlist: String) -> [PlaylistEntry] {
    let lines = playlist.split(separator: "\n").map(String.init)
    var out: [PlaylistEntry] = []
    var map = ""
    for (i, line) in lines.enumerated() where line.hasPrefix("#EXTINF:") || line.hasPrefix("#EXT-X-MAP:URI=") {
        if line.hasPrefix("#EXT-X-MAP:URI=") {
            map = String(line.dropFirst(16).dropLast())
            continue
        }
        let duration = Double(line.dropFirst(8).dropLast()) ?? -1
        let name = lines[i + 1]
        let next = i + 2 < lines.count ? lines[i + 2] : ""
        out.append(PlaylistEntry(name: name, duration: duration, map: map, closedBySplice: next == "#EXT-X-DISCONTINUITY"))
    }
    return out
}

let hostFfprobe = "/opt/homebrew/bin/ffprobe"
let hostFfmpeg = "/opt/homebrew/bin/ffmpeg"

/// `init + segment` from the session directory written as one MP4 for the host's tools.
private func joinedRendition(dir: URL, map: String, segment: String) throws -> (file: URL, context: String) {
    let initData = try Data(contentsOf: dir.appendingPathComponent(map))
    let segmentData = try Data(contentsOf: dir.appendingPathComponent(segment))
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("live-probe-\(segment).mp4")
    try (initData + segmentData).write(to: tmp)
    return (tmp, "\(map)+\(segment): init \(initData.count) bytes, segment \(segmentData.count) bytes")
}

private func run(_ executable: String, _ arguments: [String]) throws -> (out: String, err: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: executable)
    p.arguments = arguments
    let pipe = Pipe()
    let errPipe = Pipe()
    p.standardOutput = pipe
    p.standardError = errPipe
    try p.run()
    let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let err = String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    p.waitUntilExit()
    return (out, err)
}

/// ffprobe fields of one stream of `init + segment`: codec, dimension or rate, extradata size.
func probeRendition(dir: URL, map: String, segment: String, stream: String = "0", entries: String) throws -> (fields: [String], context: String) {
    let joined = try joinedRendition(dir: dir, map: map, segment: segment)
    let (out, err) = try run(hostFfprobe, ["-v", "error", "-select_streams", stream, "-show_entries", entries, "-of", "csv=p=0", joined.file.path])
    return (out.split(separator: ",").map(String.init), "\(joined.context), ffprobe: \(out) / \(err)")
}

/// The overall RMS level in dB of the first audio track of `init + segment` as the host's ffmpeg decodes it; nil when it could not.
func decodedAudioRmsDb(dir: URL, map: String, segment: String) throws -> (level: Double?, context: String) {
    let joined = try joinedRendition(dir: dir, map: map, segment: segment)
    let (_, err) = try run(hostFfmpeg, ["-nostdin", "-v", "info", "-i", joined.file.path, "-map", "0:a:0",
                                       "-af", "astats=measure_overall=RMS_level:measure_perchannel=none", "-f", "null", "-"])
    let level = err.split(separator: "\n").first { $0.contains("RMS level dB:") }
        .flatMap { line in Double(line.split(separator: ":").last?.trimmingCharacters(in: .whitespaces) ?? "") }
    return (level, "\(joined.context), ffmpeg: \(err.suffix(600))")
}
