import Foundation

/// Where an LL-HLS part ends. AVPlayer refuses the whole playlist (-12642) when a part runs past PART-TARGET or a
/// non-final part without an independent frame is under 85% of it (draft-pantos-hls-rfc8216bis 4.4.4.9).
extension RemuxSession {
    /// The input formats whose bytes arrive continuously: a tuner's or provider's MPEG-TS. An HLS or DASH origin arrives in segment bursts.
    static func continuousLiveInput(format: String) -> Bool {
        format == "mpegts"
    }

    /// Whether the open part closes before a packet at `dts` lasting `duration` (seconds, decode order): once writing it would
    /// carry the part past `target`. A part holds at least one packet.
    static func partClosesBefore(dts: Double, duration: Double, partStartDts: Double, target: Double) -> Bool {
        dts > partStartDts && dts + max(0, duration) - partStartDts > target + 0.0005
    }
}
