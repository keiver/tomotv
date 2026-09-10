import XCTest

import Libavcodec
import Libavformat

@testable import TomoEngine

/// Text subtitles decoded on device. ASS, SSA, SubRip and mov_text all reach
/// FFmpeg as ASS dialogue, so one converter serves every text format.
final class TextSubtitleTests: XCTestCase {

    /// H.264 plus ASS (eng), SSA v4.00 (spa) and SubRip (fra). See Tests/Fixtures/README.md.
    private var matroska: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/text-subtitles.mkv")
    }

    private var mp4: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/text-subtitles.mp4")
    }

    // MARK: - Decoding out of a container

    /// Opens the fixture and harvests one subtitle stream the way the read loop does.
    private func cues(of url: URL, streamIndex: Int32) throws -> [TextSubtitleCue] {
        var input: UnsafeMutablePointer<AVFormatContext>? = nil
        XCTAssertGreaterThanOrEqual(avformat_open_input(&input, url.path, nil, nil), 0, "open \(url.lastPathComponent)")
        defer { avformat_close_input(&input) }
        XCTAssertGreaterThanOrEqual(avformat_find_stream_info(input, nil), 0)
        guard let input, let stream = input.pointee.streams[Int(streamIndex)] else {
            XCTFail("no stream \(streamIndex)")
            return []
        }
        guard let decoder = TextSubtitleDecoder(stream: stream) else {
            XCTFail("no decoder for stream \(streamIndex)")
            return []
        }

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        while av_read_frame(input, packet) >= 0 {
            if packet?.pointee.stream_index == streamIndex, let packet { decoder.handle(packet: packet) }
            av_packet_unref(packet)
        }
        decoder.finish()
        return decoder.cues(from: 0, to: 1000)
    }

    func testMatroskaCarriesAssAndSsaOnTheSameCodec() throws {
        var input: UnsafeMutablePointer<AVFormatContext>? = nil
        XCTAssertGreaterThanOrEqual(avformat_open_input(&input, matroska.path, nil, nil), 0)
        defer { avformat_close_input(&input) }
        XCTAssertGreaterThanOrEqual(avformat_find_stream_info(input, nil), 0)
        guard let input else { return XCTFail("no input") }

        XCTAssertEqual(input.pointee.streams[1]?.pointee.codecpar.pointee.codec_id, AV_CODEC_ID_ASS)
        XCTAssertEqual(input.pointee.streams[2]?.pointee.codecpar.pointee.codec_id, AV_CODEC_ID_ASS)
        XCTAssertEqual(input.pointee.streams[3]?.pointee.codecpar.pointee.codec_id, AV_CODEC_ID_SUBRIP)
        // The script header the style table is read from rides in extradata.
        XCTAssertGreaterThan(input.pointee.streams[1]?.pointee.codecpar.pointee.extradata_size ?? 0, 0)
    }

    func testAssTrackDecodesEveryCueWithItsTiming() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues.count, 10)
        XCTAssertEqual(cues[0].start, 1.0, accuracy: 0.01)
        XCTAssertEqual(cues[0].end, 3.0, accuracy: 0.01)
        XCTAssertEqual(cues[0].text, "Plain line, with a comma.")
        // A comma in the text is not a field separator.
        XCTAssertTrue(cues[0].text.hasSuffix("comma."))
    }

    func testAssInlineOverridesBecomeWebVTTTags() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[1].text, "<i>Italic</i> and <b>bold</b> and <u>under</u>")
    }

    func testAssHardLineBreakSurvives() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[2].text, "First row\nSecond row")
    }

    /// Positioning, colour and size have no WebVTT to go to, same as the
    /// server's conversion; the style's Bold survives.
    func testAssSignKeepsTextAndStyleButLosesPositioning() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[3].text, "<b>SHOP SIGN</b>")
    }

    func testAssStyleItalicWrapsTheWholeLine() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[4].text, "<i>Whole line from the style</i>")
    }

    /// {\p1} switches the payload to drawing commands. libavcodec's own encoder
    /// prints those coordinates as dialogue; we do not.
    func testAssDrawingCommandsAreDropped() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[5].text, "after the drawing")
    }

    func testAssKaraokeCollapsesToItsWords() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[6].text, "Karaoke")
    }

    /// Escaped, unlike the server's conversion: a bare "<" opens a tag and a
    /// literal "-->" would end the cue mid-line.
    func testMarkupCharactersAreEscaped() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[7].text, "5 &lt; 7 &amp; 8 &gt; 6")
    }

    func testOverlappingCuesBothSurvive() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues[8].text, "Overlap A")
        XCTAssertEqual(cues[9].text, "<i>Overlap B</i>")
        XCTAssertLessThan(cues[9].start, cues[8].end)
    }

    // MARK: - SSA

    func testSsaV4TrackDecodes() throws {
        let cues = try cues(of: matroska, streamIndex: 2)
        XCTAssertEqual(cues.count, 3)
        XCTAssertEqual(cues[0].text, "SSA v4 plain")
        XCTAssertEqual(cues[0].start, 2.0, accuracy: 0.01)
        XCTAssertEqual(cues[1].text, "SSA <i>italic</i> line\nwrapped")
    }

    /// SSA's [V4 Styles] columns differ from ASS's, so the table is read off
    /// each file's own Format line.
    func testSsaStyleFlagsApply() throws {
        let cues = try cues(of: matroska, streamIndex: 2)
        XCTAssertEqual(cues[2].text, "<b><i>SSA styled bold italic</i></b>")
    }

    // MARK: - SubRip and mov_text

    func testSubRipDecodes() throws {
        let cues = try cues(of: matroska, streamIndex: 3)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0].text, "<i>SubRip italic</i>\nsecond row")
        XCTAssertEqual(cues[0].start, 1.5, accuracy: 0.01)
        XCTAssertEqual(cues[1].text, "SubRip plain")
    }

    func testMovTextDecodes() throws {
        let cues = try cues(of: mp4, streamIndex: 1)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0].text, "<i>SubRip italic</i>\nsecond row")
        XCTAssertEqual(cues[1].text, "SubRip plain")
    }

    // MARK: - Harvest behaviour

    func testRereadingAStreamRecordsEachCueOnce() throws {
        var input: UnsafeMutablePointer<AVFormatContext>? = nil
        XCTAssertGreaterThanOrEqual(avformat_open_input(&input, matroska.path, nil, nil), 0)
        defer { avformat_close_input(&input) }
        XCTAssertGreaterThanOrEqual(avformat_find_stream_info(input, nil), 0)
        guard let input, let stream = input.pointee.streams[3], let decoder = TextSubtitleDecoder(stream: stream) else {
            return XCTFail("no subrip decoder")
        }

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        for pass in 0 ..< 2 {
            if pass > 0 {
                XCTAssertGreaterThanOrEqual(av_seek_frame(input, -1, 0, AVSEEK_FLAG_BACKWARD), 0)
                decoder.flush()
            }
            while av_read_frame(input, packet) >= 0 {
                if packet?.pointee.stream_index == 3, let packet { decoder.handle(packet: packet) }
                av_packet_unref(packet)
            }
        }
        XCTAssertEqual(decoder.count, 2)
    }

    /// HLS wants a straddling cue in both segments.
    func testCueWindowTakesEveryOverlappingCue() throws {
        let cues = try cues(of: matroska, streamIndex: 1)
        XCTAssertEqual(cues.count, 10)

        var input: UnsafeMutablePointer<AVFormatContext>? = nil
        XCTAssertGreaterThanOrEqual(avformat_open_input(&input, matroska.path, nil, nil), 0)
        defer { avformat_close_input(&input) }
        XCTAssertGreaterThanOrEqual(avformat_find_stream_info(input, nil), 0)
        guard let input, let stream = input.pointee.streams[1], let decoder = TextSubtitleDecoder(stream: stream) else {
            return XCTFail("no ass decoder")
        }
        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        while av_read_frame(input, packet) >= 0 {
            if packet?.pointee.stream_index == 1, let packet { decoder.handle(packet: packet) }
            av_packet_unref(packet)
        }

        // The 25.0-28.0 cue straddles a boundary at 27s.
        XCTAssertTrue(decoder.cues(from: 24, to: 27).contains { $0.text == "Overlap A" })
        XCTAssertTrue(decoder.cues(from: 27, to: 30).contains { $0.text == "Overlap A" })
        XCTAssertFalse(decoder.cues(from: 0, to: 6).contains { $0.text == "Overlap A" })
    }

    // MARK: - Playlist and segments

    private func engineSub(_ index: Int) -> RemuxSubtitle {
        RemuxSubtitle(
            index: index, name: "Track \(index)", language: "eng", vttUrl: "", localVtt: "",
            isDefault: true, isForced: false, isImage: false, isEngineText: true)
    }

    /// One full-length segment is fetched at load, when nothing past the opening
    /// seconds is demuxed yet.
    func testEngineTextPlaylistIsCutOnTheSessionGrid() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [engineSub(2)]))
        defer { session.stop() }
        let playlist = try XCTUnwrap(session.subtitlePlaylist(streamIndex: 2))

        XCTAssertEqual(playlist.components(separatedBy: "sub2-").count - 1, 5)
        XCTAssertTrue(playlist.contains("sub2-0.vtt"))
        XCTAssertTrue(playlist.contains("sub2-4.vtt"))
        XCTAssertTrue(playlist.contains("#EXT-X-ENDLIST"))
        // Apple authoring req 8.2: one TARGETDURATION across the session.
        XCTAssertTrue(playlist.contains("#EXT-X-TARGETDURATION:\(session.sessionTargetDuration())"))
    }

    func testSidecarTrackKeepsTheServerUrl() throws {
        let sidecar = RemuxSubtitle(
            index: 3, name: "Track 3", language: "eng", vttUrl: "http://server/3.vtt", localVtt: "",
            isDefault: false, isForced: false, isImage: false, isEngineText: false)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [sidecar]))
        defer { session.stop() }
        let playlist = try XCTUnwrap(session.subtitlePlaylist(streamIndex: 3))

        XCTAssertTrue(playlist.contains("http://server/3.vtt"))
        XCTAssertFalse(playlist.contains("sub3-0.vtt"))
    }

    /// Identity-mapped: the engine's timeline starts at zero, where Jellyfin's
    /// MPEGTS:900000 displaced every cue by 10s.
    func testSegmentBodyIsIdentityMappedWebVTT() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [engineSub(2)]))
        defer { session.stop() }
        let body = try XCTUnwrap(session.subtitleSegment(streamIndex: 2, segment: 0))

        XCTAssertTrue(body.hasPrefix("WEBVTT\n"))
        XCTAssertTrue(body.contains("X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000"))
    }

    func testSegmentOutsideTheGridIsRefused() throws {
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [engineSub(2)]))
        defer { session.stop() }
        XCTAssertNil(session.subtitleSegment(streamIndex: 2, segment: 5))
        XCTAssertNil(session.subtitleSegment(streamIndex: 2, segment: -1))
        XCTAssertNil(session.subtitleSegment(streamIndex: 9, segment: 0))
    }

    func testWebVTTTimestampFormat() {
        XCTAssertEqual(webVTTTimestamp(0), "00:00:00.000")
        XCTAssertEqual(webVTTTimestamp(1.5), "00:00:01.500")
        XCTAssertEqual(webVTTTimestamp(61.25), "00:01:01.250")
        XCTAssertEqual(webVTTTimestamp(3661.007), "01:01:01.007")
        XCTAssertEqual(webVTTTimestamp(-2), "00:00:00.000")
    }
}
