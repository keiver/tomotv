import XCTest

@testable import TomoEngine

/// The live pipeline against a real unbounded MPEG-TS source: a window forms, cuts land on
/// keyframes, and a splice in the stream rolls a generation instead of ending the session.
/// Opt in with TOMO_LIVE_SOURCE (the raw paced streamer of the Live TV probe rig, which loops
/// a byte-spliced TS whose PTS steps from 71.4s back to 1.4s once per pass).
final class LivePipelineTests: XCTestCase {
    private static let ffprobe = "/opt/homebrew/bin/ffprobe"

    private struct Entry {
        let name: String
        let duration: Double
        let map: String
        let closedBySplice: Bool
    }

    /// Segments in playlist order with the MAP in force and whether a DISCONTINUITY follows.
    private func entries(_ playlist: String) -> [Entry] {
        let lines = playlist.split(separator: "\n").map(String.init)
        var out: [Entry] = []
        var map = ""
        for (i, line) in lines.enumerated() where line.hasPrefix("#EXTINF:") || line.hasPrefix("#EXT-X-MAP:URI=") {
            if line.hasPrefix("#EXT-X-MAP:URI=") {
                map = String(line.dropFirst(16).dropLast())
                continue
            }
            let duration = Double(line.dropFirst(8).dropLast()) ?? -1
            let name = lines[i + 1]
            let next = i + 2 < lines.count ? lines[i + 2] : ""
            out.append(Entry(name: name, duration: duration, map: map, closedBySplice: next == "#EXT-X-DISCONTINUITY"))
        }
        return out
    }

    private func firstVideoDts(dir: URL, map: String, segment: String) throws -> Double {
        let data = try Data(contentsOf: dir.appendingPathComponent(map)) + Data(contentsOf: dir.appendingPathComponent(segment))
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("live-\(segment).mp4")
        try data.write(to: tmp)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffprobe)
        p.arguments = ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=dts_time", "-of", "csv=p=0", "-read_intervals", "%+#1", tmp.path]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        return try XCTUnwrap(Double(out.split(separator: "\n").first ?? ""), "no dts from \(segment): \(out)")
    }

    /// ffprobe fields of `init + segment` from the session directory: codec, dimension or rate, extradata size.
    private func probeRendition(dir: URL, map: String, segment: String, entries: String) throws -> (fields: [String], context: String) {
        let initData = try Data(contentsOf: dir.appendingPathComponent(map))
        let segmentData = try Data(contentsOf: dir.appendingPathComponent(segment))
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("live-probe-\(segment).mp4")
        try (initData + segmentData).write(to: tmp)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffprobe)
        p.arguments = ["-v", "error", "-select_streams", "0", "-show_entries", entries, "-of", "csv=p=0", tmp.path]
        let pipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = pipe
        p.standardError = errPipe
        try p.run()
        p.waitUntilExit()
        let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let err = String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let context = "\(map)+\(segment): init \(initData.count) bytes, segment \(segmentData.count) bytes, ffprobe: \(out) / \(err)"
        return (out.split(separator: ",").map(String.init), context)
    }

    /// Two ADTS AAC tracks from a TS source, each stream-copied into its own audio rendition:
    /// this build has no aac_adtstoasc bsf, so the engine writes the AudioSpecificConfig itself
    /// and strips the ADTS headers, or movenc refuses the first packet with -1.
    func testAdtsAacTracksCopyIntoAudioRenditions() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_MULTI"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_MULTI to a live H.264 + two-AAC MPEG-TS URL")
        }
        guard FileManager.default.isExecutableFile(atPath: Self.ffprobe) else { throw XCTSkip("no ffprobe at \(Self.ffprobe)") }
        // The server's probe listed one track (measured); the engine carries every stream it finds.
        let tracks = [RemuxAudioTrack(index: 1, name: "Stereo", language: "und", serverAudioUrl: "")]
        let session = try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: source, audioTracks: tracks, codecs: "avc1.4d401f,mp4a.40.2", width: 1024, height: 576, isLive: true))
        let lock = NSLock()
        var failure: String?
        session.onFailed = { payload in
            lock.lock()
            failure = "\(payload)"
            lock.unlock()
        }
        session.start()
        defer { session.stop() }

        var playlist = ""
        let formed = Date().addingTimeInterval(60)
        while Date() < formed, entries(playlist).count < 2 {
            lock.lock()
            let f = failure
            lock.unlock()
            if let f { return XCTFail("session failed: \(f)") }
            playlist = session.mediaPlaylist(prefix: "a1")
            Thread.sleep(forTimeInterval: 1)
        }
        let master = session.masterPlaylist()
        XCTAssertEqual(master.components(separatedBy: "#EXT-X-MEDIA:TYPE=AUDIO").count - 1, 2, master)
        XCTAssertTrue(master.contains("NAME=\"Stereo\""), master)
        XCTAssertTrue(master.contains("LANGUAGE=\"eng\""), "the discovered track is named by its stream language: \(master)")
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)
        for (prefix, rate, channels) in [("a0", "48000", "2"), ("a1", "22050", "1")] {
            let list = entries(session.mediaPlaylist(prefix: prefix))
            XCTAssertGreaterThanOrEqual(list.count, 2, prefix)
            guard list.count >= 2 else { continue }
            let (fields, context) = try probeRendition(dir: dir, map: list[1].map, segment: list[1].name, entries: "stream=codec_name,sample_rate,channels,extradata_size")
            XCTAssertEqual(fields.count > 0 ? fields[0] : nil, "aac", context)
            XCTAssertEqual(fields.count > 1 ? fields[1] : nil, rate, context)
            XCTAssertEqual(fields.count > 2 ? fields[2] : nil, channels, context)
            XCTAssertEqual(fields.count > 3 ? fields[3] : nil, "2", "AudioSpecificConfig missing: \(context)")
        }
        let video = entries(session.mediaPlaylist())
        XCTAssertGreaterThanOrEqual(video.count, 2)
        if video.count >= 2 {
            let (fields, context) = try probeRendition(dir: dir, map: video[1].map, segment: video[1].name, entries: "stream=codec_name,width")
            XCTAssertEqual(fields.first, "h264", context)
        }

        // This source loops a 46s cut whose first video packet is a keyframe, so its splice
        // opens the new generation on the very packet that rolled it: the muxer bound for that
        // packet is the one the roll freed (the 2026-09-12 crash), unless it is rebound.
        let spliced = Date().addingTimeInterval(75)
        var rolled = session.mediaPlaylist()
        while Date() < spliced, !rolled.contains("#EXT-X-DISCONTINUITY") {
            lock.lock()
            let f = failure
            lock.unlock()
            if let f { return XCTFail("session failed before the splice: \(f)") }
            Thread.sleep(forTimeInterval: 1)
            rolled = session.mediaPlaylist()
        }
        XCTAssertTrue(rolled.contains("#EXT-X-DISCONTINUITY"), "no generation roll within 75s: \(rolled)")
        let afterRoll = entries(rolled).count
        Thread.sleep(forTimeInterval: 8)
        lock.lock()
        let late = failure
        lock.unlock()
        XCTAssertNil(late, "session failed after the splice")
        XCTAssertGreaterThan(entries(session.mediaPlaylist()).count, afterRoll, "no segments after the splice")
    }

    /// An Annex-B H.264 TS source stream-copied: this FFmpeg build has no extract_extradata bsf,
    /// so the parameter sets must be lifted from the opening keyframe or the init carries an
    /// empty avcC (AVPlayer -19601) and a video-only muxer refuses the first write.
    func testAnH264TransportStreamCopiesWithParameterSetsInItsInit() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_H264"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_H264 to a live H.264 MPEG-TS or HLS URL")
        }
        guard FileManager.default.isExecutableFile(atPath: Self.ffprobe) else { throw XCTSkip("no ffprobe at \(Self.ffprobe)") }
        // A 2s target against a source whose keyframes come every 5-7s: the copy lane cannot
        // honour the target, and every EXTINF must still round to at most the TARGETDURATION
        // announced by the first playlist (RFC 8216 4.3.3.1), or AVPlayer refuses a reload.
        let session = try RemuxSession(
            config: makeConfig(durationSeconds: 0, inputUrl: source, codecs: "avc1.640029,ac-3", width: 1280, height: 544, isLive: true, liveSegmentSeconds: 2))
        let lock = NSLock()
        var failure: String?
        session.onFailed = { payload in
            lock.lock()
            failure = "\(payload)"
            lock.unlock()
        }
        session.start()
        defer { session.stop() }

        var playlist = ""
        let formed = Date().addingTimeInterval(60)
        while Date() < formed, entries(playlist).count < 2 {
            lock.lock()
            let f = failure
            lock.unlock()
            if let f { return XCTFail("session failed: \(f)") }
            playlist = session.mediaPlaylist()
            Thread.sleep(forTimeInterval: 1)
        }
        let list = entries(playlist)
        XCTAssertGreaterThanOrEqual(list.count, 2, playlist)
        let announced = try XCTUnwrap(Int(try XCTUnwrap(playlist.split(separator: "\n").first { $0.hasPrefix("#EXT-X-TARGETDURATION:") }).dropFirst(22)))
        Thread.sleep(forTimeInterval: 30)
        let later = session.mediaPlaylist()
        XCTAssertTrue(later.contains("#EXT-X-TARGETDURATION:\(announced)\n"), "TARGETDURATION moved: \(later)")
        for entry in entries(later) {
            XCTAssertLessThanOrEqual(entry.duration.rounded(), Double(announced), "\(entry.name) is \(entry.duration)s against TARGETDURATION \(announced)")
            XCTAssertLessThanOrEqual(entry.duration, Double(announced) + 0.5, "\(entry.name) exceeds the target by more than 0.5s")
        }

        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)
        let initData = try Data(contentsOf: dir.appendingPathComponent(list[1].map))
        let segmentData = try Data(contentsOf: dir.appendingPathComponent(list[1].name))
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("live-h264-\(list[1].name).mp4")
        try (initData + segmentData).write(to: tmp)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffprobe)
        p.arguments = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,extradata_size", "-of", "csv=p=0", tmp.path]
        let pipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = pipe
        p.standardError = errPipe
        try p.run()
        p.waitUntilExit()
        let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let err = String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let boxes = initData.count >= 8 ? String(decoding: initData.prefix(64).map { $0 >= 0x20 && $0 < 0x7f ? $0 : 0x2e }, as: UTF8.self) : "(short)"
        let context = "init \(initData.count) bytes [\(boxes)], segment \(segmentData.count) bytes, ffprobe: \(out) / \(err)"
        let fields = out.split(separator: ",").map(String.init)
        XCTAssertEqual(fields.first, "h264", context)
        XCTAssertEqual(fields.count > 1 ? Int(fields[1]) : nil, 1280, context)
        XCTAssertGreaterThan(fields.count > 2 ? Int(fields[2]) ?? 0 : 0, 0, "init carries no parameter sets: \(context)")
    }

    func testAnUnboundedSourceFormsAWindowAndRollsOnASplice() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE to a live MPEG-TS URL")
        }
        let session = try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: source, width: 1920, height: 804, isLive: true))
        let lock = NSLock()
        var failure: String?
        session.onFailed = { payload in
            lock.lock()
            failure = "\(payload)"
            lock.unlock()
        }
        session.start()
        defer { session.stop() }
        func failed() -> String? {
            lock.lock()
            defer { lock.unlock() }
            return failure
        }

        XCTAssertTrue(session.masterPlaylist().contains("media.m3u8"))

        // Three segments: the window is forming.
        var playlist = ""
        let formed = Date().addingTimeInterval(90)
        while Date() < formed, entries(playlist).count < 3 {
            if let f = failed() { return XCTFail("session failed: \(f)") }
            playlist = session.mediaPlaylist()
            Thread.sleep(forTimeInterval: 1)
        }
        var list = entries(playlist)
        XCTAssertGreaterThanOrEqual(list.count, 3, playlist)
        XCTAssertFalse(playlist.contains("#EXT-X-ENDLIST"))
        XCTAssertFalse(playlist.contains("#EXT-X-PLAYLIST-TYPE"))
        XCTAssertTrue(playlist.contains("#EXT-X-MEDIA-SEQUENCE:"))
        XCTAssertTrue(playlist.contains("#EXT-X-PROGRAM-DATE-TIME:"))
        let targetLine = try XCTUnwrap(playlist.split(separator: "\n").first { $0.hasPrefix("#EXT-X-TARGETDURATION:") })
        let target = try XCTUnwrap(Int(targetLine.dropFirst(22)))
        for entry in list {
            // A keyframe-aligned cut lands at or past the target; only a splice closes a segment early.
            if !entry.closedBySplice {
                XCTAssertGreaterThanOrEqual(entry.duration, 6.0 - 0.05, "\(entry.name) cut short: \(entry.duration)s")
            }
            XCTAssertLessThanOrEqual(entry.duration.rounded(), Double(target), "\(entry.name) exceeds TARGETDURATION \(target)")
        }

        // The splice rolls a generation: a DISCONTINUITY and a new MAP, and production goes on.
        let spliced = Date().addingTimeInterval(120)
        while Date() < spliced, !playlist.contains("#EXT-X-DISCONTINUITY\n") {
            if let f = failed() { return XCTFail("session failed before the splice: \(f)") }
            playlist = session.mediaPlaylist()
            Thread.sleep(forTimeInterval: 1)
        }
        XCTAssertTrue(playlist.contains("#EXT-X-DISCONTINUITY\n"), playlist)
        list = entries(playlist)
        let splice = try XCTUnwrap(list.firstIndex { $0.closedBySplice }, playlist)
        XCTAssertLessThan(splice + 1, list.count, "no segment after the splice yet")
        XCTAssertNotEqual(list[splice].map, list[splice + 1].map, "the new generation must carry its own init")
        XCTAssertTrue(list[splice + 1].map.hasPrefix("init-g"), list[splice + 1].map)

        let before = list.count
        Thread.sleep(forTimeInterval: 15)
        playlist = session.mediaPlaylist()
        XCTAssertGreaterThan(entries(playlist).count, before, "production stopped after the splice")
        XCTAssertNil(failed())

        // Output time keeps climbing across the splice: the first decode time after it is past
        // the first decode time before it, read back by ffprobe from init+segment concatenations.
        guard FileManager.default.isExecutableFile(atPath: Self.ffprobe) else { return }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)
        let dtsBefore = try firstVideoDts(dir: dir, map: list[splice].map, segment: list[splice].name)
        let dtsAfter = try firstVideoDts(dir: dir, map: list[splice + 1].map, segment: list[splice + 1].name)
        XCTAssertGreaterThan(dtsAfter, dtsBefore, "output time went backwards across the splice")
    }

    /// key_frame flag of the first video frame of `init + segment`.
    private func firstFrameIsKeyframe(dir: URL, map: String, segment: String) throws -> Bool {
        let data = try Data(contentsOf: dir.appendingPathComponent(map)) + Data(contentsOf: dir.appendingPathComponent(segment))
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("live-key-\(segment).mp4")
        try data.write(to: tmp)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffprobe)
        p.arguments = ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=key_frame", "-of", "csv=p=0", "-read_intervals", "%+#1", tmp.path]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return out.hasPrefix("1")
    }

    /// A copy source whose keyframe interval is far longer than the segment target: every live
    /// segment still opens on a keyframe (the cut waits for one), its EXTINF runs one GOP long
    /// rather than being force-cut mid-GOP, and TARGETDURATION accommodates it. Opt in with
    /// TOMO_LIVE_SOURCE_LONGGOP (an ~10s-GOP H.264 MPEG-TS on the loopback; see the rig README).
    func testALongGopCopySourceCutsOnKeyframesNotAtTheTarget() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_LONGGOP"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_LONGGOP to a long-GOP live MPEG-TS URL")
        }
        let session = try RemuxSession(config: makeConfig(durationSeconds: 0, inputUrl: source, width: 1280, height: 720, isLive: true, liveSegmentSeconds: 2))
        let lock = NSLock()
        var failure: String?
        session.onFailed = { payload in
            lock.lock()
            failure = "\(payload)"
            lock.unlock()
        }
        session.start()
        defer { session.stop() }
        func failed() -> String? {
            lock.lock()
            defer { lock.unlock() }
            return failure
        }

        var playlist = ""
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline, entries(playlist).count < 3 {
            if let f = failed() { return XCTFail("session failed: \(f)") }
            playlist = session.mediaPlaylist()
            Thread.sleep(forTimeInterval: 1)
        }
        let list = entries(playlist)
        XCTAssertGreaterThanOrEqual(list.count, 3, playlist)

        let targetLine = try XCTUnwrap(playlist.split(separator: "\n").first { $0.hasPrefix("#EXT-X-TARGETDURATION:") })
        let target = try XCTUnwrap(Int(targetLine.dropFirst(22)))
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)

        // Every listed segment but the last (the last is still open) is a full GOP, opens on a
        // keyframe, and rounds to no more than TARGETDURATION.
        for entry in list.dropLast() {
            XCTAssertGreaterThanOrEqual(entry.duration, 6.0, "\(entry.name) was cut before a keyframe: \(entry.duration)s")
            XCTAssertLessThanOrEqual(entry.duration.rounded(), Double(target), "\(entry.name) exceeds TARGETDURATION \(target)")
            if FileManager.default.isExecutableFile(atPath: Self.ffprobe) {
                XCTAssertTrue(try firstFrameIsKeyframe(dir: dir, map: entry.map, segment: entry.name), "\(entry.name) does not open on a keyframe")
            }
        }
    }
}
