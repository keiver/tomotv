import XCTest

@testable import TomoEngine

/// LL-HLS part cuts on a 90 kHz MPEG-TS clock: every part fits PART-TARGET, and every part but a segment's last is at
/// least 85% of it, the two rules AVPlayer refuses a playlist over (-12642).
final class LivePartCutTests: XCTestCase {
    /// Part lengths when packets of `duration` seconds, decode times on the 90 kHz clock plus `jitterTicks`, are cut at `target`.
    private func parts(duration: Double, count: Int, target: Double, jitterTicks: [Int64] = [0]) -> [Double] {
        var lengths: [Double] = []
        var start: Double?
        var end = 0.0
        for n in 0..<count {
            let ticks = Int64((Double(n) * duration * 90_000).rounded()) + jitterTicks[n % jitterTicks.count]
            let dts = Double(ticks) / 90_000
            if let open = start, RemuxSession.partClosesBefore(dts: dts, duration: duration, partStartDts: open, target: target) {
                lengths.append(end - open)
                start = dts
            }
            if start == nil { start = dts }
            end = dts + duration
        }
        return lengths
    }

    func testVideoPartsFitTheTargetAndStayAboveEightyFivePercentAtBroadcastRates() {
        for target in [0.5, 1.0 / 3] {
            for fps in [24000.0 / 1001, 25, 30000.0 / 1001, 30, 50, 60000.0 / 1001] {
                let cut = parts(duration: 1 / fps, count: Int(fps * 20), target: target, jitterTicks: [0, 1, -1, 0])
                XCTAssertFalse(cut.isEmpty)
                for length in cut {
                    XCTAssertLessThanOrEqual(length, target + 0.0005, "a part runs past the target at \(fps) fps, target \(target)")
                    XCTAssertGreaterThanOrEqual(length, target * 0.85, "a part is under 85% of the target at \(fps) fps, target \(target)")
                }
            }
        }
    }

    func testAudioPartsFitTheTargetWithAacFramesAndBatchedAc3Packets() {
        for target in [0.5, 1.0 / 3] {
            for duration in [1024.0 / 48_000, 3 * 1536.0 / 48_000] {
                for length in parts(duration: duration, count: 400, target: target) {
                    XCTAssertLessThanOrEqual(length, target + 0.0005, "a part runs past the target at \(duration) s packets")
                }
            }
        }
    }

    func testAPartAlwaysHoldsItsFirstPacket() {
        XCTAssertFalse(RemuxSession.partClosesBefore(dts: 4, duration: 2, partStartDts: 4, target: 0.5))
    }

    func testOnlyAnMpegTsInputIsContinuous() {
        XCTAssertTrue(RemuxSession.continuousLiveInput(format: "mpegts"))
        for format in ["hls", "dash", "mov,mp4,m4a,3gp,3g2,mj2", ""] {
            XCTAssertFalse(RemuxSession.continuousLiveInput(format: format), format)
        }
    }
}
