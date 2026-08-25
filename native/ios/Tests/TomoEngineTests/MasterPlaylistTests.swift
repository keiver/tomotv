import XCTest

@testable import TomoEngine

/// The master playlist is the engine's contract with AVFoundation. Most rules
/// here cost the WHOLE file when broken, not just the track they describe:
/// a malformed EXT-X-MEDIA makes AVFoundation reject the master with -12642.
final class MasterPlaylistTests: XCTestCase {
    private func playlist(
        audio: [RemuxAudioTrack] = [],
        subs: [RemuxSubtitle] = [],
        videoRange: String = "SDR",
        codecs: String = "avc1.640028",
        supplementalCodecs: String = "",
        bandwidth: Int = 8_000_000,
        frameRate: Double = 23.976,
        width: Int = 1920,
        height: Int = 1080
    ) throws -> String {
        let s = try RemuxSession(
            config: makeConfig(
                durationSeconds: 30,
                audioTracks: audio,
                subtitles: subs,
                videoRange: videoRange,
                codecs: codecs,
                supplementalCodecs: supplementalCodecs,
                width: width,
                height: height,
                frameRate: frameRate,
                bandwidth: bandwidth
            ))
        defer { s.stop() }
        return s.masterPlaylist()
    }

    private func sub(
        _ index: Int, language: String = "eng", isDefault: Bool = false, isForced: Bool = false,
        localVtt: String = ""
    )
        -> RemuxSubtitle
    {
        RemuxSubtitle(
            index: index, name: "Track \(index)", language: language,
            vttUrl: localVtt.isEmpty ? "http://x/\(index).vtt" : "", localVtt: localVtt,
            isDefault: isDefault, isForced: isForced, isImage: false)
    }

    private func audio(_ index: Int, language: String = "eng") -> RemuxAudioTrack {
        RemuxAudioTrack(index: index, name: "Audio \(index)", language: language, serverAudioUrl: "")
    }

    /// Measured on a device 2026-08-13 (T05): a FORCED=YES rendition is withheld
    /// from AVKit's picker AND never applied, so the viewer loses the track.
    func testForcedSubtitleIsNeverEmittedAsForced() throws {
        let out = try playlist(subs: [sub(2, isForced: true)])
        XCTAssertFalse(out.contains("FORCED=YES"))
        XCTAssertTrue(out.contains("FORCED=NO"))
        // The intent rides AUTOSELECT instead: it presents itself unasked.
        XCTAssertTrue(out.contains("AUTOSELECT=YES"))
    }

    /// RFC 8216: DEFAULT=YES requires AUTOSELECT=YES. The pair inverted makes
    /// AVFoundation reject the entire master playlist with a bare -12642.
    func testDefaultYesIsNeverPairedWithAutoselectNo() throws {
        let out = try playlist(
            audio: [audio(1), audio(2)],
            subs: [sub(3, isDefault: true), sub(4), sub(5, isForced: true)])
        for line in out.split(separator: "\n") where line.hasPrefix("#EXT-X-MEDIA") {
            if line.contains("DEFAULT=YES") {
                XCTAssertTrue(line.contains("AUTOSELECT=YES"), "illegal pairing: \(line)")
            }
        }
    }

    /// Matroska happily flags several subtitle tracks default at once. Emitting
    /// them all costs the whole file, so the first wins and the rest demote.
    func testOnlyOneSubtitleRenditionIsDefault() throws {
        let out = try playlist(subs: [sub(1, isDefault: true), sub(2, isDefault: true), sub(3, isDefault: true)])
        let defaults = out.split(separator: "\n")
            .filter { $0.hasPrefix("#EXT-X-MEDIA:TYPE=SUBTITLES") && $0.contains("DEFAULT=YES") }
        XCTAssertEqual(defaults.count, 1)
    }

    /// Apple's authoring spec requires LANGUAGE on every non-video EXT-X-MEDIA.
    /// "und" is the BCP 47 subtag for an untagged track.
    func testUntaggedTracksDeclareUnd() throws {
        let out = try playlist(audio: [audio(1, language: ""), audio(2)], subs: [sub(3, language: "")])
        XCTAssertTrue(out.contains("LANGUAGE=\"und\""))
    }

    /// A lone audio track is muxed into the variant; the group shape only
    /// appears with several tracks (or a Slipstream tier, covered on device).
    func testAudioGroupAppearsOnlyWithSeveralTracks() throws {
        XCTAssertFalse(try playlist(audio: [audio(1)]).contains("GROUP-ID=\"audio\""))
        let many = try playlist(audio: [audio(1), audio(2)])
        XCTAssertTrue(many.contains("GROUP-ID=\"audio\""))
        XCTAssertTrue(many.contains(",AUDIO=\"audio\""))
    }

    /// BANDWIDTH is the one REQUIRED attribute of EXT-X-STREAM-INF, so an
    /// unknown bit rate falls back rather than disappearing.
    func testBandwidthAlwaysPresentAndFallsBack() throws {
        XCTAssertTrue(try playlist(bandwidth: 0).contains("BANDWIDTH=20000000"))
        XCTAssertTrue(try playlist(bandwidth: 3_000_000).contains("BANDWIDTH=3000000"))
    }

    /// With the attribute absent AVFoundation offers an empty legible option
    /// that AVKit lists as "CC" and that draws nothing (measured on T88).
    func testClosedCaptionsAreDeclaredNone() throws {
        XCTAssertTrue(try playlist().contains("CLOSED-CAPTIONS=NONE"))
    }

    /// AVFoundation hard-fails PQ content in a variant that does not declare it
    /// (-12927). Audio-only sessions pass an empty range and omit the attribute.
    func testVideoRangeIsDeclaredWhenPresentAndOmittedWhenEmpty() throws {
        XCTAssertTrue(try playlist(videoRange: "PQ").contains("VIDEO-RANGE=PQ"))
        XCTAssertFalse(try playlist(videoRange: "").contains("VIDEO-RANGE"))
    }

    /// Trailing zeros trimmed so 24.0 reads as 24 and 23.976 survives.
    func testFrameRateTrimsTrailingZeros() throws {
        XCTAssertTrue(try playlist(frameRate: 24.0).contains("FRAME-RATE=24,"))
        XCTAssertTrue(try playlist(frameRate: 23.976).contains("FRAME-RATE=23.976,"))
    }

    func testResolutionOmittedWhenUnknown() throws {
        XCTAssertFalse(try playlist(width: 0, height: 0).contains("RESOLUTION="))
        XCTAssertTrue(try playlist().contains("RESOLUTION=1920x1080"))
    }

    /// Dolby Vision profile 8.1/8.4 rides alongside CODECS, never replacing it:
    /// the base layer is real HDR10, so a player that ignores the attribute
    /// keeps playing exactly what it plays today.
    func testDolbyVisionRidesAlongsideCodecsWithoutReplacingThem() throws {
        let out = try playlist(videoRange: "PQ", codecs: "hvc1.2.4.L150.B0,ec-3", supplementalCodecs: "dvh1.08.06/db1p")
        XCTAssertTrue(out.contains("CODECS=\"hvc1.2.4.L150.B0,ec-3\""))
        XCTAssertTrue(out.contains("SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\""))
        XCTAssertTrue(out.contains("VIDEO-RANGE=PQ"))
    }

    func testSupplementalCodecsIsOmittedWhenAbsent() throws {
        XCTAssertFalse(try playlist().contains("SUPPLEMENTAL-CODECS"))
    }

    /// It names the same rendition's optional decode, so it cannot appear
    /// without the CODECS it supplements.
    func testSupplementalCodecsNeverAppearsWithoutCodecs() throws {
        let out = try playlist(codecs: "", supplementalCodecs: "dvh1.08.06/db1p")
        XCTAssertFalse(out.contains("SUPPLEMENTAL-CODECS"))
    }

    private func subtitlePlaylist(_ sub: RemuxSubtitle) throws -> String {
        let s = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [sub]))
        defer { s.stop() }
        return try XCTUnwrap(s.subtitlePlaylist(streamIndex: sub.index))
    }

    /// A streamed track is fetched from Jellyfin, which keeps subtitle bytes off this server.
    func testStreamedTextTrackPointsAtTheServer() throws {
        XCTAssertTrue(try subtitlePlaylist(sub(3)).contains("http://x/3.vtt"))
    }

    /// A downloaded track resolves to our own loopback path instead. AVFoundation will not
    /// follow a file:// segment out of an http playlist: it fails the asset with -12881,
    /// which took the whole video down, not just the subtitle.
    func testDownloadedTextTrackResolvesToTheLoopback() throws {
        let out = try subtitlePlaylist(sub(3, localVtt: "file:///downloads/a/sub.3.vtt"))
        XCTAssertTrue(out.contains("sub3.vtt"))
        XCTAssertFalse(out.contains("file://"))
        XCTAssertFalse(out.contains("http://x/"))
    }
}
