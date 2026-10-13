import Foundation
import Libavcodec
import Libavutil
import XCTest

@testable import TomoEngine

/// A session configured with an input and nothing else: the engine reads the variant's attributes,
/// the tracks, the subtitles and the length off the file it opens.
final class SelfDescribedSessionTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/self-described-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// 13 s: video 0, aac 1 (eng), ac3 2 (spa, default), srt 3 (eng, default, "ONE"), srt 4 (eng, forced, "TWO").
    private func fixture() -> URL? {
        let out = Self.fixtureDir.appendingPathComponent("default-second-audio-13s.mkv")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        var args = ["-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=13",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=13:sample_rate=48000",
                    "-f", "lavfi", "-i", "sine=frequency=660:duration=13:sample_rate=48000"]
        for (i, text) in ["ONE", "TWO"].enumerated() {
            let srt = Self.fixtureDir.appendingPathComponent("cue-\(i).srt")
            try? "1\n00:00:00,500 --> 00:00:02,500\n\(text)\n".write(to: srt, atomically: true, encoding: .utf8)
            args += ["-i", srt.path]
        }
        args += ["-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-map", "4:s",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25",
                 "-c:a:0", "aac", "-c:a:1", "ac3", "-c:s", "subrip",
                 "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=spa",
                 "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=eng",
                 "-disposition:a:0", "0", "-disposition:a:1", "default",
                 "-disposition:s:0", "default", "-disposition:s:1", "forced",
                 out.path]
        let process = Process()
        process.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        process.arguments = args
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        process.waitUntilExit()
        guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: out.path) else {
            try? FileManager.default.removeItem(at: out)
            return nil
        }
        return out
    }

    private func selfDescribed(_ url: URL) -> RemuxConfig {
        var config = makeConfig(durationSeconds: 0, inputUrl: url.path, videoRange: "", codecs: "", width: 0, height: 0,
                                frameRate: 0, bandwidth: 0, readAheadSegments: 8)
        config.describesInput = true
        return config
    }

    func testAFileNamesItsOwnVariantTracksAndLength() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg), let source = fixture() else {
            throw XCTSkip("could not generate the fixture")
        }
        let session = try RemuxSession(config: selfDescribed(source))
        session.start()
        defer { session.stop() }
        let master = session.masterPlaylist()

        XCTAssertFalse(session.hasFailed)
        XCTAssertEqual(session.durationSeconds, 13, accuracy: 0.2)
        XCTAssertEqual(session.segmentCount, 2)
        XCTAssertTrue(master.contains("RESOLUTION=320x240"), master)
        XCTAssertTrue(master.contains("FRAME-RATE=25"), master)
        XCTAssertTrue(master.contains("VIDEO-RANGE=SDR"), master)
        XCTAssertTrue(master.contains("CODECS=\"avc1."), master)
        XCTAssertTrue(master.contains("mp4a.40.2"), master)
        XCTAssertTrue(master.contains("ac-3"), master)
        XCTAssertFalse(master.contains("BANDWIDTH=20000000"), master)
        // The track the file flags default leads, whatever its position in the container.
        XCTAssertTrue(master.contains("TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"spa\",LANGUAGE=\"spa\",DEFAULT=YES"), master)
        XCTAssertTrue(master.contains("TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"eng\",LANGUAGE=\"eng\",DEFAULT=NO"), master)
        XCTAssertEqual(session.rendition(withPrefix: "a0")?.inputStreams, [2])
        XCTAssertEqual(session.rendition(withPrefix: "a1")?.inputStreams, [1])

        let subtitles = session.publishedSubtitles(waitSeconds: 0)
        XCTAssertEqual(subtitles.map(\.index), [3, 4])
        XCTAssertEqual(subtitles.map(\.isEngineText), [true, true])
        XCTAssertEqual(subtitles.map(\.isDefault), [true, false])
        XCTAssertEqual(subtitles.map(\.isForced), [false, true])
        XCTAssertTrue(master.contains("URI=\"sub3.m3u8\""), master)
        XCTAssertTrue(master.contains("URI=\"sub4.m3u8\""), master)
        XCTAssertTrue(session.subtitleSegment(streamIndex: 3, segment: 0)?.contains("ONE") ?? false)
        XCTAssertTrue(session.subtitleSegment(streamIndex: 4, segment: 0)?.contains("TWO") ?? false)

        let media = session.mediaPlaylist()
        XCTAssertEqual(media.components(separatedBy: "#EXTINF:").count - 1, 2, media)
        XCTAssertTrue(media.contains("#EXTINF:6.000000"), media)
    }

    /// Without the flag an empty track list carries one audio stream and no subtitles, as before.
    func testAnUndescribedSessionKeepsItsConfiguredShape() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg), let source = fixture() else {
            throw XCTSkip("could not generate the fixture")
        }
        let config = makeConfig(durationSeconds: 13, inputUrl: source.path, width: 320, height: 240, frameRate: 25, readAheadSegments: 8)
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let master = session.masterPlaylist()

        XCTAssertFalse(session.hasFailed)
        XCTAssertFalse(master.contains("TYPE=AUDIO"), master)
        XCTAssertFalse(master.contains("TYPE=SUBTITLES"), master)
        XCTAssertNil(session.rendition(withPrefix: "a0"))
    }

    /// A file that names its provider holds one of that provider's connections while its input is open.
    func testAFileNamingItsProviderHoldsALeaseUntilItStops() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg), let source = fixture() else {
            throw XCTSkip("could not generate the fixture")
        }
        let key = "file-origin-\(UUID().uuidString)"
        var config = selfDescribed(source)
        config.liveOriginKey = key
        let session = try RemuxSession(config: config)
        session.start()
        _ = session.masterPlaylist()
        XCTAssertFalse(session.hasFailed)
        XCTAssertEqual(LiveConnectionBroker.shared.activeCount(for: key), 1)

        session.stop()
        let released = session.waitUntil(deadline: 10) { LiveConnectionBroker.shared.activeCount(for: key) == 0 }
        XCTAssertTrue(released, "the lease outlived the session")
    }

    /// Without a provider key a file takes no lease, as before.
    func testAFileWithoutAProviderKeyTakesNoLease() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg), let source = fixture() else {
            throw XCTSkip("could not generate the fixture")
        }
        let session = try RemuxSession(config: selfDescribed(source))
        session.start()
        defer { session.stop() }
        _ = session.masterPlaylist()
        XCTAssertEqual(LiveConnectionBroker.shared.activeCount(for: "-"), 0)
    }

    /// A provider allowing one connection: the input holds it, so the master names no I-frame rendition
    /// and a chapter frame opens nothing.
    func testOnAFullBudgetTheSessionOpensNoReadBesideItsInput() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg), let source = fixture() else {
            throw XCTSkip("could not generate the fixture")
        }
        let key = "one-connection-\(UUID().uuidString)"
        LiveConnectionBroker.shared.setBudget(1, for: key)
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        var config = selfDescribed(source)
        config.liveOriginKey = key
        let session = try RemuxSession(config: config)
        session.start()
        defer { session.stop() }
        let master = session.masterPlaylist()

        XCTAssertFalse(session.hasFailed)
        XCTAssertTrue(master.contains("RESOLUTION=320x240"), master)
        XCTAssertFalse(master.contains("#EXT-X-I-FRAME-STREAM-INF"), master)
        XCTAssertNil(session.chapterFrame(atMilliseconds: 1000))
        XCTAssertEqual(LiveConnectionBroker.shared.activeCount(for: key), 1)
    }

    /// With a connection spare the same session names the rendition, and its chapter grabber holds
    /// the second connection until the session stops.
    func testOnASpareConnectionTheSessionsSideReadsTakeLeases() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg), let source = fixture() else {
            throw XCTSkip("could not generate the fixture")
        }
        let key = "two-connections-\(UUID().uuidString)"
        LiveConnectionBroker.shared.setBudget(2, for: key)
        defer { LiveConnectionBroker.shared.setBudget(0, for: key) }
        var config = selfDescribed(source)
        config.liveOriginKey = key
        let session = try RemuxSession(config: config)
        session.start()
        let master = session.masterPlaylist()

        XCTAssertTrue(master.contains("#EXT-X-I-FRAME-STREAM-INF"), master)
        XCTAssertEqual(LiveConnectionBroker.shared.activeCount(for: key), 1)
        XCTAssertNotNil(session.chapterFrame(atMilliseconds: 1000))
        XCTAssertEqual(LiveConnectionBroker.shared.activeCount(for: key), 2)

        session.stop()
        let released = session.waitUntil(deadline: 10) { LiveConnectionBroker.shared.activeCount(for: key) == 0 }
        XCTAssertTrue(released, "a lease outlived the session")
    }

    func testVideoRangeFollowsTheTransferAndTheDolbyVisionBaseLayer() {
        var record = AVDOVIDecoderConfigurationRecord()
        record.rpu_present_flag = 1
        record.dv_profile = 5
        XCTAssertEqual(RemuxSession.videoRange(transfer: AVCOL_TRC_BT709, dolbyVision: nil), "SDR")
        XCTAssertEqual(RemuxSession.videoRange(transfer: AVCOL_TRC_SMPTE2084, dolbyVision: nil), "PQ")
        XCTAssertEqual(RemuxSession.videoRange(transfer: AVCOL_TRC_ARIB_STD_B67, dolbyVision: nil), "HLG")
        XCTAssertEqual(RemuxSession.videoRange(transfer: AVCOL_TRC_UNSPECIFIED, dolbyVision: record), "PQ")
        record.dv_bl_signal_compatibility_id = 4
        XCTAssertEqual(RemuxSession.videoRange(transfer: AVCOL_TRC_UNSPECIFIED, dolbyVision: record), "HLG")
    }

    /// The cases of src/__tests__ for dolbyVisionSupplementalCodecs, on the record itself.
    func testSupplementalCodecsMatchTheTagRule() {
        func record(profile: UInt8, level: UInt8 = 6, rpu: UInt8 = 1, el: UInt8 = 0, compatibility: UInt8) -> AVDOVIDecoderConfigurationRecord {
            var record = AVDOVIDecoderConfigurationRecord()
            record.dv_profile = profile
            record.dv_level = level
            record.rpu_present_flag = rpu
            record.el_present_flag = el
            record.dv_bl_signal_compatibility_id = compatibility
            return record
        }
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(nil), "")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 8, compatibility: 1)), "dvh1.08.06/db1p")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 8, level: 9, compatibility: 4)), "dvh1.08.09/db4h")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 8, level: 0, compatibility: 1)), "dvh1.08.06/db1p")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 7, el: 1, compatibility: 6)), "dvh1.08.06/db1p")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 5, compatibility: 0)), "")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 8, compatibility: 2)), "")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 8, el: 1, compatibility: 1)), "")
        XCTAssertEqual(RemuxSession.dolbyVisionSupplementalCodecs(record(profile: 8, rpu: 0, compatibility: 1)), "")
    }

    func testALanguagesFullTrackLeadsItsSdhAndForcedOnes() {
        func track(_ index: Int, _ language: String, forced: Bool = false, sdh: Bool = false) -> RemuxSubtitle {
            var track = RemuxSubtitle(index: index, name: "Track \(index)", language: language, vttUrl: "", localVtt: "",
                                      isDefault: false, isForced: forced, isImage: false, isEngineText: true)
            track.isHearingImpaired = sdh
            return track
        }
        let ordered = RemuxSession.generalFirst([
            track(2, "eng", forced: true), track(3, "spa"), track(4, "eng", sdh: true), track(5, "eng"), track(6, ""), track(7, "ENG"),
        ])
        XCTAssertEqual(ordered.map(\.index), [5, 3, 7, 4, 6, 2])
    }
}
