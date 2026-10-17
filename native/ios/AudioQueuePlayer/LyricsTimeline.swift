//
//  LyricsTimeline.swift
//  TomoTV
//
//  A song's lyrics as JS hands them over (services/jellyfin/lyrics.ts), and the two
//  questions the player asks of them: which line is sung at a time, and how far into it.
//

import Foundation

struct LyricCue {
    /// UTF-16 offsets into the line, the server's own string indices.
    let position: Int
    let endPosition: Int
    let start: Double
}

struct LyricLine {
    let text: String
    /// nil on an unsynced line.
    let start: Double?
    let cues: [LyricCue]
}

struct Lyrics {
    let synced: Bool
    let lines: [LyricLine]
    /// One line printed above the lyrics, such as where generated ones came from.
    let caption: String?

    init?(dictionary: [String: Any]) {
        guard let rawLines = dictionary["lines"] as? [[String: Any]], !rawLines.isEmpty else { return nil }
        caption = dictionary["caption"] as? String
        lines = rawLines.map { raw in
            let text = raw["text"] as? String ?? ""
            let length = (text as NSString).length
            // NSNumber, not Int or Double: the bridge sends 3 and 3.0 alike, and a cast to one fails the other.
            let cues: [LyricCue] = ((raw["cues"] as? [[String: Any]]) ?? []).compactMap { cue in
                guard let position = (cue["position"] as? NSNumber)?.intValue,
                      let endPosition = (cue["endPosition"] as? NSNumber)?.intValue,
                      let start = (cue["start"] as? NSNumber)?.doubleValue,
                      position >= 0, endPosition > position, endPosition <= length else { return nil }
                return LyricCue(position: position, endPosition: endPosition, start: start)
            }
            return LyricLine(text: text, start: (raw["start"] as? NSNumber)?.doubleValue, cues: cues)
        }
        synced = (dictionary["synced"] as? Bool ?? false) && lines.contains { $0.start != nil }
    }

    /// The last line that has started, or nil before the first one and for unsynced lyrics.
    func lineIndex(at time: Double) -> Int? {
        guard synced else { return nil }
        var low = 0
        var high = lines.count - 1
        var found: Int?
        while low <= high {
            let mid = (low + high) / 2
            if (lines[mid].start ?? .infinity) <= time {
                found = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        return found
    }

    /// UTF-16 length of the line sung so far. A line without cues counts as sung whole.
    func sungLength(inLine index: Int, at time: Double) -> Int {
        let line = lines[index]
        guard !line.cues.isEmpty else { return (line.text as NSString).length }
        return line.cues.reduce(0) { $1.start <= time ? max($0, $1.endPosition) : $0 }
    }

    /// Every moment the display changes: each line start and each word start.
    var boundaryTimes: [Double] {
        guard synced else { return [] }
        var times = Set<Double>()
        for line in lines {
            if let start = line.start, start > 0 { times.insert(start) }
            for cue in line.cues where cue.start > 0 { times.insert(cue.start) }
        }
        return times.sorted()
    }
}
