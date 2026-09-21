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
        localVtt: String = "", isEngineText: Bool = false
    )
        -> RemuxSubtitle
    {
        RemuxSubtitle(
            index: index, name: "Track \(index)", language: language,
            vttUrl: localVtt.isEmpty ? "http://x/\(index).vtt" : "", localVtt: localVtt,
            isDefault: isDefault, isForced: isForced, isImage: false, isEngineText: isEngineText)
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

    private func gateway(audio: [RemuxAudioTrack], videoRange: String = "SDR", link: Double = 30_000_000) throws -> RemuxSession {
        var config = makeConfig(
            durationSeconds: 18, audioTracks: audio, videoRange: videoRange,
            codecs: "hvc1.2.4.L150.B0,ec-3", supplementalCodecs: videoRange == "PQ" ? "dvh1.08.06/db1p" : "",
            bandwidth: 6_640_000,
            tiers: [
                TierConfig(playlistUrl: "http://tier.test/t0.m3u8", bandwidth: 260_000, codecs: "avc1.64000C,mp4a.40.2", width: 256, height: 144),
                TierConfig(playlistUrl: "http://tier.test/t1.m3u8", bandwidth: 1_620_000, codecs: "avc1.64001F,mp4a.40.2", width: 854, height: 480),
            ])
        config.primaryVideoCodecs = "hvc1.2.4.L150.B0"
        config.primaryVideoBandwidth = 6_000_000
        let session = try RemuxSession(config: config)
        session.gridResolved = true
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.sourceReady = true
        session.sourceState = .ready
        session.copyVerdict = .listed
        session.testLinkBps = link
        session.linkProbeResolved = true
        session.openingRung = 0
        return session
    }

    private func serverAudio(_ index: Int, name: String = "English", usesServerAudio: Bool = false) -> RemuxAudioTrack {
        var track = RemuxAudioTrack(index: index, name: name, language: "eng", serverAudioUrl: "http://tier.test/audio\(index).m3u8")
        track.serverAudioChannels = 2
        track.usesServerAudio = usesServerAudio
        track.codecs = usesServerAudio ? "mp4a.40.2" : "ec-3"
        track.bandwidth = usesServerAudio ? 120_000 : 640_000
        track.identity = "source:\(index)"
        return track
    }

    private func variants(_ master: String, uri: String) -> [String] {
        let lines = master.components(separatedBy: "\n")
        return lines.indices.filter { $0 > 0 && lines[$0] == uri }.map { lines[$0 - 1] }
    }

    func testOriginalVideoHasBothAudioAssociationsAndEachRungAppearsOnce() throws {
        let session = try gateway(audio: [serverAudio(1)])
        defer { session.stop() }
        let master = session.masterPlaylist()
        let originals = variants(master, uri: "media.m3u8")
        XCTAssertEqual(originals.count, 2)
        XCTAssertTrue(originals[0].contains("AUDIO=\"audio\""))
        XCTAssertTrue(originals[0].contains("CODECS=\"hvc1.2.4.L150.B0,ec-3\""))
        XCTAssertTrue(originals[0].contains("BANDWIDTH=6640000,"))
        XCTAssertTrue(originals[1].contains("AUDIO=\"audio-lo\""))
        XCTAssertTrue(originals[1].contains("CODECS=\"hvc1.2.4.L150.B0,mp4a.40.2\""))
        XCTAssertTrue(originals[1].contains("BANDWIDTH=6120000,"))
        XCTAssertTrue(originals[1].contains("AVERAGE-BANDWIDTH=6120000,"))
        for uri in ["t0.m3u8", "t1.m3u8"] {
            let entries = variants(master, uri: uri)
            XCTAssertEqual(entries.count, 1)
            XCTAssertTrue(entries.first?.contains("AUDIO=\"audio-lo\"") == true)
            XCTAssertFalse(entries.first?.contains("ec-3") == true)
        }
    }

    func testHdrMetadataStaysOnBothOriginalEntriesAndNotTheSdrRungs() throws {
        for range in ["PQ", "HLG"] {
            let session = try gateway(audio: [serverAudio(1)], videoRange: range)
            defer { session.stop() }
            let master = session.masterPlaylist()
            for original in variants(master, uri: "media.m3u8") {
                XCTAssertTrue(original.contains("VIDEO-RANGE=\(range)"))
                XCTAssertTrue(original.contains("RESOLUTION=1920x1080"))
                XCTAssertTrue(original.contains("FRAME-RATE=23.976"))
                XCTAssertEqual(original.contains("SUPPLEMENTAL-CODECS=\"dvh1.08.06/db1p\""), range == "PQ")
            }
            for uri in ["t0.m3u8", "t1.m3u8"] {
                let rung = try XCTUnwrap(variants(master, uri: uri).first)
                XCTAssertTrue(rung.contains("VIDEO-RANGE=SDR"))
                XCTAssertFalse(rung.contains("SUPPLEMENTAL-CODECS"))
                XCTAssertFalse(rung.contains("hvc1"))
            }
        }
    }

    func testServerBackedTrackKeepsItsCataloguePositionInBothGroups() throws {
        let session = try gateway(audio: [serverAudio(1), serverAudio(4, usesServerAudio: true), serverAudio(7)])
        defer { session.stop() }
        let master = session.masterPlaylist()
        let sourceTracks = master.components(separatedBy: "\n").filter { $0.contains("GROUP-ID=\"audio\"") }
        XCTAssertEqual(sourceTracks.count, 3)
        XCTAssertTrue(sourceTracks[0].contains("URI=\"a0.m3u8\""))
        XCTAssertTrue(sourceTracks[1].contains("URI=\"a1s.m3u8\""))
        XCTAssertTrue(sourceTracks[2].contains("URI=\"a2.m3u8\""))
        let serverTracks = master.components(separatedBy: "\n").filter { $0.contains("GROUP-ID=\"audio-lo\"") }
        XCTAssertEqual(serverTracks.count, 3)
        for position in sourceTracks.indices {
            XCTAssertTrue(serverTracks[position].contains("URI=\"a\(position)s.m3u8\""))
            let name = try XCTUnwrap(sourceTracks[position].components(separatedBy: "NAME=\"").last?.components(separatedBy: "\"").first)
            XCTAssertTrue(serverTracks[position].contains("NAME=\"\(name)\""))
        }
        XCTAssertTrue(variants(master, uri: "media.m3u8")[0].contains("CODECS=\"hvc1.2.4.L150.B0,ec-3,mp4a.40.2\""))
    }

    func testSingleServerBackedTrackUsesAnAudioGroupWithoutALadder() throws {
        let master = try playlist(audio: [serverAudio(4, usesServerAudio: true)])
        XCTAssertTrue(master.contains("GROUP-ID=\"audio\""))
        XCTAssertTrue(master.contains("URI=\"a0s.m3u8\""))
        XCTAssertFalse(master.contains("GROUP-ID=\"audio-lo\""))
        XCTAssertEqual(variants(master, uri: "media.m3u8").count, 1)
    }

    func testEncodedAudioCodecAlternativesAreFlattenedWithoutDuplicates() throws {
        var encoded = serverAudio(1)
        encoded.codecs = "fLaC,mp4a.40.2"
        encoded.bandwidth = 4_000_000
        let session = try gateway(audio: [encoded, serverAudio(4, usesServerAudio: true)])
        defer { session.stop() }
        let original = try XCTUnwrap(variants(session.masterPlaylist(), uri: "media.m3u8").first)
        XCTAssertTrue(original.contains("CODECS=\"hvc1.2.4.L150.B0,fLaC,mp4a.40.2\""))
        XCTAssertTrue(original.contains("BANDWIDTH=10000000,"))
    }

    func testNamesAreSafeAndUniqueAfterSanitization() {
        let names = RemuxSession.renditionNames([
            (name: "English\"\r\n", index: 1),
            (name: "English'", index: 2),
            (name: "English' (2)", index: 3),
            (name: "", index: 4),
        ])
        XCTAssertEqual(Set(names).count, names.count)
        XCTAssertTrue(names.allSatisfy { !$0.contains("\"") && !$0.contains("\n") && !$0.contains("\r") })
        XCTAssertEqual(names[0], "English'")
        XCTAssertEqual(names[1], "English' (2)")
        XCTAssertEqual(names[3], "Track 4")
    }

    func testOriginalLeadingMarginDoesNotChangeForTheAacAssociation() throws {
        XCTAssertEqual(RemuxSession.copyLeadsMargin, 3)
        XCTAssertEqual(RemuxSession.openingRungShare, 6)
        for multiplier in [2.9, 3.0] {
            let session = try gateway(audio: [serverAudio(1)], link: 6_640_000 * multiplier)
            defer { session.stop() }
            let firstUri = session.masterPlaylist().components(separatedBy: "\n").first { !$0.isEmpty && !$0.hasPrefix("#") }
            XCTAssertEqual(firstUri, multiplier < 3 ? "t0.m3u8" : "media.m3u8")
        }
    }

    func testRetryWaitingSourceWithoutALadderRemainsListedAndRecoverable() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 18))
        defer { session.stop() }
        session.sourceState = .retryWait
        session.recovering = true
        session.sourceRetryAt = Date().addingTimeInterval(10)
        let master = session.masterPlaylist()
        XCTAssertFalse(session.hasFailed)
        XCTAssertEqual(session.sourceState, .retryWait)
        XCTAssertTrue(session.recovering)
        XCTAssertTrue(session.reportsCopyListed)
        XCTAssertEqual(variants(master, uri: "media.m3u8").count, 1)
        XCTAssertFalse(session.wakeSourceIfAffordable(now: session.sourceRetryAt.addingTimeInterval(-1)))
        XCTAssertTrue(session.wakeSourceIfAffordable(now: session.sourceRetryAt))
    }

    func testRetryWaitingSourceSurvivesADeclinedConfiguredLadder() throws {
        let session = try gateway(audio: [serverAudio(1)])
        defer { session.stop() }
        session.adoptedStarts = []
        session.adoptedDurations = []
        session.sourceState = .retryWait
        session.sourceReady = false
        session.recovering = true
        let master = session.masterPlaylist()
        XCTAssertFalse(session.hasFailed)
        XCTAssertEqual(session.sourceState, .retryWait)
        XCTAssertTrue(session.reportsCopyListed)
        XCTAssertFalse(master.contains("\nt0.m3u8\n"))
        XCTAssertFalse(variants(master, uri: "media.m3u8").isEmpty)
    }

    private func serverOnlyGateway(audio: [RemuxAudioTrack] = []) throws -> RemuxSession {
        var config = makeConfig(
            durationSeconds: 18, audioTracks: audio, codecs: "", bandwidth: 8_000_000,
            tiers: [TierConfig(playlistUrl: "http://tier.test/t0.m3u8", bandwidth: 400_000,
                               codecs: audio.isEmpty ? "avc1.640015" : "avc1.640015,mp4a.40.2", width: 426, height: 240)])
        config.serverVideoOnly = true
        let session = try RemuxSession(config: config)
        session.gridResolved = true
        session.adoptedStarts = [0, 6, 12]
        session.adoptedDurations = [6, 6, 6]
        session.copyVerdict = .withheld
        session.testLinkBps = 1_500_000
        session.linkProbeResolved = true
        session.openingRung = 0
        return session
    }

    func testServerVideoOnlyWithoutAudioDeclaresOnlyVideoRungs() throws {
        let session = try serverOnlyGateway()
        defer { session.stop() }
        let master = session.masterPlaylist()
        let rung = try XCTUnwrap(variants(master, uri: "t0.m3u8").first)
        XCTAssertEqual(session.sourceState, .unavailable)
        XCTAssertFalse(session.hasFailed)
        XCTAssertFalse(session.reportsCopyListed)
        XCTAssertFalse(master.contains("media.m3u8"))
        XCTAssertFalse(master.contains("TYPE=AUDIO"))
        XCTAssertFalse(rung.contains(",AUDIO="))
        XCTAssertTrue(rung.contains("CODECS=\"avc1.640015\""))
        XCTAssertTrue(rung.contains("VIDEO-RANGE=SDR"))
        XCTAssertTrue(rung.contains("CLOSED-CAPTIONS=NONE"))
    }

    func testServerVideoOnlyUsesEveryServerAudioTrackWithoutListingTheOriginal() throws {
        let session = try serverOnlyGateway(audio: [serverAudio(1, usesServerAudio: true), serverAudio(4, usesServerAudio: true)])
        defer { session.stop() }
        let master = session.masterPlaylist()
        XCTAssertFalse(master.contains("media.m3u8"))
        let tracks = master.components(separatedBy: "\n").filter { $0.contains("GROUP-ID=\"audio-lo\"") }
        XCTAssertEqual(tracks.count, 2)
        XCTAssertTrue(tracks[0].contains("URI=\"a0s.m3u8\""))
        XCTAssertTrue(tracks[1].contains("URI=\"a1s.m3u8\""))
        XCTAssertTrue(variants(master, uri: "t0.m3u8").first?.contains("AUDIO=\"audio-lo\"") == true)
    }

    func testUnavailableOriginalIsNotInventedWhenEveryRungIsRetired() throws {
        let session = try serverOnlyGateway()
        defer { session.stop() }
        session.rungsUnavailable.insert(0)
        let master = session.masterPlaylist()
        XCTAssertFalse(master.contains("media.m3u8"))
        XCTAssertFalse(session.reportsCopyListed)
    }
}
