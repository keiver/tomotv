//
//  ByteTimeMap.swift
//  TomoTV
//
//  Where a time sits in an MPEG-TS file that has no index. FFmpeg's own timestamp seek
//  binary-searches the file over HTTP: measured on a 30 min recording through HTTPS, 5 to 17
//  requests and 4.2 to 14.1 s per seek, against one request for a byte position. The map
//  interpolates between what is known (the file's ends, every keyframe playback has read, every
//  landing), so each seek lands close and the next one lands closer.
//

import Foundation
import Libavformat

final class ByteTimeMap {
    static let packetSize: Int64 = 188
    static let tolerance = 2.0

    private let lock = NSLock()
    /// Keyframe positions and their source times, sorted by position.
    private var points: [(pos: Int64, seconds: Double)]
    private(set) var broken = false

    /// `startSeconds` and `endSeconds` bound the file's timeline; `size` its bytes.
    init(size: Int64, startSeconds: Double, endSeconds: Double) {
        points = [(0, startSeconds), (size, endSeconds)]
    }

    /// The map for a seekable MPEG-TS input whose size and duration are known, else nil.
    static func forInput(_ input: UnsafeMutablePointer<AVFormatContext>) -> ByteTimeMap? {
        guard let format = input.pointee.iformat, String(cString: format.pointee.name) == "mpegts",
              let io = input.pointee.pb, io.pointee.seekable & 1 != 0 else { return nil }
        let size = avio_size(io)
        let none = Int64(bitPattern: 0x8000_0000_0000_0000)
        guard size > 0, input.pointee.duration != none, input.pointee.duration > 0 else { return nil }
        let start = input.pointee.start_time == none ? 0 : Double(input.pointee.start_time) / 1_000_000
        return ByteTimeMap(size: size, startSeconds: start, endSeconds: start + Double(input.pointee.duration) / 1_000_000)
    }

    /// A keyframe read at `pos`. Times that run backwards against position (a timestamp wrap or a
    /// discontinuity) retire the map: interpolation over them would land anywhere.
    func record(pos: Int64, seconds: Double) {
        guard pos > 0, seconds.isFinite else { return }
        lock.lock()
        defer { lock.unlock() }
        guard !broken, pos < points[points.count - 1].pos else { return }
        let at = points.firstIndex { $0.pos >= pos } ?? points.count
        if at < points.count, points[at].pos == pos { return }
        let before = points[at - 1]
        let after = points[at]
        guard seconds >= before.seconds, seconds <= after.seconds else {
            // A keyframe just past the estimated end, or a reorder tick early, is noise, not a wrap.
            if seconds > before.seconds - Self.tolerance, seconds < after.seconds + Self.tolerance { return }
            broken = true
            return
        }
        points.insert((pos, seconds), at: at)
    }

    /// The byte position estimated to hold `seconds`, on a packet boundary; nil once retired.
    func position(forSeconds seconds: Double) -> Int64? {
        lock.lock()
        defer { lock.unlock() }
        guard !broken else { return nil }
        guard let upper = points.firstIndex(where: { $0.seconds >= seconds }) else { return points[points.count - 1].pos }
        guard upper > 0 else { return 0 }
        let a = points[upper - 1]
        let b = points[upper]
        let share = b.seconds > a.seconds ? (seconds - a.seconds) / (b.seconds - a.seconds) : 0
        let pos = a.pos + Int64(Double(b.pos - a.pos) * share)
        return pos - pos % Self.packetSize
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return points.count
    }
}
