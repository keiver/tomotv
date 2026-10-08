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
    /// Each keyframe's byte position (Matroska: its cluster's) and packet size (0 where the demuxer
    /// records none: Matroska Cues carry no size).
    var positions: [Int64]?
    var sizes: [Int]?

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
        var keyframes: [(timestamp: Int64, position: Int64, size: Int)] = []
        for index in 0..<avformat_index_get_entries_count(stream) {
            guard let entry = avformat_index_get_entry(stream, index), entry.pointee.flags & SWIFT_AVINDEX_KEYFRAME != 0 else { continue }
            keyframes.append((entry.pointee.timestamp, entry.pointee.pos, Int(entry.pointee.size)))
        }
        keyframes.sort { $0.timestamp < $1.timestamp }
        // MP4 indexes decode times (mov.c); the first keyframe is the stream's first picture, so its
        // presentation is the stream's start, and the shift carries every keyframe onto presentation time.
        if names.contains("mov"), stream.pointee.start_time != Int64(bitPattern: 0x8000_0000_0000_0000),
           let first = keyframes.first?.timestamp, stream.pointee.start_time > first {
            let shift = stream.pointee.start_time - first
            keyframes = keyframes.map { ($0.timestamp + shift, $0.position, $0.size) }
        }
        let kept = thinnedIndices(keyframes.map(\.timestamp), timeBase: stream.pointee.time_base)
        guard kept.count >= 2 else { return nil }
        return KeyframeIndex(timestamps: kept.map { keyframes[$0].timestamp }, timeBase: stream.pointee.time_base,
                             positions: kept.map { keyframes[$0].position }, sizes: kept.map { keyframes[$0].size })
    }

    static func thinned(_ sorted: [Int64], timeBase: AVRational) -> KeyframeIndex? {
        let kept = thinnedIndices(sorted, timeBase: timeBase)
        return kept.count >= 2 ? KeyframeIndex(timestamps: kept.map { sorted[$0] }, timeBase: timeBase) : nil
    }

    private static func thinnedIndices(_ sorted: [Int64], timeBase: AVRational) -> [Int] {
        let gap = Int64(minimumGapSeconds / av_q2d(timeBase))
        var kept: [Int] = []
        for (i, timestamp) in sorted.enumerated() where kept.last.map({ timestamp - sorted[$0] >= gap }) ?? true {
            kept.append(i)
        }
        return kept
    }
}

/// The rendition's entries: where each sits on the output timeline and which source time
/// its frame is read at. `exact` entries are keyframes; grid entries take the keyframe at or
/// before their time, stamped at the grid time so both renditions share one timeline.
struct IFrameEntries: Equatable {
    let stamps: [Double]
    let sources: [Double]
    let exact: Bool
    /// The indexed keyframes' byte positions and packet sizes, as KeyframeIndex keeps them.
    var positions: [Int64]?
    var sizes: [Int]?

    /// One entry per indexed keyframe on the output timeline (`anchorSeconds` is the session anchor).
    static func indexed(_ index: KeyframeIndex, anchorSeconds: Double, durationSeconds: Double) -> IFrameEntries? {
        var stamps: [Double] = []
        var sources: [Double] = []
        var kept: [Int] = []
        for (i, timestamp) in index.timestamps.enumerated() {
            let source = Double(timestamp) * av_q2d(index.timeBase)
            let stamp = source - anchorSeconds
            guard stamp >= 0, stamp < durationSeconds else { continue }
            stamps.append(stamp)
            sources.append(source)
            kept.append(i)
        }
        guard !stamps.isEmpty else { return nil }
        return IFrameEntries(stamps: stamps, sources: sources, exact: true,
                             positions: index.positions.map { all in kept.map { all[$0] } }, sizes: index.sizes.map { all in kept.map { all[$0] } })
    }

    /// One entry per segment start of the session grid.
    static func grid(starts: [Double], anchorSeconds: Double) -> IFrameEntries? {
        starts.isEmpty ? nil : IFrameEntries(stamps: starts, sources: starts.map { $0 + anchorSeconds }, exact: false)
    }

    /// Each entry's EXTINF: until the next, the last to the end, the first from zero so every later
    /// entry sits exactly where its frame plays.
    func durations(totalSeconds: Double) -> [Double] {
        stamps.indices.map { i in
            max(0.001, (i + 1 < stamps.count ? stamps[i + 1] : totalSeconds) - (i == 0 ? 0 : stamps[i]))
        }
    }

    /// Each fragment's sample duration: the gap from its tfdt to the next one's (spec 7.3).
    func sampleDurations(totalSeconds: Double) -> [Double] {
        stamps.indices.map { i in max(0.001, (i + 1 < stamps.count ? stamps[i + 1] : totalSeconds) - stamps[i]) }
    }

    /// The playlist. `targetDuration` floors TARGETDURATION, which VOD I-frame playlists may set
    /// apart from the media's (spec 6.12) and which spans the peak window (RFC 8216 4.3.4.2).
    func playlist(durationSeconds: Double, targetDuration: Int = 1) -> String {
        let durations = durations(totalSeconds: durationSeconds)
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:\(max(targetDuration, Int(ceil(durations.max() ?? 1))))\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-I-FRAMES-ONLY\n#EXT-X-MAP:URI=\"if-init.mp4\"\n"
        for (k, duration) in durations.enumerated() {
            out += String(format: "#EXTINF:%.6f,\nkf%d.m4s\n", duration, k)
        }
        return out + "#EXT-X-ENDLIST\n"
    }

    /// The playlist's TARGETDURATION for the same arguments.
    func targetDuration(durationSeconds: Double, floor: Int) -> Int {
        max(floor, Int(ceil(durations(totalSeconds: durationSeconds).max() ?? 1)))
    }

    /// The cached entry closest to `k` on the timeline, for a request that cannot wait for its own.
    func nearest(to k: Int, among cached: some Sequence<Int>) -> Int? {
        cached.min { abs(stamps[$0] - stamps[k]) < abs(stamps[$1] - stamps[k]) }
    }
}

/// What an I-frame line declares: RFC 8216 4.3.4.2's peak (BANDWIDTH) and the mean (AVERAGE-BANDWIDTH).
struct IFrameBandwidth: Equatable {
    let peak: Int
    let average: Int

    /// styp, moof and the mdat header around each keyframe (measured on a served fragment).
    static let fragmentOverhead = 136

    /// From the fragment bytes of every entry: the peak of any run lasting 0.5 to 1.5 target durations
    /// (RFC 8216 4.1, spec 6.9), and the mean over all of them.
    static func measured(bytes: [Int], durations: [Double], targetDuration: Double) -> IFrameBandwidth? {
        guard bytes.count == durations.count, !bytes.isEmpty else { return nil }
        var rates = SegmentBitrates()
        for (i, size) in bytes.enumerated() { rates.record(index: i, bytes: size, duration: durations[i]) }
        let total = durations.reduce(0, +)
        guard total > 0, let peak = rates.peak(targetDuration: targetDuration) else { return nil }
        let average = Int(ceil(Double(bytes.reduce(0, +)) * 8 / total))
        return IFrameBandwidth(peak: peak, average: min(average, peak))
    }

    /// The mean of the sampled entries (entry index to fragment bytes).
    static func sampledAverage(_ samples: [Int: Int], durations: [Double]) -> Int? {
        let seconds = samples.keys.reduce(0.0) { $0 + (durations.indices.contains($1) ? durations[$1] : 0) }
        guard seconds > 0 else { return nil }
        return Int(ceil(Double(samples.values.reduce(0, +)) * 8 / seconds))
    }

    /// A peak no entry run can exceed: each keyframe lies between its entry's byte position and the
    /// next distinct one (Matroska Cues point at the keyframe's cluster), so a run's bytes are bounded
    /// by the span its positions cover, the last running to the end of the file.
    static func positionBound(positions: [Int64], fileSize: Int64, durations: [Double], targetDuration: Double) -> Int? {
        guard positions.count == durations.count, !positions.isEmpty, fileSize > 0 else { return nil }
        var points: [SegmentBitrates.IndexPoint] = []
        var start = 0.0
        for (i, position) in positions.enumerated() {
            if position >= 0, position > (points.last?.position ?? -1) { points.append(.init(seconds: start, position: position)) }
            start += durations[i]
        }
        guard let last = points.last, fileSize > last.position else { return nil }
        points.append(.init(seconds: start, position: fileSize))
        return SegmentBitrates.indexedPeak(points: points, durations: durations, targetDuration: targetDuration)
    }
}
