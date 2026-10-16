import Foundation
import XCTest

@testable import TomoEngine

/// A file with many tracks is not prepared whole: the engine feeds the playing audio track, every
/// copied one and the subtitle tracks it will show, and brings the rest up when picked or, for
/// converted audio, one per segment once the app says playback has settled.
final class TrackActivationTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/track-activation-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private static let pgsFixture = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Fixtures/pgs-track.sup")

    /// Video (stream 0, a keyframe every second) and the audio tracks as streams 1..., then the
    /// SubRip tracks, then the PGS track from the fixture when asked for.
    private func fixture(name: String, seconds: Int, audioEncoders: [String], subtitleTexts: [String] = [], pgs: Bool = false) -> URL? {
        let out = Self.fixtureDir.appendingPathComponent("\(name).mkv")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        var args = ["-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=\(seconds)"]
        for (i, _) in audioEncoders.enumerated() {
            args += ["-f", "lavfi", "-i", "sine=frequency=\(440 + i * 220):duration=\(seconds):sample_rate=48000"]
        }
        for (i, text) in subtitleTexts.enumerated() {
            let srt = Self.fixtureDir.appendingPathComponent("\(name)-\(i).srt")
            try? "1\n00:00:00,500 --> 00:00:02,500\n\(text)\n\n2\n00:00:07,000 --> 00:00:09,000\n\(text) again\n".write(to: srt, atomically: true, encoding: .utf8)
            args += ["-i", srt.path]
        }
        if pgs { args += ["-i", Self.pgsFixture.path] }
        args += ["-map", "0:v"]
        for i in audioEncoders.indices { args += ["-map", "\(i + 1):a"] }
        for i in subtitleTexts.indices { args += ["-map", "\(audioEncoders.count + i + 1):s"] }
        if pgs { args += ["-map", "\(audioEncoders.count + subtitleTexts.count + 1):s"] }
        args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0"]
        for (i, enc) in audioEncoders.enumerated() {
            args += ["-c:a:\(i)", enc]
            if enc == "ac3" { args += ["-ac:a:\(i)", "6"] }
        }
        for i in subtitleTexts.indices { args += ["-c:s:\(i)", "subrip"] }
        if pgs { args += ["-c:s:\(subtitleTexts.count)", "copy"] }
        args += [out.path]

        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: out.path) else {
            try? FileManager.default.removeItem(at: out)
            return nil
        }
        return out
    }

    private func track(_ index: Int, _ name: String) -> RemuxAudioTrack {
        RemuxAudioTrack(index: index, name: name, language: "eng", serverAudioUrl: "")
    }

    private func text(_ index: Int, selected: Bool = false, isDefault: Bool = false) -> RemuxSubtitle {
        var sub = RemuxSubtitle(index: index, name: "Text \(index)", language: "eng", vttUrl: "", localVtt: "",
                                isDefault: isDefault, isForced: false, isImage: false, isEngineText: true)
        sub.isSelected = selected
        return sub
    }

    private func image(_ index: Int) -> RemuxSubtitle {
        RemuxSubtitle(index: index, name: "PGS \(index)", language: "eng", vttUrl: "", localVtt: "",
                      isDefault: false, isForced: false, isImage: true, isEngineText: false)
    }

    /// The playing track converts (mp2), the second copies (aac), the third converts (mp2): streams 1, 2, 3.
    private func threeAudioSession(seconds: Int = 15, subtitles: [RemuxSubtitle] = [], pgs: Bool = false, name: String = "three-audio",
                                   startOffsetSeconds: Double = 0, readAheadSegments: Int = 8) throws -> RemuxSession {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: name, seconds: seconds, audioEncoders: ["mp2", "aac", "mp2"],
                                   subtitleTexts: subtitles.filter { $0.isEngineText }.map { "TEXT \($0.index)" }, pgs: pgs) else {
            throw XCTSkip("could not generate the three-audio fixture")
        }
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: Double(seconds), inputUrl: source.path,
            audioTracks: [track(1, "Converted one"), track(2, "Copied"), track(3, "Converted two")],
            subtitles: subtitles,
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: readAheadSegments,
            startOffsetSeconds: startOffsetSeconds))
        session.start()
        return session
    }

    private func exists(_ session: RemuxSession, _ name: String) -> Bool {
        FileManager.default.fileExists(atPath: session.dir.appendingPathComponent(name).path)
    }

    private func isActive(_ session: RemuxSession, _ prefix: String) -> Bool? {
        session.stateLock.lock()
        defer { session.stateLock.unlock() }
        return session.renditions.first { $0.prefix == prefix }?.active
    }

    /// The fragment's decode time in seconds of its init's track clock.
    private func tfdtSeconds(_ session: RemuxSession, init initName: String, fragment: String) throws -> Double {
        let initData = try Data(contentsOf: session.dir.appendingPathComponent(initName))
        let fragmentData = try Data(contentsOf: session.dir.appendingPathComponent(fragment))
        func u32(_ data: Data, _ at: Int) -> UInt32 {
            (UInt32(data[at]) << 24) | (UInt32(data[at + 1]) << 16) | (UInt32(data[at + 2]) << 8) | UInt32(data[at + 3])
        }
        let mdhd = try XCTUnwrap(initData.range(of: Data("mdhd".utf8))?.upperBound)
        let tfdt = try XCTUnwrap(fragmentData.range(of: Data("tfdt".utf8))?.upperBound)
        let timescale = Double(u32(initData, mdhd + (initData[mdhd] == 1 ? 20 : 12)))
        let decode = fragmentData[tfdt] == 1 ? (UInt64(u32(fragmentData, tfdt + 4)) << 32) | UInt64(u32(fragmentData, tfdt + 8)) : UInt64(u32(fragmentData, tfdt + 4))
        return Double(decode) / timescale
    }

    private func settle(_ seconds: Double = 10, until done: () -> Bool) {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end, !done() { usleep(50_000) }
    }

    func testOnlyThePlayingAndCopiedAudioTracksAreFedAtStart() throws {
        let session = try threeAudioSession()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        XCTAssertNotNil(session.segmentURL(0, prefix: "a0"))
        XCTAssertNotNil(session.segmentURL(0, prefix: "a1"))
        settle { session.reachedEnd }
        XCTAssertTrue(exists(session, "a0-seg0.m4s"), "the playing track converts from the start")
        XCTAssertTrue(exists(session, "a1-seg0.m4s"), "a copied track is fed from the start")
        XCTAssertFalse(exists(session, "a2-seg0.m4s"), "a converted track nobody picked writes nothing")
        XCTAssertTrue(exists(session, "a2-init.mp4"), "its header exists for the master's CODECS and a later pick")
        XCTAssertEqual(isActive(session, "a2"), false)
        XCTAssertEqual(isActive(session, "a1"), true)
    }

    func testAPickOfAnUnfedTrackBringsItUpAtTheSegmentAsked() throws {
        let session = try threeAudioSession()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }
        XCTAssertFalse(exists(session, "a2-seg1.m4s"))
        let primaryBefore = try Data(contentsOf: session.dir.appendingPathComponent("seg1.m4s"))
        let copiedBefore = try Data(contentsOf: session.dir.appendingPathComponent("a1-seg1.m4s"))

        XCTAssertNotNil(session.segmentURL(1, prefix: "a2"), "the pick is served")
        XCTAssertEqual(isActive(session, "a2"), true)
        XCTAssertTrue(exists(session, "a2-seg1.m4s"))
        session.stateLock.lock()
        let restarts = session.seekRestarts
        session.stateLock.unlock()
        XCTAssertEqual(restarts, 1, "one restart at the segment asked for")
        settle { session.reachedEnd }
        XCTAssertEqual(try Data(contentsOf: session.dir.appendingPathComponent("seg1.m4s")), primaryBefore, "the primary's segment is not rewritten by the pick's generation")
        XCTAssertEqual(try Data(contentsOf: session.dir.appendingPathComponent("a1-seg1.m4s")), copiedBefore, "nor a copied track's")
        let picked = try tfdtSeconds(session, init: "a2-init.mp4", fragment: "a2-seg1.m4s")
        let copied = try tfdtSeconds(session, init: "a1-init.mp4", fragment: "a1-seg1.m4s")
        XCTAssertEqual(picked, copied, accuracy: 0.05, "the picked track's segment opens where the others' does")
        XCTAssertEqual(picked, 6, accuracy: 0.1)
    }

    /// A request ahead of a generation restarted behind the producer for a pick waits for it, and a
    /// track's request for a segment the primary already holds goes through the pick's own seek,
    /// which the control block never drops.
    func testARequestAheadWaitsForAPicksGenerationAndATracksOwnGapSeeksThroughThePick() throws {
        let session = try threeAudioSession()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }
        session.stateLock.lock()
        defer { session.stateLock.unlock() }
        session.activationGeneration = true
        session.activationSpanEnd = 1
        XCTAssertFalse(session.seekForStrandedLocked(2, prefix: "", producing: 0), "a video request inside the pick's span waits")
        XCTAssertNil(session.pendingSeekSegment)
        XCTAssertTrue(session.seekForStrandedLocked(9, prefix: "", producing: 0), "a request past the span is a seek")
        XCTAssertEqual(session.pendingSeekSegment, 9)
        session.pendingSeekSegment = nil
        session.activationGeneration = false
        XCTAssertTrue(session.seekForStrandedLocked(1, prefix: "a2", producing: 2))
        XCTAssertEqual(session.activationSeekSegment, 1, "the primary holds segment 1, so a2's request restarts through the pick's seek")
        XCTAssertNil(session.pendingSeekSegment)
        XCTAssertTrue(session.seekForStrandedLocked(1, prefix: "", producing: 2))
        XCTAssertEqual(session.pendingSeekSegment, 1, "the primary's own request behind the producer is a plain seek")
    }

    /// A subtitle pick restarts where the viewer is, not at the last segment the player buffered.
    func testASubtitlePickRestartsAtThePlayhead() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60, subtitles: [text(4, isDefault: true), text(5)]))
        defer { session.stop() }
        session.stateLock.lock()
        session.lastRequestedSegment = 5
        session.firstMediaRequestSeen = true
        session.stateLock.unlock()
        session.notePlayerBuffer(aheadSeconds: 20, sinceSeek: false)
        session.requestSubtitleActivation(text(5))
        session.stateLock.lock()
        XCTAssertEqual(session.activationSeekSegment, 2, "36 s buffered to, 20 s ahead of the playhead: the playhead is in segment 2")
        session.stateLock.unlock()
        session.requestSubtitleActivation(text(5), at: 1)
        session.requestSubtitleActivation(text(5), at: 4)
        session.stateLock.lock()
        XCTAssertEqual(session.activationSeekSegment, 2, "a window behind the playhead does not pull the restart back; one ahead does not push it forward")
        session.stateLock.unlock()
    }

    func testADolbyCopyIsFedFromTheStartAndItsInitExists() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "mp2-ac3", seconds: 15, audioEncoders: ["mp2", "ac3"]) else {
            throw XCTSkip("could not generate the mp2 and ac3 fixture")
        }
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 15, inputUrl: source.path, audioTracks: [track(1, "Converted"), track(2, "Dolby")],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8))
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }
        XCTAssertEqual(isActive(session, "a1"), true)
        XCTAssertTrue(exists(session, "a1-init.mp4"), "a Dolby copy's header comes with its first cut")
        XCTAssertTrue(exists(session, "a1-seg0.m4s"))
    }

    func testTheRampBringsUpOneTrackPerSegmentAndMarksItsFirstSegment() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "four-audio", seconds: 20, audioEncoders: ["mp2", "mp2", "mp2", "aac"]) else {
            throw XCTSkip("could not generate the four-audio fixture")
        }
        let session = try RemuxSession(config: makeConfig(
            durationSeconds: 20, inputUrl: source.path,
            audioTracks: [track(1, "Playing"), track(2, "Converted two"), track(3, "Converted three"), track(4, "Copied")],
            width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8))
        let lock = NSLock()
        var samples: [[String: Any]] = []
        session.onThroughput = { sample in
            lock.lock()
            samples.append(sample)
            lock.unlock()
        }
        session.armTrackRamp()
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }

        XCTAssertFalse(exists(session, "a1-seg0.m4s"), "nothing comes up inside the segment the ramp was armed in")
        XCTAssertTrue(exists(session, "a1-seg1.m4s"), "the first inactive track comes up at the first cut")
        XCTAssertFalse(exists(session, "a2-seg1.m4s"), "one track per segment")
        XCTAssertTrue(exists(session, "a2-seg2.m4s"), "the next one at the next cut")
        XCTAssertTrue(exists(session, "a3-seg0.m4s"), "a copied track was fed from the start")
        lock.lock()
        let activating = samples.map { ($0["segment"] as? Int ?? -1, $0["activating"] as? Bool ?? false) }
        lock.unlock()
        XCTAssertEqual(activating.filter { $0.1 }.map { $0.0 }, [1, 2], "each track's first segment is marked for the app")
        XCTAssertEqual(isActive(session, "a1"), true)
        XCTAssertEqual(isActive(session, "a2"), true)
    }

    func testOnlyTheDefaultForcedAndSelectedSubtitleTracksGetDecodersAtStart() throws {
        let session = try threeAudioSession(subtitles: [text(4, isDefault: true), text(5, selected: true), text(6)], name: "three-audio-three-text")
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        session.stateLock.lock()
        let decoders = Set(session.textSubtitles.keys)
        session.stateLock.unlock()
        XCTAssertEqual(decoders, [4, 5], "the default and the selected track decode from the start; the third waits for a pick")
    }

    func testAPickedTextTrackGetsItsDecoderAndCuesAtThePlayhead() throws {
        let session = try threeAudioSession(subtitles: [text(4, isDefault: true), text(5)], name: "three-audio-two-text")
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }
        XCTAssertNotNil(session.subtitlePlaylist(streamIndex: 5))
        let body = try XCTUnwrap(session.subtitleSegment(streamIndex: 5, segment: 1))
        XCTAssertTrue(body.contains("TEXT 5 again"), "the picked track's cues at the window asked for:\n\(body)")
        session.stateLock.lock()
        let decoder = session.textSubtitles[5]
        session.stateLock.unlock()
        XCTAssertNotNil(decoder)
        XCTAssertTrue(session.subtitleSegment(streamIndex: 4, segment: 1)?.contains("TEXT 4 again") ?? false, "the track decoded from the start still has its cues")
    }

    func testAPickedImageTrackGetsItsDecoderAndSets() throws {
        let session = try threeAudioSession(subtitles: [image(4)], pgs: true, name: "three-audio-pgs")
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }
        session.stateLock.lock()
        let before = session.imageSubtitles[4]
        session.stateLock.unlock()
        XCTAssertNil(before, "an image track nobody picked has no decoder")
        XCTAssertNil(session.subtitleCueManifest(streamIndex: 4), "the first manifest request is the pick; the app asks again")
        settle { session.subtitleCueManifest(streamIndex: 4).map { manifest in
            (try? JSONSerialization.jsonObject(with: manifest) as? [String: Any]).flatMap { ($0?["events"] as? [Any])?.isEmpty == false } ?? false
        } ?? false }
        let manifest = try XCTUnwrap(session.subtitleCueManifest(streamIndex: 4))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: manifest) as? [String: Any])
        XCTAssertFalse(try XCTUnwrap(payload["events"] as? [Any]).isEmpty, "the sets arrive from the restart")
    }

    func testASelfDescribedSessionFeedsEveryTrack() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg),
              let source = fixture(name: "three-audio", seconds: 15, audioEncoders: ["mp2", "aac", "mp2"]) else {
            throw XCTSkip("could not generate the three-audio fixture")
        }
        var config = makeConfig(durationSeconds: 15, inputUrl: source.path, width: 320, height: 240, frameRate: 25, bandwidth: 4_000_000, readAheadSegments: 8)
        config.describesInput = true
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.reachedEnd }
        XCTAssertTrue(exists(session, "a2-seg0.m4s"), "a held file keeps every track fed")
        XCTAssertEqual(isActive(session, "a2"), true)
    }

    /// A subtitle the player picks before it has asked for any media (its own selection at load) restarts
    /// the engine at the resume point's segment, not at 0: the picked track's first cue is the one past it.
    func testASubtitlePickBeforeAnyMediaRequestRestartsAtTheResumePoint() throws {
        let session = try threeAudioSession(subtitles: [text(4, isDefault: true), text(5)], name: "three-audio-two-text", startOffsetSeconds: 7)
        defer { session.stop() }
        XCTAssertNotNil(session.subtitlePlaylist(streamIndex: 5), "the pick before any media request")
        settle { session.reachedEnd }
        let later = try XCTUnwrap(session.subtitleSegment(streamIndex: 5, segment: 1))
        XCTAssertTrue(later.contains("TEXT 5 again"), "the cue past the resume point:\n\(later)")
        session.stateLock.lock()
        let readFrom = session.readSpanFrom ?? -1
        session.stateLock.unlock()
        XCTAssertEqual(readFrom, 6, accuracy: 0.5, "the restart was at the resume point's segment, not at 0")
    }

    /// A session held by its read-ahead window after segment 0: the producer sits at segment 3 with
    /// segments 3 and up not made, so a seek there is a real seek, not one the pipeline already answered.
    private func heldSession(subtitles: [RemuxSubtitle] = [], name: String) throws -> RemuxSession {
        let session = try threeAudioSession(seconds: 60, subtitles: subtitles, name: name, readAheadSegments: 2)
        XCTAssertNotNil(session.segmentURL(0))
        settle { session.producingSegment >= 3 && self.exists(session, "seg2.m4s") }
        return session
    }

    /// A subtitle pick pending beside a seek restarts once, at the seek: the seek is the newer answer to where the viewer is.
    func testASubtitlePickBesideASeekRestartsOnceAtTheSeek() throws {
        let session = try heldSession(subtitles: [text(4, isDefault: true), text(5)], name: "three-audio-two-text-60")
        defer { session.stop() }
        session.stateLock.lock()
        let restartsBefore = session.seekRestarts
        session.lastRequestedSegment = 6
        session.pendingSeekSegment = 6
        session.activationSeekSegment = 1
        session.pendingSubtitleActivations = [5]
        session.stateLock.unlock()
        settle { self.exists(session, "seg6.m4s") }
        session.stateLock.lock()
        let restarts = session.seekRestarts - restartsBefore
        let from = session.readSpanFrom ?? -1
        let decoder = session.textSubtitles[5]
        session.stateLock.unlock()
        XCTAssertEqual(restarts, 1)
        XCTAssertEqual(from, 36, accuracy: 0.5, "the one restart was at the seek's segment")
        XCTAssertNotNil(decoder, "the pick rode the seek's restart")
        XCTAssertFalse(exists(session, "seg1.m4s") && !exists(session, "seg6.m4s"), "no restart went to the pick's segment")
    }

    /// An audio pick near a seek restarts at the pick's segment, and the generation covers up to the seek
    /// so a request there waits instead of restarting over the pick.
    func testAnAudioPickNearASeekRestartsAtThePickAndCoversTheSeek() throws {
        let session = try heldSession(name: "three-audio-60")
        defer { session.stop() }
        session.stateLock.lock()
        session.lastRequestedSegment = 5
        session.pendingSeekSegment = 5
        session.pendingAudioActivations = ["a2"]
        session.activationSeekSegment = 4
        session.stateLock.unlock()
        settle { self.exists(session, "a2-seg4.m4s") && self.exists(session, "a2-seg5.m4s") }
        session.stateLock.lock()
        let spanEnd = session.activationSpanEnd
        session.stateLock.unlock()
        XCTAssertTrue(exists(session, "a2-seg4.m4s"), "the pick's own segment is made")
        XCTAssertTrue(exists(session, "a2-seg5.m4s"), "and the seek's segment follows in the same generation")
        XCTAssertEqual(spanEnd, 5, "the generation covers up to the seek")
    }

    /// An audio pick far from a seek lets the seek win: the player has moved on, and a wait across the gap
    /// would outlast its request. The picked track is fed from the seek.
    func testAnAudioPickFarFromASeekLetsTheSeekWin() throws {
        let session = try heldSession(name: "three-audio-60")
        defer { session.stop() }
        session.stateLock.lock()
        session.lastRequestedSegment = 8
        session.pendingSeekSegment = 8
        session.pendingAudioActivations = ["a2"]
        session.activationSeekSegment = 1
        session.stateLock.unlock()
        settle { self.exists(session, "a2-seg8.m4s") }
        XCTAssertTrue(exists(session, "a2-seg8.m4s"), "the picked track is fed from the seek")
        XCTAssertFalse(exists(session, "a2-seg1.m4s"), "no generation went back to the pick's segment")
    }

    /// The segment file is written off the pipeline thread: a segment is served only once its file has
    /// landed, and a restart in the middle of the run leaves no half-written file behind.
    func testASegmentIsServedOnceItsFileLandedAndARestartLeavesNoPartialFile() throws {
        let session = try threeAudioSession(seconds: 30, name: "three-audio-30")
        defer { session.stop() }
        for n in 0 ... 2 {
            let url = try XCTUnwrap(session.segmentURL(n))
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), "segment \(n) served before its file landed")
        }
        // Far enough ahead of the producer for a seek restart while earlier files may still be landing.
        XCTAssertNotNil(session.segmentURL(4))
        settle(20) { session.reachedEnd }
        let names = try FileManager.default.contentsOfDirectory(atPath: session.dir.path)
        XCTAssertTrue(names.filter { $0.hasPrefix(".") }.isEmpty, "temporary files left in \(names)")
        XCTAssertTrue(names.contains("seg4.m4s"))
    }
}
