import Compression
import Libavcodec
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

    /// A copied grid with no sizes and nothing sampled declares the copy's peak as both values: a bound.
    func testMasterListsTheIFrameVariantOnceTheVideoIsPlanned() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60, codecs: "avc1.640028,mp4a.40.2", bandwidth: 8_000_000))
        defer { session.stop() }
        session.iframeTranscodes = false
        session.iframeSize = (1920, 1080)
        session.sessionAnchorSeconds = 0
        XCTAssertEqual(iframeLines(session.masterPlaylist()),
                       ["#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=8000000,AVERAGE-BANDWIDTH=8000000,CODECS=\"avc1.640028\",RESOLUTION=1920x1080,VIDEO-RANGE=SDR,URI=\"iframes.m3u8\""])
    }

    /// An encoded rendition is SDR H.264 inside 1920x1080, its peak the cap each frame is held under.
    func testAnEncodedRenditionIsDeclaredAsSdrInside1080pAtItsCap() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60, codecs: "hvc1.2.4.H153.90,fLaC", bandwidth: 43_000_000))
        defer { session.stop() }
        session.iframeTranscodes = true
        session.iframeSize = (1920, 800)
        session.sessionAnchorSeconds = 0
        XCTAssertEqual(iframeLines(session.masterPlaylist()),
                       ["#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=2000000,CODECS=\"avc1.640028\",RESOLUTION=1920x800,VIDEO-RANGE=SDR,URI=\"iframes.m3u8\""])
    }

    /// No source read for the sample until AVPlayer holds its reservoir; the item's next master declares the mean.
    func testASampleTakenAfterStartupIsDeclaredByTheItemsNextMaster() throws {
        let item = "sample-\(UUID().uuidString)"
        try runSession("h264-mkv", itemId: item) { session, _ in
            XCTAssertEqual(iframeLines(session.masterPlaylist()).count, 1)
            XCTAssertNil(session.rememberedIFrameMean(encodes: false), "nothing is sampled during startup")
            session.notePlayerBuffer(aheadSeconds: 600, sinceSeek: false)
            let deadline = Date().addingTimeInterval(30)
            while session.rememberedIFrameMean(encodes: false) == nil, Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
            let mean = try XCTUnwrap(session.rememberedIFrameMean(encodes: false), "no sampled mean")
            var config = makeConfig(durationSeconds: Self.seconds)
            config.itemId = item
            let next = try RemuxSession(config: config)
            defer { next.stop() }
            next.iframeTranscodes = false
            next.iframeSize = (320, 180)
            next.sessionAnchorSeconds = 0
            let line = try XCTUnwrap(iframeLines(next.masterPlaylist()).first)
            XCTAssertEqual(IFrameOracle.attribute("AVERAGE-BANDWIDTH", in: line).flatMap(Int.init), mean, line)
            XCTAssertLessThan(mean, try XCTUnwrap(IFrameOracle.attribute("BANDWIDTH", in: line).flatMap(Int.init)), line)
        }
    }

    func testOnlyAnSdrPictureInside1080pThatPlaybackCopiesIsCopied() throws {
        func encodes(_ width: Int32, _ height: Int32, trc: AVColorTransferCharacteristic, transcodes: Bool = false) -> Bool? {
            guard let par = avcodec_parameters_alloc() else { return nil }
            var owned: UnsafeMutablePointer<AVCodecParameters>? = par
            defer { avcodec_parameters_free(&owned) }
            par.pointee.width = width
            par.pointee.height = height
            par.pointee.color_trc = trc
            return RemuxSession.iframeEncodes(par: par, playbackTranscodes: transcodes)
        }
        XCTAssertEqual(encodes(960, 720, trc: AVCOL_TRC_BT709), false)
        XCTAssertEqual(encodes(1920, 1080, trc: AVCOL_TRC_UNSPECIFIED), false)
        XCTAssertEqual(encodes(1920, 1080, trc: AVCOL_TRC_BT709, transcodes: true), true)
        XCTAssertEqual(encodes(3840, 1600, trc: AVCOL_TRC_BT709), true)
        XCTAssertEqual(encodes(1920, 1080, trc: AVCOL_TRC_SMPTE2084), true)
        XCTAssertEqual(encodes(1920, 1080, trc: AVCOL_TRC_ARIB_STD_B67), true)
    }

    func testTheEncodedPictureFitsInside1920x1080KeepingItsShape() {
        XCTAssertTrue(VideoTranscoder.fittedSize(width: 3840, height: 1600, maxWidth: 1920, maxHeight: 1080) == (1920, 800))
        XCTAssertTrue(VideoTranscoder.fittedSize(width: 3840, height: 2160, maxWidth: 1920, maxHeight: 1080) == (1920, 1080))
        XCTAssertTrue(VideoTranscoder.fittedSize(width: 1440, height: 1440, maxWidth: 1920, maxHeight: 1080) == (1080, 1080))
        XCTAssertTrue(VideoTranscoder.fittedSize(width: 960, height: 720, maxWidth: 1920, maxHeight: 1080) == (960, 720))
    }

    // MARK: - Bandwidth

    /// RFC 8216 4.3.4.2: the peak is the densest run lasting 0.5 to 1.5 target durations, the mean all bytes over all time.
    func testIndexSizesGiveTheWindowedPeakAndTheMean() throws {
        let rates = try XCTUnwrap(IFrameBandwidth.measured(bytes: [100_000, 100_000, 400_000, 100_000], durations: [1, 1, 1, 1], targetDuration: 2))
        // Runs of 1 to 3 seconds: the single 400 KB entry is 3.2 Mb/s.
        XCTAssertEqual(rates.peak, 3_200_000)
        XCTAssertEqual(rates.average, 1_400_000)
    }

    /// A copied Matroska keyframe sits in its entry's cluster, so a run is bounded by the bytes its clusters span.
    func testClusterPositionsBoundACopiedRun() throws {
        let peak = try XCTUnwrap(IFrameBandwidth.positionBound(positions: [0, 1_000_000, 1_000_000, 3_000_000], fileSize: 4_000_000,
                                                              durations: [2, 2, 2, 2], targetDuration: 2))
        // Entries 1 and 2 share a cluster, so their span (2 MB) lies over their 4 s: the densest run is entries 1 to 2.
        XCTAssertGreaterThanOrEqual(peak, 4_000_000)
        XCTAssertNil(IFrameBandwidth.positionBound(positions: [0, 1], fileSize: 0, durations: [1, 1], targetDuration: 1))
    }

    func testTheSampledMeanIsBytesOverTheSampledEntriesTime() {
        XCTAssertEqual(IFrameBandwidth.sampledAverage([1: 125_000, 3: 250_000], durations: [1, 1, 2, 1]), 1_500_000)
        XCTAssertNil(IFrameBandwidth.sampledAverage([:], durations: [1]))
    }

    // MARK: - Delivery

    /// Authoring spec 10.1: a gzip body that inflates back to the playlist with a matching CRC-32 and size.
    func testPlaylistsGoOutAsGzip() throws {
        let playlist = Data(String(repeating: "#EXTINF:1.001000,\nkf0.m4s\n", count: 200).utf8)
        let packed = try XCTUnwrap(LocalHTTPServer.gzip(playlist))
        XCTAssertEqual(Array(packed.prefix(3)), [0x1F, 0x8B, 8])
        XCTAssertLessThan(packed.count, playlist.count / 4)
        let deflated = packed.subdata(in: 10..<(packed.count - 8))
        var inflated = Data(count: playlist.count)
        let n = inflated.withUnsafeMutableBytes { out in
            deflated.withUnsafeBytes { input in
                compression_decode_buffer(out.bindMemory(to: UInt8.self).baseAddress!, playlist.count,
                                          input.bindMemory(to: UInt8.self).baseAddress!, deflated.count, nil, COMPRESSION_ZLIB)
            }
        }
        XCTAssertEqual(inflated.prefix(n), playlist)
        let trailer = Array(packed.suffix(8))
        let size = trailer[4...].enumerated().reduce(0) { $0 | Int($1.element) << (8 * $1.offset) }
        XCTAssertEqual(size, playlist.count)
        let crc = trailer[..<4].enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << (8 * UInt32($1.offset)) }
        // CRC-32 of "123456789" is CBF43926; checked on the same helper's arithmetic over the playlist.
        let check = playlist.withUnsafeBytes { av_crc(av_crc_get_table(AV_CRC_32_IEEE_LE), UInt32.max, $0.bindMemory(to: UInt8.self).baseAddress, playlist.count) ^ UInt32.max }
        XCTAssertEqual(crc, check)
        let known = Data("123456789".utf8).withUnsafeBytes { av_crc(av_crc_get_table(AV_CRC_32_IEEE_LE), UInt32.max, $0.bindMemory(to: UInt8.self).baseAddress, 9) ^ UInt32.max }
        XCTAssertEqual(known, 0xCBF4_3926)
    }

    /// I-frame requests never queue behind a chapter frame's decode: each has its own grabber.
    func testIFrameGrabsHaveAGrabberOfTheirOwn() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60))
        defer { session.stop() }
        session.stateLock.lock()
        defer { session.stateLock.unlock() }
        XCTAssertFalse(session.iframeGrabberLocked() === session.frameGrabberLocked())
        XCTAssertTrue(session.iframeGrabberLocked() === session.iframeGrabberLocked())
    }

    /// The I-frame playlist needs no grab, so it is answered at once.
    func testTheIFramePlaylistIsAnsweredWithoutAGrab() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 60))
        defer { session.stop() }
        session.stateLock.lock()
        session.iframeTranscodes = false
        session.sessionAnchorSeconds = 0
        session.stateLock.unlock()
        let started = Date()
        guard case .data(let body, _) = session.iframePlaylistResponse() else { return XCTFail("no I-frame playlist") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 1)
        XCTAssertTrue(String(decoding: body, as: UTF8.self).contains("kf0.m4s"))
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
        session.sessionAnchorSeconds = 0
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
        var size = "320x180"
        /// PQ: the rendition is the tone-mapped SDR encode, not the copied keyframe.
        var hdr = false
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
        "hevc10-pq-mkv": Fixture(name: "hevc10-pq", extension_: "mkv",
                                 args: ["-pix_fmt", "yuv420p10le", "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
                                        "-c:v", "libx265", "-preset", "ultrafast",
                                        "-x265-params", "keyint=48:min-keyint=48:scenecut=0:bframes=2:log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
                                        "-c:a", "aac"],
                                 codecs: "hvc1.2.4.L120.90,mp4a.40.2", spacing: 2, exact: true, size: "2560x1440", hdr: true),
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
                       "-f", "lavfi", "-i", "testsrc2=size=\(fixture.size):rate=24", "-f", "lavfi", "-i", "sine=frequency=440",
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

    private func runSession(_ key: String, itemId: String = "", check: (RemuxSession, UInt16) throws -> Void) throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let fixture = try XCTUnwrap(Self.fixtures[key])
        let source = try XCTUnwrap(Self.file(key), "ffmpeg produced no \(key) fixture")
        let origin = LocalHTTPServer { _ in .file(source, contentType: "application/octet-stream") }
        let originPort = try origin.start()
        defer { origin.stop() }
        var config = makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(originPort)/source.\(fixture.extension_)",
                                codecs: fixture.codecs, width: 320, height: 180, frameRate: 24, bandwidth: 600_000)
        config.itemId = itemId
        let session = try RemuxSession(config: config)
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

    /// Every entry, fetched and decoded alone the way a player does: one keyframe at the entry's start
    /// that is the source's keyframe there (indexed) or the last one at or before it (grid).
    private func assertEveryEntryDecodes(_ key: String) throws {
        let fixture = try XCTUnwrap(Self.fixtures[key])
        try runSession(key) { _, port in
            let rendition = try IFrameOracle.rendition(master: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/master.m3u8")))
            let source = try XCTUnwrap(IFrameOracle.decode(try XCTUnwrap(Self.file(key)).path), "the source does not decode").frames
            let keys = source.filter(\.key)
            let anchor = try XCTUnwrap(keys.first).seconds
            let starts = rendition.entries.map(\.start)
            if fixture.exact {
                let expected = keys.map { $0.seconds - anchor }.filter { $0 < Self.seconds }
                XCTAssertEqual(starts.count, expected.count, "entries at \(starts), source keyframes at \(expected)")
                for (start, keyframe) in zip(starts, expected) { XCTAssertEqual(start, keyframe, accuracy: 0.002) }
            } else {
                XCTAssertEqual(starts, (0..<Int(Self.seconds / fixture.spacing)).map { Double($0) * fixture.spacing })
            }
            // The master's CODECS and BANDWIDTH describe what the entries carry.
            let codecs = try XCTUnwrap(IFrameOracle.attribute("CODECS", in: rendition.streamInf))
            XCTAssertEqual(String(codecs.prefix(4)), IFrameOracle.sampleEntry(rendition.initSegment), rendition.streamInf)
            let bandwidth = Double(try XCTUnwrap(IFrameOracle.attribute("BANDWIDTH", in: rendition.streamInf).flatMap(Int.init)))
            let average = Double(try XCTUnwrap(IFrameOracle.attribute("AVERAGE-BANDWIDTH", in: rendition.streamInf).flatMap(Int.init)))
            XCTAssertLessThanOrEqual(average, bandwidth, rendition.streamInf)
            XCTAssertEqual(IFrameOracle.attribute("VIDEO-RANGE", in: rendition.streamInf), "SDR")
            for (k, entry) in rendition.entries.enumerated() {
                XCTAssertEqual(entry.status, 200, "entry \(k)")
                XCTAssertLessThanOrEqual(Double(entry.bytes * 8) / entry.duration, bandwidth, "entry \(k)")
                // Spec 7.3: tfdt plus the sample's duration is the next fragment's tfdt; mfhd counts the entries.
                let timing = try XCTUnwrap(entry.timing, "entry \(k) has no tfdt/duration/mfhd")
                XCTAssertEqual(timing.sequence, UInt32(k + 1), "entry \(k)")
                if k + 1 < rendition.entries.count, let next = rendition.entries[k + 1].timing {
                    XCTAssertEqual(timing.tfdt + timing.duration, next.tfdt, accuracy: 0.001, "entry \(k)")
                }
                XCTAssertEqual(entry.packets, 1, "entry \(k) holds one sample")
                guard entry.frames.count == 1, let picture = entry.frames.first else {
                    XCTFail("entry \(k) decodes to \(entry.frames.count) pictures")
                    continue
                }
                XCTAssertTrue(picture.key, "entry \(k)")
                XCTAssertEqual(picture.seconds, entry.start, accuracy: 0.5 / 24, "entry \(k) plays at its start")
                // Tone-mapped luma is not the PQ source's, so an HDR entry is held to its time alone.
                guard !fixture.hdr else { continue }
                let match = try XCTUnwrap(source.min { $0.distance(to: picture) < $1.distance(to: picture) })
                let at = entry.start + anchor
                let expected = fixture.exact ? at : try XCTUnwrap(keys.last { $0.seconds <= at + 0.002 }).seconds
                XCTAssertEqual(match.seconds, expected, accuracy: 0.002, "entry \(k) at \(at) shows the source's frame at \(match.seconds)")
                if !fixture.codecs.isEmpty, !fixture.hdr { XCTAssertEqual(match.distance(to: picture), 0, "entry \(k) is the copied keyframe") }
            }
            guard fixture.hdr else { return }
            // Authoring spec 6.16: the HDR source scrubs on SDR H.264 inside 1920x1080, its init tagged BT.709.
            XCTAssertEqual(IFrameOracle.attribute("CODECS", in: rendition.streamInf), "avc1.640028")
            XCTAssertEqual(IFrameOracle.attribute("RESOLUTION", in: rendition.streamInf), "1920x1080")
            let colr = try XCTUnwrap(rendition.initSegment.range(of: Data("colrnclx".utf8)), "no colr nclx in the encoded init")
            XCTAssertEqual(Array(rendition.initSegment[colr.upperBound..<(colr.upperBound + 6)]), [0, 1, 0, 1, 0, 1], "BT.709 primaries, transfer, matrix")
        }
    }

    func testAnHdrSourceScrubsOnToneMappedSdrFrames() throws { try assertEveryEntryDecodes("hevc10-pq-mkv") }

    func testH264EveryEntryDecodesToItsKeyframe() throws { try assertEveryEntryDecodes("h264-mkv") }
    func testHevcEveryEntryDecodesToItsKeyframe() throws { try assertEveryEntryDecodes("hevc-mkv") }
    func testMpegTsEveryEntryDecodesOnTheGrid() throws { try assertEveryEntryDecodes("h264-ts") }
    func testTranscodedAviEveryEntryDecodesToItsKeyframe() throws { try assertEveryEntryDecodes("mpeg4-avi") }
    func testTranscodedMpegTsEveryEntryDecodesOnTheGrid() throws { try assertEveryEntryDecodes("mpeg2-ts") }
}
