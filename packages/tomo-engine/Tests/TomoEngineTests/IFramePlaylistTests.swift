import AVFoundation
import Libavutil
import XCTest

@testable import TomoEngine

/// The I-frame rendition AVKit scrubs with. Its shape (one keyframe per fragment over a video-only
/// init) drew thumbnails on an Apple TV on 2026-10-05; no I-frame variant drew none.
final class IFramePlaylistTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0
    private static let ms = AVRational(num: 1, den: 1000)

    // MARK: - Entries and playlist

    func testEachKeyframeLastsUntilTheNextAndTheLastRunsToTheEnd() throws {
        let index = KeyframeIndex(timestamps: [0, 2000, 4000, 6000], timeBase: Self.ms)
        let playlist = try XCTUnwrap(IFrameEntries.indexed(index, anchorSeconds: 0, durationSeconds: 7)).playlist(durationSeconds: 7)
        XCTAssertTrue(playlist.contains("#EXT-X-I-FRAMES-ONLY\n#EXT-X-MAP:URI=\"if-init.mp4\"\n"))
        XCTAssertTrue(playlist.contains("#EXT-X-TARGETDURATION:2\n"))
        XCTAssertTrue(playlist.contains("#EXTINF:2.000000,\nkf0.m4s\n#EXTINF:2.000000,\nkf1.m4s\n#EXTINF:2.000000,\nkf2.m4s\n#EXTINF:1.000000,\nkf3.m4s\n#EXT-X-ENDLIST\n"))
    }

    func testKeyframesBeforeTheAnchorAreLeftOutAndTheFirstRunsFromZero() throws {
        let index = KeyframeIndex(timestamps: [0, 1500, 3500], timeBase: Self.ms)
        let entries = try XCTUnwrap(IFrameEntries.indexed(index, anchorSeconds: 1, durationSeconds: 5))
        XCTAssertEqual(entries.stamps, [0.5, 2.5])
        XCTAssertEqual(entries.sources, [1.5, 3.5])
        let playlist = entries.playlist(durationSeconds: 5)
        XCTAssertTrue(playlist.contains("#EXTINF:2.500000,\nkf0.m4s\n#EXTINF:2.500000,\nkf1.m4s\n"))
        XCTAssertTrue(playlist.contains("#EXT-X-TARGETDURATION:3\n"))
    }

    func testGridEntriesSitOnSegmentStartsAndReadTheSourceAtTheAnchoredTime() throws {
        let entries = try XCTUnwrap(IFrameEntries.grid(starts: [0, 6, 12], anchorSeconds: 1.4))
        XCTAssertFalse(entries.exact)
        XCTAssertEqual(entries.sources, [1.4, 7.4, 13.4])
        XCTAssertTrue(entries.playlist(durationSeconds: 15).contains("#EXTINF:6.000000,\nkf0.m4s\n#EXTINF:6.000000,\nkf1.m4s\n#EXTINF:3.000000,\nkf2.m4s\n"))
    }

    func testKeyframesUnderASecondApartAreThinned() throws {
        let index = try XCTUnwrap(KeyframeIndex.thinned([0, 500, 1000, 1700, 2600], timeBase: Self.ms))
        XCTAssertEqual(index.timestamps, [0, 1000, 2600])
        XCTAssertNil(KeyframeIndex.thinned([0, 400], timeBase: Self.ms))
    }

    // MARK: - Store

    /// styp + moof(mfhd, traf(tfhd track 1, tfdt v1)) + mdat, the shape movenc writes.
    private static func fragment(tfdt: UInt64, payload: UInt8) -> Data {
        func box(_ type: String, _ body: Data) -> Data {
            var out = Data()
            withUnsafeBytes(of: UInt32(8 + body.count).bigEndian) { out.append(contentsOf: $0) }
            out.append(contentsOf: Array(type.utf8))
            return out + body
        }
        func u32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.bigEndian) { Data($0) } }
        let tfhd = box("tfhd", u32(0) + u32(1))
        let tfdtBox = box("tfdt", u32(1 << 24) + withUnsafeBytes(of: tfdt.bigEndian) { Data($0) })
        let moof = box("moof", box("mfhd", u32(0) + u32(1)) + box("traf", tfhd + tfdtBox))
        return RemuxSession.stypBox + moof + box("mdat", Data([payload]))
    }

    private static func tfdt(_ data: Data) -> UInt64? {
        guard let at = data.range(of: Data("tfdt".utf8))?.upperBound else { return nil }
        return (0..<8).reduce(UInt64(0)) { ($0 << 8) | UInt64(data[at + 4 + $1]) }
    }

    func testAnEntryThatCannotBeMadeGetsTheNearestFrameAtItsOwnTime() throws {
        let entries = IFrameEntries(stamps: [0, 2, 4, 6], sources: [0, 2, 4, 6], exact: true)
        let store = IFrameStore(entries: entries, timescale: 1000) { k in
            k == 1 ? Self.fragment(tfdt: UInt64(entries.stamps[k] * 1000), payload: UInt8(k)) : nil
        }
        defer { store.stop() }
        XCTAssertEqual(store.fragment(1, budget: 1).flatMap(Self.tfdt), 2000)
        // Entry 2's read fails: entry 1's frame answers at entry 2's time, never a miss.
        let stand = try XCTUnwrap(store.fragment(2, budget: 0.2))
        XCTAssertEqual(Self.tfdt(stand), 4000)
        XCTAssertEqual(stand.last, 1, "the payload is entry 1's frame")
    }

    func testAFailingSourceIsLeftAloneAndServedFromWhatWasMade() throws {
        let entries = IFrameEntries(stamps: [0, 2, 4, 6], sources: [0, 2, 4, 6], exact: true)
        let lock = NSLock()
        var calls = 0
        let store = IFrameStore(entries: entries, timescale: 1000) { k in
            lock.lock()
            calls += 1
            lock.unlock()
            return k == 0 ? Self.fragment(tfdt: 0, payload: 0) : nil
        }
        defer { store.stop() }
        XCTAssertNotNil(store.fragment(0, budget: 1))
        XCTAssertNotNil(store.fragment(3, budget: 0.2))
        XCTAssertNotNil(store.fragment(2, budget: 0.2))
        lock.lock()
        let made = calls
        lock.unlock()
        XCTAssertEqual(made, 2, "after a failed read the source rests (\(IFrameStore.backoff[0]) s) instead of being read again")
    }

    func testTheNewestRequestIsMadeFirst() throws {
        let entries = IFrameEntries(stamps: [0, 2, 4, 6, 8], sources: [0, 2, 4, 6, 8], exact: true)
        let gate = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var made: [Int] = []
        let store = IFrameStore(entries: entries, timescale: 1000) { k in
            if k == 0 { gate.wait() }
            lock.lock()
            made.append(k)
            lock.unlock()
            return Self.fragment(tfdt: UInt64(k * 2000), payload: UInt8(k))
        }
        defer { store.stop() }
        let group = DispatchGroup()
        for k in [0, 1, 2, 3] {
            group.enter()
            DispatchQueue.global().async {
                _ = store.fragment(k, budget: 10)
                group.leave()
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        gate.signal()
        XCTAssertEqual(group.wait(timeout: .now() + 10), .success)
        lock.lock()
        defer { lock.unlock() }
        XCTAssertEqual(made, [0, 3, 2, 1])
    }

    // MARK: - Master

    private func iframeLines(_ master: String) -> [String] {
        master.components(separatedBy: "\n").filter { $0.hasPrefix("#EXT-X-I-FRAME-STREAM-INF:") }
    }

    func testMasterListsTheIFrameVariantOnceTheVideoIsPlanned() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60, codecs: "avc1.640028,mp4a.40.2", bandwidth: 8_000_000))
        defer { session.stop() }
        session.iframeTranscodes = false
        XCTAssertEqual(iframeLines(session.masterPlaylist()),
                       ["#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=8000000,CODECS=\"avc1.640028\",RESOLUTION=1920x1080,VIDEO-RANGE=SDR,URI=\"iframes.m3u8\""])
    }

    func testMasterHasNoIFrameVariantBeforeTheVideoIsPlanned() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60))
        defer { session.stop() }
        XCTAssertTrue(iframeLines(session.masterPlaylist()).isEmpty)
    }

    func testLadderMasterListsTheIFrameVariantBesideTheCopy() throws {
        var config = makeConfig(
            durationSeconds: 18, codecs: "hvc1.2.4.L150.B0,ec-3", bandwidth: 6_640_000,
            tiers: [TierConfig(playlistUrl: "http://tier.test/t0.m3u8", bandwidth: 260_000, codecs: "avc1.64000C,mp4a.40.2", width: 256, height: 144)])
        config.primaryVideoCodecs = "hvc1.2.4.L150.B0"
        config.primaryVideoBandwidth = 6_000_000
        let session = try RemuxSession(config: config)
        defer { session.stop() }
        session.gridResolved = true
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.sourceReady = true
        session.sourceState = .ready
        session.copyVerdict = .listed
        session.testLinkBps = 1_000_000
        session.linkProbeDone = true
        session.openingRung = 0
        session.iframeTranscodes = false
        let master = session.masterPlaylist()
        XCTAssertTrue(master.contains("t0.m3u8"), "the slow link lists the ladder")
        XCTAssertEqual(iframeLines(master).count, 1)
    }

    // MARK: - End to end

    private struct Fixture {
        let name: String
        let extension_: String
        let args: [String]
        let codecs: String
        /// Seconds between entries the rendition lists: keyframes when indexed, else the 6 s grid.
        let spacing: Double
        let exact: Bool
    }

    private static let gop = ["-g", "48", "-keyint_min", "48", "-sc_threshold", "0"]
    private static let fixtures: [String: Fixture] = [
        "h264-mkv": Fixture(name: "h264", extension_: "mkv", args: ["-c:v", "libx264", "-preset", "ultrafast", "-bf", "2"] + gop + ["-c:a", "aac"],
                            codecs: "avc1.64000D,mp4a.40.2", spacing: 2, exact: true),
        "hevc-mkv": Fixture(name: "hevc", extension_: "mkv",
                            args: ["-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "keyint=48:min-keyint=48:scenecut=0:bframes=2:log-level=error", "-c:a", "aac"],
                            codecs: "hvc1.1.6.L60.90,mp4a.40.2", spacing: 2, exact: true),
        "h264-ts": Fixture(name: "h264", extension_: "ts", args: ["-c:v", "libx264", "-preset", "ultrafast", "-bf", "2"] + gop + ["-c:a", "aac"],
                           codecs: "avc1.64000D,mp4a.40.2", spacing: 6, exact: false),
        "mpeg4-avi": Fixture(name: "mpeg4", extension_: "avi", args: ["-c:v", "mpeg4", "-vtag", "XVID"] + gop + ["-c:a", "libmp3lame"],
                             codecs: "", spacing: 2, exact: true),
        "mpeg2-ts": Fixture(name: "mpeg2", extension_: "ts", args: ["-c:v", "mpeg2video"] + gop + ["-c:a", "mp2"],
                            codecs: "", spacing: 6, exact: false),
    ]

    private static func file(_ key: String) -> URL? {
        guard let fixture = fixtures[key] else { return nil }
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("iframes-\(fixture.name)-gop2s-60s.\(fixture.extension_)")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y",
                       "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440",
                       "-t", String(seconds), "-pix_fmt", "yuv420p"] + fixture.args + [out.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        return p.terminationStatus == 0 && FileManager.default.fileExists(atPath: out.path) ? out : nil
    }

    private func box(_ type: String, in data: Data) -> Range<Int>? {
        data.range(of: Data(type.utf8)).map { ($0.lowerBound - 4)..<$0.upperBound }
    }

    private func u32(_ data: Data, _ at: Int) -> UInt32 {
        (UInt32(data[at]) << 24) | (UInt32(data[at + 1]) << 16) | (UInt32(data[at + 2]) << 8) | UInt32(data[at + 3])
    }

    private func runSession(_ key: String, check: (RemuxSession, UInt16) throws -> Void) throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let fixture = try XCTUnwrap(Self.fixtures[key])
        let source = try XCTUnwrap(Self.file(key), "ffmpeg produced no \(key) fixture")
        let origin = LocalHTTPServer { _ in .file(source, contentType: "application/octet-stream") }
        let originPort = try origin.start()
        defer { origin.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(originPort)/source.\(fixture.extension_)",
                                                          codecs: fixture.codecs, width: 320, height: 180, frameRate: 24, bandwidth: 600_000))
        session.start()
        defer { session.stop() }
        let server = LocalHTTPServer { request in session.route(String(request.dropFirst())) }
        let port = try server.start()
        defer { server.stop() }
        try check(session, port)
    }

    /// The master names the rendition, its entries follow the index or the grid, and an entry's
    /// fragment holds one key sample at its stamp on the track's own clock.
    private func assertServesEntries(_ key: String) throws {
        let fixture = try XCTUnwrap(Self.fixtures[key])
        try runSession(key) { session, _ in
            XCTAssertEqual(iframeLines(session.masterPlaylist()).count, 1)
            guard case .data(let body, _) = session.route("iframes.m3u8") else { return XCTFail("no I-frame playlist") }
            let playlist = String(decoding: body, as: UTF8.self)
            let entries = Int(Self.seconds / fixture.spacing)
            XCTAssertEqual(playlist.components(separatedBy: "kf").count - 1, entries, playlist)
            guard case .data(let initData, _) = session.route("if-init.mp4") else { return XCTFail("no I-frame init") }
            XCTAssertNotNil(box("moov", in: initData))
            guard case .data(let fragment, _) = session.route("kf5.m4s") else { return XCTFail("no fragment for entry 5") }
            XCTAssertEqual(String(decoding: fragment[4..<8], as: UTF8.self), "styp")
            let mdhd = try XCTUnwrap(box("mdhd", in: initData))
            let timescale = u32(initData, mdhd.upperBound + (initData[mdhd.upperBound] == 1 ? 20 : 12))
            let tfdt = try XCTUnwrap(box("tfdt", in: fragment))
            let decodeTime = fragment[tfdt.upperBound] == 1
                ? (UInt64(u32(fragment, tfdt.upperBound + 4)) << 32) | UInt64(u32(fragment, tfdt.upperBound + 8))
                : UInt64(u32(fragment, tfdt.upperBound + 4))
            XCTAssertEqual(Double(decodeTime) / Double(timescale), 5 * fixture.spacing, accuracy: 0.1)
            let trun = try XCTUnwrap(box("trun", in: fragment))
            XCTAssertEqual(u32(fragment, trun.upperBound + 4), 1, "one sample per fragment")
        }
    }

    func testH264MatroskaListsItsKeyframes() throws { try assertServesEntries("h264-mkv") }
    func testHevcMatroskaListsItsKeyframes() throws { try assertServesEntries("hevc-mkv") }
    func testMpegTsListsTheSegmentGrid() throws { try assertServesEntries("h264-ts") }
    func testTranscodedAviListsItsKeyframes() throws { try assertServesEntries("mpeg4-avi") }
    func testTranscodedMpegTsListsTheSegmentGrid() throws { try assertServesEntries("mpeg2-ts") }

    /// AVFoundation itself: the variant enables fast forward, and trick play decodes the entries it lists.
    private func assertTrickPlay(_ key: String) throws {
        let fixture = try XCTUnwrap(Self.fixtures[key])
        try runSession(key) { _, port in
            let item = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/master.m3u8")))
            let player = AVPlayer(playerItem: item)
            player.isMuted = true
            let ready = Date().addingTimeInterval(20)
            while item.status == .unknown, Date() < ready { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
            XCTAssertEqual(item.status, .readyToPlay, String(describing: item.error))
            XCTAssertTrue(item.canPlayFastForward)
            let output = AVPlayerItemVideoOutput(pixelBufferAttributes: nil)
            item.add(output)
            player.rate = 8
            defer { player.pause() }
            var frames = Set<Double>()
            let end = Date().addingTimeInterval(fixture.exact ? 5 : 8)
            while Date() < end {
                RunLoop.main.run(until: Date().addingTimeInterval(0.02))
                let time = output.itemTime(forHostTime: CACurrentMediaTime())
                if output.hasNewPixelBuffer(forItemTime: time), output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) != nil {
                    frames.insert((time.seconds * 10).rounded() / 10)
                }
            }
            let onEntries = frames.filter { $0 > 0 && abs($0 / fixture.spacing - ($0 / fixture.spacing).rounded()) < 0.05 }
            XCTAssertGreaterThanOrEqual(onEntries.count, 4, "decoded at \(frames.sorted())")
            for event in item.errorLog()?.events ?? [] {
                XCTFail("AVPlayer error \(event.errorStatusCode): \(event.errorComment ?? "") at \(event.uri ?? "")")
            }
        }
    }

    func testH264TrickPlayDecodesTheListedKeyframes() throws { try assertTrickPlay("h264-mkv") }
    func testHevcTrickPlayDecodesTheListedKeyframes() throws { try assertTrickPlay("hevc-mkv") }
    func testMpegTsTrickPlayDecodesTheGrid() throws { try assertTrickPlay("h264-ts") }
    func testTranscodedAviTrickPlayDecodesItsKeyframes() throws { try assertTrickPlay("mpeg4-avi") }
    func testTranscodedMpegTsTrickPlayDecodesTheGrid() throws { try assertTrickPlay("mpeg2-ts") }
}
