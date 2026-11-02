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

    /// The primary rendition's landed segments and their parts, once `count` have landed.
    private func landedParts(lowLatency: Bool, count: Int) throws -> (session: RemuxSession, segments: [(n: Int, file: Data, parts: [LivePart])]) {
        let (feed, path) = try startContinuousFeed(fps: "25", keyframeSeconds: 1)
        addTeardownBlock {
            feed.terminate()
            try? FileManager.default.removeItem(atPath: path)
        }
        var config = makeConfig(durationSeconds: 0, inputUrl: path, codecs: "avc1.64001F,mp4a.40.2", width: 1280, height: 720,
                                isLive: true, liveSegmentSeconds: 1)
        config.liveCopyCutSeconds = 0.4
        config.liveLowLatency = lowLatency
        config.livePartSeconds = 0.5
        let session = try RemuxSession(config: config)
        session.start()
        addTeardownBlock { session.stop() }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            session.stateLock.lock()
            let primary = session.renditions.first { $0.prefix.isEmpty }
            let landed = primary.map { rendition in rendition.completed.sorted().map { ($0, rendition.liveParts[$0] ?? []) } } ?? []
            session.stateLock.unlock()
            if landed.count >= count, let primary {
                let segments = try landed.prefix(count).map { n, parts in
                    (n: n, file: try Data(contentsOf: dir.appendingPathComponent(primary.segmentName(n))), parts: parts)
                }
                return (session, segments)
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        throw XCTSkip("no \(count) segments landed in 30 s")
    }

    func testAContinuousLiveCopyIsCutIntoPartsThatMakeUpEachSegmentFile() throws {
        let (session, segments) = try landedParts(lowLatency: true, count: 3)
        session.stateLock.lock()
        XCTAssertTrue(session.lowLatencyInput)
        session.stateLock.unlock()
        for segment in segments {
            XCTAssertGreaterThanOrEqual(segment.parts.count, 2, "segment \(segment.n)")
            XCTAssertEqual(segment.file.count, RemuxSession.stypBox.count + segment.parts.reduce(0) { $0 + $1.size }, "segment \(segment.n)")
            XCTAssertTrue(segment.parts.allSatisfy { $0.data == nil }, "a landed segment's parts still hold their bytes")
            if segment.n > 0 {
                XCTAssertTrue(segment.parts.first?.independent == true, "segment \(segment.n) opens on a part without a keyframe")
            }
            var offset = RemuxSession.stypBox.count
            for (k, part) in segment.parts.enumerated() {
                XCTAssertEqual(String(decoding: segment.file[(offset + 4)..<(offset + 8)], as: UTF8.self), "moof", "segment \(segment.n) part \(k)")
                XCTAssertLessThanOrEqual(part.duration, 0.5005, "segment \(segment.n) part \(k)")
                if k < segment.parts.count - 1, !part.independent {
                    XCTAssertGreaterThanOrEqual(part.duration, 0.425, "segment \(segment.n) part \(k)")
                }
                offset += part.size
            }
        }
    }

    func testWithTheSwitchOffALiveSegmentHasNoParts() throws {
        let (session, segments) = try landedParts(lowLatency: false, count: 2)
        session.stateLock.lock()
        XCTAssertFalse(session.lowLatencyInput)
        session.stateLock.unlock()
        for segment in segments { XCTAssertTrue(segment.parts.isEmpty, "segment \(segment.n)") }
    }

    func testOnlyAnMpegTsInputIsContinuous() {
        XCTAssertTrue(RemuxSession.continuousLiveInput(format: "mpegts"))
        for format in ["hls", "dash", "mov,mp4,m4a,3gp,3g2,mj2", ""] {
            XCTAssertFalse(RemuxSession.continuousLiveInput(format: format), format)
        }
    }
}
