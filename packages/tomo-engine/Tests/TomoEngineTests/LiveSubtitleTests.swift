import AVFoundation
import Libavcodec
import Libavformat
import Libavutil
import XCTest

@testable import TomoEngine

/// A live HLS channel with a WebVTT rendition beside its variant: a real-time ffmpeg feed and a
/// subtitle playlist that grows a 2s VTT segment every 2s, one cue per segment.
final class LiveSubtitleTests: XCTestCase {
    /// Where the feed's MPEG-TS clock starts (1.4 s), which the VTT segments map to.
    private static let feedStartTicks = 126_000

    /// `relative`: each segment carries its own map, its cue at 0.5 s of WebVTT time, as a segmenter that restarts the clock writes it.
    private final class SubtitleWriter {
        private let root: URL
        private let ticks: Int
        private let relative: Bool
        private var stopped = false
        private let lock = NSLock()

        init(root: URL, ticks: Int, relative: Bool = false) {
            self.root = root
            self.ticks = ticks
            self.relative = relative
        }

        func start() {
            DispatchQueue.global().async { [self] in
                var playlist = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n"
                var n = 0
                while true {
                    lock.lock()
                    let done = stopped
                    lock.unlock()
                    if done { return }
                    let body = relative
                        ? "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:\(ticks + 2 * n * 90_000),LOCAL:00:00:00.000\n\n00:00:00.500 --> 00:00:01.500\nline \(n)\n"
                        : "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:\(ticks),LOCAL:00:00:00.000\n\n"
                        + String(format: "00:%02d:%06.3f --> 00:%02d:%06.3f\nline %d\n", (2 * n) / 60, Double((2 * n) % 60) + 0.5, (2 * n) / 60, Double((2 * n) % 60) + 1.5, n)
                    try? body.write(to: root.appendingPathComponent("subs\(n).vtt"), atomically: true, encoding: .utf8)
                    playlist += "#EXTINF:2.0,\nsubs\(n).vtt\n"
                    try? playlist.write(to: root.appendingPathComponent("subs.m3u8"), atomically: true, encoding: .utf8)
                    n += 1
                    Thread.sleep(forTimeInterval: 2)
                }
            }
        }

        func stop() {
            lock.lock()
            stopped = true
            lock.unlock()
        }
    }

    /// `tsOffsetSeconds` moves the feed's clock, and the VTT map with it; `deadFirst` lists a subtitle rendition with no segments first;
    /// `codecs` is the variant's CODECS; `lowerVariantFirst` lists a lower variant of the same feed before it.
    private func startChannel(in root: URL, defaultSubtitle: Bool = false, tsOffsetSeconds: Int = 0, deadFirst: Bool = false,
                              relativeCues: Bool = false, codecs: String? = nil, lowerVariantFirst: Bool = false) throws -> (feed: Process, subtitles: SubtitleWriter) {
        let subtitles = SubtitleWriter(root: root, ticks: Self.feedStartTicks + tsOffsetSeconds * 90_000, relative: relativeCues)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n".write(to: root.appendingPathComponent("dead.m3u8"), atomically: true, encoding: .utf8)
        subtitles.start()
        let feed = try startLiveFeed(in: root, tsOffsetSeconds: tsOffsetSeconds)
        let dead = deadFirst ? "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"Spanish\",LANGUAGE=\"es\",DEFAULT=NO,AUTOSELECT=YES,URI=\"dead.m3u8\"\n" : ""
        let master = """
        #EXTM3U
        #EXT-X-VERSION:3
        \(dead)#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=\(defaultSubtitle ? "YES" : "NO"),AUTOSELECT=YES,URI="subs.m3u8"
        \(lowerVariantFirst ? "#EXT-X-STREAM-INF:BANDWIDTH=400000,SUBTITLES=\"subs\"\nlive.m3u8\n" : "")#EXT-X-STREAM-INF:BANDWIDTH=900000\(codecs.map { ",CODECS=\"\($0)\"" } ?? ""),SUBTITLES="subs"
        live.m3u8

        """
        try master.write(to: root.appendingPathComponent("master.m3u8"), atomically: true, encoding: .utf8)
        return (feed, subtitles)
    }

    private func text(_ response: LocalHTTPResponse) -> String {
        if case .data(let data, _) = response { return String(decoding: data, as: UTF8.self) }
        return ""
    }

    /// Every cue the engine serves for the subtitle rendition: its number and output start, in seconds.
    private func servedCues(_ session: RemuxSession, name: String = "English") -> [Int: Double] {
        let master = text(session.route("master.m3u8"))
        guard let line = master.split(separator: "\n").first(where: { $0.contains("TYPE=SUBTITLES") && $0.contains("NAME=\"\(name)\"") }),
              let uri = LiveVariantPicker.attribute("URI", in: String(line)) else { return [:] }
        var cues: [Int: Double] = [:]
        for name in text(session.route(uri)).split(separator: "\n") where name.hasSuffix(".vtt") {
            let body = text(session.route(String(name))).components(separatedBy: "\n\n").dropFirst()
            for block in body {
                let lines = block.split(separator: "\n")
                guard lines.count >= 2, let n = Int(lines[1].split(separator: " ").last ?? ""),
                      let start = lines[0].components(separatedBy: " --> ").first else { continue }
                let fields = start.split(separator: ":").compactMap { Double($0) }
                cues[n] = fields.reduce(0) { $0 * 60 + $1 }
            }
        }
        return cues
    }

    /// Seconds from binding the host AVPlayer, once the session holds its start buffer, until its clock moves,
    /// and the legible options it lists, for a channel with or without a default WebVTT rendition.
    private func playerStart(withSubtitles: Bool, bufferSeconds: Double = 0) throws -> (seconds: Double, legible: Int) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-player-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root, defaultSubtitle: true)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        var config = makeConfig(durationSeconds: 0, inputUrl: "\(origin.base)/\(withSubtitles ? "master" : "live").m3u8", audioTracks: [], isLive: true, liveSegmentSeconds: 2)
        config.liveBufferSeconds = bufferSeconds
        let session = try RemuxSession(config: config)
        let loopback = LocalHTTPServer { path in
            let parts = path.split(separator: "/").map(String.init)
            return parts.count == 2 && parts[0] == session.token ? session.route(parts[1]) : .notFound
        }
        let port = try loopback.start()
        defer { loopback.stop() }
        session.loopbackBase = "http://127.0.0.1:\(port)/\(session.token)"
        session.start()
        defer { session.stop() }
        if bufferSeconds > 0 {
            XCTAssertTrue(spinMainRunLoop(seconds: 40) { (session.progress()["bufferedSeconds"] as? Double ?? 0) >= bufferSeconds }, "the engine never held \(bufferSeconds)s")
        }
        let bound = Date()
        let player = AVPlayer(url: try XCTUnwrap(URL(string: "\(session.loopbackBase!)/master.m3u8")))
        player.play()
        XCTAssertTrue(spinMainRunLoop(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 0.5 },
                      "never played: \(String(describing: player.currentItem?.error))")
        let seconds = Date().timeIntervalSince(bound)
        let legible = player.currentItem?.asset.mediaSelectionGroup(forMediaCharacteristic: .legible)?.options.count ?? 0
        player.pause()
        return (seconds, legible)
    }

    func testADefaultLiveSubtitleRenditionDoesNotDelayTheFirstFrameBehindTheStartBuffer() throws {
        let plain = try playerStart(withSubtitles: false, bufferSeconds: 15)
        let subtitled = try playerStart(withSubtitles: true, bufferSeconds: 15)
        print(String(format: "[LiveSubtitleTests] with a 15s start buffer, host AVPlayer playing after %.2fs without subtitles, %.2fs with a default one (%d legible option(s))",
                     plain.seconds, subtitled.seconds, subtitled.legible))
        XCTAssertGreaterThanOrEqual(subtitled.legible, 1, "the player lists no subtitle")
        XCTAssertLessThanOrEqual(subtitled.seconds, plain.seconds + 1, "the default subtitle delayed the first frame")
    }

    private final class EngineRun {
        let session: RemuxSession
        let loopback: LocalHTTPServer
        private let lock = NSLock()
        private var events: [String] = []
        private var failure: String?

        init(inputUrl: String, windowSeconds: Double = 300) throws {
            session = try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: inputUrl, audioTracks: [], isLive: true,
                                                          liveSegmentSeconds: 2, liveWindowSeconds: windowSeconds))
            let session = session
            loopback = LocalHTTPServer { path in
                let parts = path.split(separator: "/").map(String.init)
                return parts.count == 2 && parts[0] == session.token ? session.route(parts[1]) : .notFound
            }
            let port = try loopback.start()
            session.loopbackBase = "http://127.0.0.1:\(port)/\(session.token)"
            session.onLive = { [weak self] payload in
                guard let self else { return }
                self.lock.lock()
                self.events.append(payload["event"] as? String ?? "?")
                self.lock.unlock()
            }
            session.onFailed = { [weak self] payload in
                guard let self else { return }
                self.lock.lock()
                self.failure = "\(payload)"
                self.lock.unlock()
            }
            session.start()
        }

        func stop() {
            session.stop()
            loopback.stop()
        }

        var snapshot: (events: [String], failure: String?) {
            lock.lock()
            defer { lock.unlock() }
            return (events, failure)
        }

        var lastSegment: Int {
            session.mediaPlaylist().split(separator: "\n").compactMap { line in line.hasPrefix("seg") ? Int(line.dropFirst(3).dropLast(4)) : nil }.max() ?? -1
        }
    }

    /// A feed whose clock runs a minute ahead of its WebVTT time keeps its cues once the window rolls:
    /// a cue leaves with its segment, measured on the output timeline.
    func testCuesWithAMapLargerThanTheWindowStayServedAsTheWindowRolls() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-map-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root, tsOffsetSeconds: 60)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8", windowSeconds: 8)
        defer { run.stop() }

        let rolled = Date().addingTimeInterval(40)
        while Date() < rolled, run.lastSegment < 8 {
            if let failed = run.snapshot.failure { return XCTFail("session failed: \(failed)") }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertGreaterThanOrEqual(run.lastSegment, 8, "the window never rolled")
        let served = servedCues(run.session)
        print("[LiveSubtitleTests] window to segment \(run.lastSegment), cues served: \(served.keys.sorted())")
        XCTAssertGreaterThanOrEqual(served.count, 2, "the window's cues were pruned")
        assertOnTheTimeline(served, run.session, sourceStart: Double(Self.feedStartTicks) / 90_000 + 60)
    }

    /// Each served cue sits at its source time (the feed's clock start, plus 2n + 0.5) less the generation's anchor.
    private func assertOnTheTimeline(_ served: [Int: Double], _ session: RemuxSession, sourceStart: Double) {
        session.stateLock.lock()
        let anchor = session.sessionAnchorSeconds ?? .nan
        session.stateLock.unlock()
        for (n, start) in served {
            XCTAssertEqual(start, sourceStart + Double(2 * n) + 0.5 - anchor, accuracy: 0.01, "cue \(n)")
        }
    }

    /// Every segment carries its own map, cue times restarting at each: each cue still lands at its source time.
    func testCuesFromSegmentsThatEachCarryTheirOwnMapLandAtTheirSourceTime() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-relative-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root, relativeCues: true)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8")
        defer { run.stop() }

        var served: [Int: Double] = [:]
        let read = Date().addingTimeInterval(30)
        while Date() < read, served.count < 3 {
            if let failed = run.snapshot.failure { return XCTFail("session failed: \(failed)") }
            Thread.sleep(forTimeInterval: 0.5)
            served = servedCues(run.session)
        }
        XCTAssertGreaterThanOrEqual(served.count, 3, "no cue served")
        assertOnTheTimeline(served, run.session, sourceStart: Double(Self.feedStartTicks) / 90_000)
        let reads = Dictionary(grouping: origin.requests.map(\.path).filter { $0.hasSuffix(".vtt") }, by: { $0 }).mapValues(\.count)
        XCTAssertEqual(reads.values.max(), 1, "a WebVTT segment was read more than once: \(reads)")
    }

    /// Waits for `count` served cues, or the session's failure.
    private func waitForCues(_ run: EngineRun, count: Int, seconds: Double = 30) -> [Int: Double] {
        var served: [Int: Double] = [:]
        let until = Date().addingTimeInterval(seconds)
        while Date() < until, served.count < count, run.snapshot.failure == nil {
            Thread.sleep(forTimeInterval: 0.5)
            served = servedCues(run.session)
        }
        return served
    }

    /// The first read of each of the first three WebVTT segments is refused: each is read again and its cue served.
    func testASubtitleSegmentWhoseReadFailsIsReadAgain() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-refused-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        origin.refusals = ["/subs0.vtt": 1, "/subs1.vtt": 1, "/subs2.vtt": 1]
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8")
        defer { run.stop() }

        let served = waitForCues(run, count: 5)
        XCTAssertNil(run.snapshot.failure)
        XCTAssertTrue(Set([0, 1, 2]).isSubset(of: Set(served.keys)), "a refused segment's cue was never served: \(served.keys.sorted())")
        assertOnTheTimeline(served, run.session, sourceStart: Double(Self.feedStartTicks) / 90_000)
    }

    /// A variant whose CODECS names IMSC and no WebVTT offers no text track.
    func testAnImscRenditionIsNotOffered() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-imsc-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root, codecs: "avc1.64001f,mp4a.40.2,stpp.ttml.im1t")
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8")
        defer { run.stop() }

        let started = Date().addingTimeInterval(30)
        while Date() < started, run.lastSegment < 1, run.snapshot.failure == nil { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertNil(run.snapshot.failure)
        XCTAssertGreaterThanOrEqual(run.lastSegment, 1, "the video never cut")
        run.session.stateLock.lock()
        let tracks = (run.session.inputSubtitles ?? []).filter { $0.isEngineText }
        run.session.stateLock.unlock()
        XCTAssertEqual(tracks.map(\.name), [])
    }

    /// The engine's own master read fails, so FFmpeg opens the master untrimmed: a reopen opens it untrimmed too and rides on.
    func testAnInputFirstOpenedUntrimmedReopensUntrimmed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-untrimmed-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root, lowerVariantFirst: true)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        origin.refusals = ["/master.m3u8": 1]
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8")
        defer { run.stop() }

        let started = Date().addingTimeInterval(30)
        while Date() < started, run.lastSegment < 2, run.snapshot.failure == nil { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertGreaterThanOrEqual(run.lastSegment, 2, "the video never cut")
        origin.goSilent()
        Thread.sleep(forTimeInterval: 16)
        origin.speakAgain()
        let before = run.lastSegment
        let resumed = Date().addingTimeInterval(45)
        while Date() < resumed, run.lastSegment < before + 3, run.snapshot.failure == nil { Thread.sleep(forTimeInterval: 0.5) }
        print("[LiveSubtitleTests] untrimmed reopen: events \(run.snapshot.events), failure \(run.snapshot.failure ?? "none")")
        XCTAssertNil(run.snapshot.failure)
        XCTAssertTrue(run.snapshot.events.contains("reopened"), "the input was never reopened: \(run.snapshot.events)")
        XCTAssertGreaterThanOrEqual(run.lastSegment, before + 3, "the video stopped after the reopen")
    }

    /// A session with generation 0 anchored at 100 s of source time and segments 0 to 4 cut, 2 s each.
    private func placedSession() throws -> RemuxSession {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 0, audioTracks: [], isLive: true, liveSegmentSeconds: 2))
        session.stateLock.lock()
        session.textSubtitles[10_000] = TextSubtitleDecoder(liveStreamIndex: 10_000)
        session.sessionAnchorSeconds = 100
        for n in 0..<5 {
            session.liveSegmentStarts[n] = Double(2 * n)
            session.liveDurations[n] = 2
            session.liveDates[n + 1] = .distantPast
        }
        session.liveSubtitlePolledAt[10_000] = Date()
        session.stateLock.unlock()
        return session
    }

    /// Segment 5 opens generation 1 at 10 s of output on source time `keyframe`.
    private func roll(_ session: RemuxSession, keyframe: Double) {
        session.stateLock.lock()
        session.sessionAnchorSeconds = keyframe - 10
        session.liveGenerationStarts[5] = 1
        session.liveSegmentStarts[5] = 10
        session.liveDurations[5] = 2
        session.liveDates[6] = .distantPast
        session.stateLock.unlock()
    }

    private func cueTexts(_ session: RemuxSession, segment: Int) -> [String] {
        session.liveSubtitleBody(streamIndex: 10_000, segment: segment).components(separatedBy: "\n\n").dropFirst()
            .compactMap { $0.split(separator: "\n").last.map(String.init) }
    }

    /// A timeline that steps back 5 s: each generation's segments serve only their own cues.
    func testCuesAcrossATimelineThatStepsBackStayInTheirOwnGeneration() throws {
        let session = try placedSession()
        XCTAssertEqual(session.placeLiveCues([TextSubtitleCue(start: 104.5, end: 105.5, text: "before")], streamIndex: 10_000), [])
        roll(session, keyframe: 104)
        XCTAssertEqual(session.placeLiveCues([TextSubtitleCue(start: 104.5, end: 105.5, text: "after")], streamIndex: 10_000), [])
        XCTAssertEqual(cueTexts(session, segment: 2), ["before"])
        XCTAssertEqual(cueTexts(session, segment: 5), ["after"])
    }

    /// A timeline that restarts at 0: its cue waits until the video reaches it, then lands in the new generation.
    func testACueFromARestartedTimelineWaitsForTheVideoAndSurvivesThePrune() throws {
        let session = try placedSession()
        let restarted = TextSubtitleCue(start: 0.5, end: 1.5, text: "restarted")
        XCTAssertEqual(session.placeLiveCues([TextSubtitleCue(start: 104.5, end: 105.5, text: "before"), restarted], streamIndex: 10_000), [restarted])
        roll(session, keyframe: 0)
        XCTAssertEqual(session.placeLiveCues([restarted], streamIndex: 10_000), [])
        session.stateLock.lock()
        session.textSubtitles[10_000]?.dropCues(endingBefore: 8)
        session.stateLock.unlock()
        XCTAssertEqual(cueTexts(session, segment: 5), ["restarted"])
    }

    /// A cut that carried a hole of a second or more leaves the splice limit where it was.
    func testACutThatCarriedAHoleDoesNotRaiseTheSpliceLimit() {
        XCTAssertEqual(RemuxSession.longestLiveCut(2, cut: 3.9, largestStepUs: 1_900_000), 2)
        XCTAssertEqual(RemuxSession.longestLiveCut(2, cut: 4.2, largestStepUs: 40_000), 4.2)
    }

    /// A subtitle rendition with no segments yet is still offered, and the live one after it is followed.
    func testATrackIsFollowedFromItsOwnRenditionWhenAnEarlierOneIsDead() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-dead-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root, deadFirst: true)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8")
        defer { run.stop() }

        var served: [Int: Double] = [:]
        let read = Date().addingTimeInterval(30)
        while Date() < read, served.count < 2 {
            if let failed = run.snapshot.failure { return XCTFail("session failed: \(failed)") }
            Thread.sleep(forTimeInterval: 0.5)
            served = servedCues(run.session)
        }
        run.session.stateLock.lock()
        let tracks = (run.session.inputSubtitles ?? []).filter { $0.isEngineText }
        run.session.stateLock.unlock()
        XCTAssertEqual(tracks.map(\.name), ["Spanish", "English"], "every rendition the master names is offered")
        XCTAssertGreaterThanOrEqual(served.count, 2, "the English rendition's cues were not served")
        assertOnTheTimeline(served, run.session, sourceStart: Double(Self.feedStartTicks) / 90_000)
    }

    /// The video keeps cutting, with no reopen and no failure, while the subtitle rendition stops growing or goes away.
    private func assertVideoOutlivesItsSubtitles(removePlaylist: Bool) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-gone-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let run = try EngineRun(inputUrl: "\(origin.base)/master.m3u8")
        defer { run.stop() }

        let started = Date().addingTimeInterval(30)
        while Date() < started, servedCues(run.session).isEmpty {
            if let failed = run.snapshot.failure { return XCTFail("session failed: \(failed)") }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertFalse(servedCues(run.session).isEmpty, "no cue before the subtitles stopped")
        channel.subtitles.stop()
        Thread.sleep(forTimeInterval: 0.5)
        if removePlaylist { try FileManager.default.removeItem(at: root.appendingPathComponent("subs.m3u8")) }
        let before = run.lastSegment
        Thread.sleep(forTimeInterval: 30)
        print("[LiveSubtitleTests] subtitles \(removePlaylist ? "gone" : "frozen"): segment \(before) to \(run.lastSegment), events \(run.snapshot.events), failure \(run.snapshot.failure ?? "none")")
        XCTAssertNil(run.snapshot.failure)
        XCTAssertFalse(run.snapshot.events.contains("reopening"), "the channel was reopened: \(run.snapshot.events)")
        XCTAssertGreaterThanOrEqual(run.lastSegment, before + 10, "the video stopped cutting")
    }

    func testTheVideoPlaysOnWhenTheSubtitlePlaylistStopsGrowing() throws {
        try assertVideoOutlivesItsSubtitles(removePlaylist: false)
    }

    func testTheVideoPlaysOnWhenTheSubtitlePlaylistGoesAway() throws {
        try assertVideoOutlivesItsSubtitles(removePlaylist: true)
    }

    /// The engine serves the rendition's cues at their source time (WebVTT time plus the map) less the
    /// generation's anchor, before a reopen and after it.
    func testTheEngineServesALiveWebVttRenditionOnTheVideosTimelineAcrossAReopen() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-subs-engine-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let channel = try startChannel(in: root)
        defer {
            channel.feed.terminate()
            channel.subtitles.stop()
        }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: "\(origin.base)/master.m3u8", audioTracks: [], isLive: true, liveSegmentSeconds: 2))
        let loopback = LocalHTTPServer { path in
            let parts = path.split(separator: "/").map(String.init)
            return parts.count == 2 && parts[0] == session.token ? session.route(parts[1]) : .notFound
        }
        let port = try loopback.start()
        defer { loopback.stop() }
        session.loopbackBase = "http://127.0.0.1:\(port)/\(session.token)"
        session.start()
        defer { session.stop() }
        let source = { (n: Int) in Double(Self.feedStartTicks) / 90_000 + Double(2 * n) + 0.5 }

        var before: [Int: Double] = [:]
        let first = Date().addingTimeInterval(30)
        while Date() < first, before.count < 3 {
            Thread.sleep(forTimeInterval: 0.5)
            before = servedCues(session)
        }
        session.stateLock.lock()
        let anchor0 = session.sessionAnchorSeconds ?? .nan
        session.stateLock.unlock()
        XCTAssertGreaterThanOrEqual(before.count, 3, "no cue served")
        for (n, start) in before {
            XCTAssertEqual(start, source(n) - anchor0, accuracy: 0.01, "cue \(n) before the reopen")
        }

        origin.goSilent()
        let silencedAt = servedCues(session).keys.max() ?? 0
        Thread.sleep(forTimeInterval: 16)
        origin.speakAgain()
        // The feed ran on through the 16s of silence, so the reopened generation's cues come 8 or more later.
        var after: [Int: Double] = [:]
        let resumed = Date().addingTimeInterval(45)
        while Date() < resumed, after.count < 3 {
            Thread.sleep(forTimeInterval: 0.5)
            after = servedCues(session).filter { $0.key >= silencedAt + 8 }
        }
        session.stateLock.lock()
        let anchor1 = session.sessionAnchorSeconds ?? .nan
        session.stateLock.unlock()
        XCTAssertNotEqual(anchor0, anchor1, "the input was never reopened")
        XCTAssertGreaterThanOrEqual(after.count, 3, "no cue served after the reopen")
        for (n, start) in after {
            XCTAssertEqual(start, source(n) - anchor1, accuracy: 0.01, "cue \(n) after the reopen")
        }
    }
}
