//
//  IFrameIndex.swift
//  TomoTV
//
//  Where the I-frame rendition's entries sit: the source's own keyframes when its demuxer
//  indexes them, else the session's segment grid. Pure data, so the playlist is testable.
//

import Foundation
import Libavformat
import Libavutil

private let SWIFT_AVINDEX_KEYFRAME: Int32 = 0x0001

/// The source's keyframes as its demuxer indexed them, in the video stream's time base.
struct KeyframeIndex {
    let timestamps: [Int64]
    let timeBase: AVRational

    /// Keyframes closer than this to the previous entry are left out: the authoring spec's
    /// I-frame tables assume about one a second, and a dense MP4 index lists every half second.
    static let minimumGapSeconds = 1.0

    /// The full index of a seekable Matroska, WebM, MP4/MOV or AVI source (measured: each lists
    /// every keyframe; TS, PS and FLV list only what was read). Matroska loads its Cues on a seek.
    static func read(input: UnsafeMutablePointer<AVFormatContext>, streamIndex: Int32) -> KeyframeIndex? {
        guard let stream = input.pointee.streams[Int(streamIndex)],
              let io = input.pointee.pb, io.pointee.seekable & 1 != 0 else { return nil }
        let format = input.pointee.iformat.map { String(cString: $0.pointee.name) } ?? ""
        let names = format.split(separator: ",")
        let matroska = names.contains("matroska") || names.contains("webm")
        guard matroska || names.contains("mov") || names.contains("avi") else { return nil }
        if matroska, avformat_index_get_entries_count(stream) < 2 {
            let start = input.pointee.start_time == Int64(bitPattern: 0x8000_0000_0000_0000) ? 0 : input.pointee.start_time
            guard avformat_seek_file(input, -1, Int64.min, start, start, 1) >= 0 else { return nil }
        }
        var keyframes: [Int64] = []
        for index in 0..<avformat_index_get_entries_count(stream) {
            guard let entry = avformat_index_get_entry(stream, index), entry.pointee.flags & SWIFT_AVINDEX_KEYFRAME != 0 else { continue }
            keyframes.append(entry.pointee.timestamp)
        }
        return thinned(keyframes.sorted(), timeBase: stream.pointee.time_base)
    }

    static func thinned(_ sorted: [Int64], timeBase: AVRational) -> KeyframeIndex? {
        let gap = Int64(minimumGapSeconds / av_q2d(timeBase))
        var kept: [Int64] = []
        for timestamp in sorted where kept.last.map({ timestamp - $0 >= gap }) ?? true {
            kept.append(timestamp)
        }
        return kept.count >= 2 ? KeyframeIndex(timestamps: kept, timeBase: timeBase) : nil
    }
}

/// The rendition's entries: where each sits on the output timeline and which source time
/// its frame is read at. `exact` entries are keyframes; grid entries take the keyframe at or
/// before their time, stamped at the grid time so both renditions share one timeline.
struct IFrameEntries: Equatable {
    let stamps: [Double]
    let sources: [Double]
    let exact: Bool

    /// One entry per indexed keyframe on the output timeline (`anchorSeconds` is the session anchor).
    static func indexed(_ index: KeyframeIndex, anchorSeconds: Double, durationSeconds: Double) -> IFrameEntries? {
        var stamps: [Double] = []
        var sources: [Double] = []
        for timestamp in index.timestamps {
            let source = Double(timestamp) * av_q2d(index.timeBase)
            let stamp = source - anchorSeconds
            guard stamp >= 0, stamp < durationSeconds else { continue }
            stamps.append(stamp)
            sources.append(source)
        }
        return stamps.isEmpty ? nil : IFrameEntries(stamps: stamps, sources: sources, exact: true)
    }

    /// One entry per segment start of the session grid.
    static func grid(starts: [Double], anchorSeconds: Double) -> IFrameEntries? {
        starts.isEmpty ? nil : IFrameEntries(stamps: starts, sources: starts.map { $0 + anchorSeconds }, exact: false)
    }

    /// The playlist: each entry lasts until the next, the last to the end, the first from zero so
    /// every later entry sits exactly where its frame plays.
    func playlist(durationSeconds: Double) -> String {
        let durations = stamps.indices.map { i in
            max(0.001, (i + 1 < stamps.count ? stamps[i + 1] : durationSeconds) - (i == 0 ? 0 : stamps[i]))
        }
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:\(max(1, Int(ceil(durations.max() ?? 1))))\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-I-FRAMES-ONLY\n#EXT-X-MAP:URI=\"if-init.mp4\"\n"
        for (k, duration) in durations.enumerated() {
            out += String(format: "#EXTINF:%.6f,\nkf%d.m4s\n", duration, k)
        }
        return out + "#EXT-X-ENDLIST\n"
    }

    /// The cached entry closest to `k` on the timeline, for a request that cannot wait for its own.
    func nearest(to k: Int, among cached: some Sequence<Int>) -> Int? {
        cached.min { abs(stamps[$0] - stamps[k]) < abs(stamps[$1] - stamps[k]) }
    }
}
