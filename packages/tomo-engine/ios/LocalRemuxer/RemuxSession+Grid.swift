//
//  RemuxSession+Grid.swift
//  TomoTV
//
//  The segment grid: the fixed 6s VOD grid, the adopted server grid, and the
//  live target, plus the index/second/duration conversions built on it.
//

import Foundation

extension RemuxSession {
    // MARK: - Grid helpers (fixed 6s grid, the adopted server grid, or the live target)

    /// Start second of segment n on the session grid. n == segmentCount is the
    /// stream end (the boundary the final segment's cut check compares against).
    func segmentStartSeconds(_ n: Int) -> Double {
        if config.isLive { return Double(n) * config.liveSegmentSeconds }
        if !adoptedStarts.isEmpty {
            if n <= 0 { return 0 }
            if n < adoptedStarts.count { return adoptedStarts[n] }
            return adoptedStarts[adoptedStarts.count - 1] + adoptedDurations[adoptedDurations.count - 1]
        }
        if !keyframeStarts.isEmpty {
            if n <= 0 { return 0 }
            return n < keyframeStarts.count ? keyframeStarts[n] : durationSeconds
        }
        return Double(n) * Self.segmentDuration
    }

    /// Declared duration of segment n on the session grid.
    func segmentDurationSeconds(_ n: Int) -> Double {
        if config.isLive {
            stateLock.lock()
            defer { stateLock.unlock() }
            return liveDurations[n] ?? config.liveSegmentSeconds
        }
        if !adoptedDurations.isEmpty { return adoptedDurations[min(max(n, 0), adoptedDurations.count - 1)] }
        if !keyframeStarts.isEmpty {
            let k = min(max(n, 0), keyframeStarts.count - 1)
            return max(0.001, segmentStartSeconds(k + 1) - segmentStartSeconds(k))
        }
        let count = segmentCount
        return n == count - 1 ? max(0.001, durationSeconds - Double(n) * Self.segmentDuration) : Self.segmentDuration
    }

    /// Segment index containing second `s` (clamped into the grid).
    func segmentIndex(atSeconds s: Double) -> Int {
        if config.isLive { return max(0, Int(s / config.liveSegmentSeconds)) }
        if !adoptedStarts.isEmpty { return Self.lastStart(atOrBefore: s, in: adoptedStarts) }
        if !keyframeStarts.isEmpty { return Self.lastStart(atOrBefore: s, in: keyframeStarts) }
        return max(0, Int(s / Self.segmentDuration))
    }

    /// Index of the last start <= s in a sorted list (0 when s precedes them all).
    static func lastStart(atOrBefore s: Double, in starts: [Double]) -> Int {
        var lo = 0
        var hi = starts.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if starts[mid] <= s { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// Segment starts on a keyframe grid, as Jellyfin's `ComputeSegments` cuts a copy: the first
    /// keyframe, then a keyframe at or past each mark, the mark moving on `segmentDuration` per cut.
    /// `keyframes` are output seconds, sorted. As on the fixed grid (`segmentCount`), a remainder shorter
    /// than `segmentDuration` folds into the last segment. Returns indices into `keyframes`, nil when
    /// fewer than two segments remain.
    static func keyframeGridStarts(keyframes: [Double], durationSeconds: Double) -> [Int]? {
        var picked: [Int] = []
        var mark = segmentDuration
        for (i, seconds) in keyframes.enumerated() where seconds >= 0 && (picked.isEmpty || seconds <= durationSeconds - segmentDuration) {
            if picked.isEmpty {
                picked.append(i)
            } else if seconds >= mark {
                picked.append(i)
                mark += segmentDuration
            }
        }
        return picked.count >= 2 ? picked : nil
    }

    /// Delete session directories that no live session owns: what a crash or a
    /// force-quit leaves behind. Called on start with the tokens still in use,
    /// since nothing else prunes the cache now that init no longer wipes it.
    static func sweepOrphans(keeping liveTokens: Set<String>) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let root = caches.appendingPathComponent("localremux", isDirectory: true)
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return }
        for name in entries where !liveTokens.contains(name) {
            try? FileManager.default.removeItem(at: root.appendingPathComponent(name))
        }
    }
}
