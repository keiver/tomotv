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

/// The same decoder against the real ASS and SSA the playback suite plays (T99,
/// T100), which the generator builds into ~/Movies/development-videos. Skipped
/// until then: those samples are fetched, never rehosted, so nothing here is a
/// committed fixture.
final class RealTextSubtitleSampleTests: XCTestCase {
    private func fixture(_ title: String) throws -> URL {
        let dir = ProcessInfo.processInfo.environment["TOMO_FIXTURE_DIR"]
            ?? NSHomeDirectory() + "/Movies/development-videos"
        let url = URL(fileURLWithPath: dir).appendingPathComponent("\(title).mkv")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw XCTSkip("\(title) not built; run npm run make:test-media")
        }
        return url
    }

    private func cues(_ url: URL, nth: Int = 0) throws -> [TextSubtitleCue] {
        var input: UnsafeMutablePointer<AVFormatContext>? = nil
        XCTAssertGreaterThanOrEqual(avformat_open_input(&input, url.path, nil, nil), 0)
        defer { avformat_close_input(&input) }
        XCTAssertGreaterThanOrEqual(avformat_find_stream_info(input, nil), 0)
        guard let input else { return [] }

        var decoder: TextSubtitleDecoder? = nil
        var index: Int32 = -1
        var seen = 0
        for i in 0 ..< Int32(input.pointee.nb_streams) {
            guard let stream = input.pointee.streams[Int(i)],
                  stream.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_SUBTITLE else { continue }
            if seen < nth {
                seen += 1
                continue
            }
            decoder = TextSubtitleDecoder(stream: stream)
            index = i
            break
        }
        guard let decoder else {
            XCTFail("no text subtitle stream in \(url.lastPathComponent)")
            return []
        }

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        while av_read_frame(input, packet) >= 0 {
            if packet?.pointee.stream_index == index, let packet { decoder.handle(packet: packet) }
            av_packet_unref(packet)
        }
        return decoder.cues(from: 0, to: 100_000)
    }

    /// Its one cue is three override blocks of animation (\fade, \t, \frz, \fscx)
    /// wrapped around two words, and the font it names rides as an attachment.
    func testTypesetAssSampleKeepsItsWords() throws {
        let cues = try cues(try fixture("T99 REMUX H264 ASS real"))
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues[0].text, "<b>Soft-Rotor</b>")
        XCTAssertEqual(cues[0].start, 0, accuracy: 0.01)
    }

    /// Every line of this script is styled "*Default". Matching the star as part
    /// of the name found no style at all and lost the file's bold and italic.
    func testSsaSampleResolvesStarredStyleNames() throws {
        // The Aegisub sample rides as the second subtitle track; the first is the
        // generated script the device is judged against.
        let cues = try cues(try fixture("T100 REMUX H264 SSA real"), nth: 1)
        XCTAssertEqual(cues.count, 11)
        XCTAssertEqual(cues[0].start, 2.42, accuracy: 0.01)
        // Bold off the *Default style, and the font and colour overrides gone.
        XCTAssertEqual(cues[0].text, "<b>All Japan Boys Soccer Tournament Opens!</b>")
        // Bold is the *Default style's, on every line the 60s bed covers.
        XCTAssertTrue(cues.allSatisfy { $0.text.hasPrefix("<b>") }, "a line lost its style")
        XCTAssertFalse(cues.contains { $0.text.contains("{") }, "an override block reached the cue text")
    }
}

/// Script headers straight off a converter, where the shape of the file itself
/// is the trap rather than any one tag.
final class AssHeaderTests: XCTestCase {
    private let ssaHeader = [
        "[Script Info]",
        "ScriptType: v4.00",
        "",
        "[V4 Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding",
        "Style: Default,Verdana,28,16777215,65535,0,0,-1,0,1,2,0,2,30,30,28,0,0",
        "",
        "[Events]",
        "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    /// Swift reads CRLF as ONE Character, so splitting a CRLF script on "\n"
    /// hands back the whole header as a single line and the style table comes
    /// out empty. Aegisub writes CRLF, which is most of the ASS in the world.
    func testCrlfHeaderStillYieldsStyles() {
        let dialogue = "0,0,*Default,,0000,0000 ,0000,,Hello"
        XCTAssertEqual(AssToWebVTT(header: ssaHeader.joined(separator: "\n")).cueText(dialogue), "<b>Hello</b>")
        XCTAssertEqual(AssToWebVTT(header: ssaHeader.joined(separator: "\r\n")).cueText(dialogue), "<b>Hello</b>")
    }

    /// SSA writes a leading star for a style it did not resolve; it is not part
    /// of the name, and matching it literally lost every styled line in the
    /// Alien Nine sample.
    func testStarredStyleNameResolves() {
        let converter = AssToWebVTT(header: ssaHeader.joined(separator: "\r\n"))
        XCTAssertEqual(converter.cueText("0,0,*Default,,0,0,0,,Hello"), "<b>Hello</b>")
        XCTAssertEqual(converter.cueText("0,0,Default,,0,0,0,,Hello"), "<b>Hello</b>")
        XCTAssertEqual(converter.cueText("0,0,Missing,,0,0,0,,Hello"), "Hello")
    }

    /// A tag with no argument reverts to the style rather than switching on: the
    /// digits are what carry the value, and dropping the tag lost the revert.
    func testBareTagRevertsToTheStyle() {
        let converter = AssToWebVTT(header: ssaHeader.joined(separator: "\r\n"))
        // Default is bold in this header, so {\\b} after {\\b0} puts it back.
        XCTAssertEqual(converter.cueText("0,0,Default,,0,0,0,,{\\b0}plain{\\b}bold again"), "plain<b>bold again</b>")
        XCTAssertEqual(converter.cueText("0,0,Default,,0,0,0,,{\\i}italic from the style"), "<b>italic from the style</b>")
    }

    /// \\r goes back to the dialogue's style, \\rName to the one it names.
    func testNamedResetTakesThatStyle() {
        let header = ssaHeader.flatMap { line in
            line == "" ? ["Style: Whisper,Arial,28,16777215,65535,0,0,0,-1,1,2,0,2,30,30,28,0,0", line] : [line]
        }
        let converter = AssToWebVTT(header: header.joined(separator: "\r\n"))
        // Default is bold here, so the reset puts bold back and drops the italic.
        XCTAssertEqual(converter.cueText("0,0,Default,,0,0,0,,{\\i1}both{\\r}back to bold"), "<b><i>both</i></b><b>back to bold</b>")
        XCTAssertEqual(converter.cueText("0,0,Default,,0,0,0,,start{\\rWhisper}whispered"), "<b>start</b><i>whispered</i>")
    }

    /// An animation block is not a drawing block: \\t carries \\frz and \\fscx, and
    /// reading either as \\p would have swallowed the words after it.
    func testAnimationOverridesLeaveTheTextAlone() {
        let converter = AssToWebVTT(header: ssaHeader.joined(separator: "\r\n"))
        let dialogue = "0,0,Default,,0,0,0,,{\\fade(0,255,255,0,9500,9500,10000)}{\\t(0,9500,10,\\frz5000\\fscx1\\fscy1)}Soft-Rotor"
        XCTAssertEqual(converter.cueText(dialogue), "<b>Soft-Rotor</b>")
    }
}

/// The bytes AVPlayer actually receives: a real session over the T100 fixture,
/// asked for the same WebVTT segments the Apple TV fetches.
final class ServedSubtitleSegmentTests: XCTestCase {
    private func fixture() throws -> URL {
        let dir = ProcessInfo.processInfo.environment["TOMO_FIXTURE_DIR"] ?? NSHomeDirectory() + "/Movies/development-videos"
        let url = URL(fileURLWithPath: dir).appendingPathComponent("T100 REMUX H264 SSA real.mkv")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw XCTSkip("T100 not built; run npm run make:test-media -- --only T100")
        }
        return url
    }

    func testSegmentZeroCarriesItsCueInOutputTime() throws {
        let url = try fixture()
        let session = try RemuxSession(
            config: makeConfig(
                durationSeconds: 60.6,
                inputUrl: url.path,
                subtitles: [
                    RemuxSubtitle(
                        index: 2, name: "English", language: "eng", vttUrl: "", localVtt: "",
                        isDefault: true, isForced: false, isImage: false, isEngineText: true)
                ],
                codecs: "avc1.64001f,mp4a.40.2",
                width: 1280, height: 720, frameRate: 24
            ))
        defer { session.stop() }
        session.start()

        let body = try XCTUnwrap(session.subtitleSegment(streamIndex: 2, segment: 0))
        XCTAssertTrue(body.hasPrefix("WEBVTT\n"), "not a WebVTT segment")
        XCTAssertTrue(body.contains("X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000"))
        // The cue names its own second, which is what makes the picture judgeable.
        XCTAssertTrue(body.contains("00:00:02.000 --> 00:00:03.000"), "cue timing missing from:\n\(body)")
        XCTAssertTrue(body.contains("0:02 plain line"), "cue text missing from:\n\(body)")
    }

    /// The window 12-18s holds two lines; a segment that served early would be empty.
    func testMidFileSegmentCarriesItsCues() throws {
        let url = try fixture()
        let session = try RemuxSession(
            config: makeConfig(
                durationSeconds: 60.6,
                inputUrl: url.path,
                subtitles: [
                    RemuxSubtitle(
                        index: 2, name: "English", language: "eng", vttUrl: "", localVtt: "",
                        isDefault: true, isForced: false, isImage: false, isEngineText: true)
                ],
                codecs: "avc1.64001f,mp4a.40.2",
                width: 1280, height: 720, frameRate: 24
            ))
        defer { session.stop() }
        session.start()

        let body = try XCTUnwrap(session.subtitleSegment(streamIndex: 2, segment: 2))
        XCTAssertTrue(body.contains("00:00:12.000 --> 00:00:13.000"), "12s cue missing from:\n\(body)")
        XCTAssertTrue(body.contains("karaoke reads as one word"), "karaoke line missing from:\n\(body)")
        XCTAssertFalse(body.contains("{"), "an override block reached the cue text:\n\(body)")
    }
}

/// The shape that lost the track on an Apple TV: the player takes the playlist
/// and asks for every segment of a short item at once, milliseconds after the
/// session opened.
final class SubtitleStartupRaceTests: XCTestCase {
    func testEverySegmentAskedForAtOnceCarriesItsCues() throws {
        let dir = ProcessInfo.processInfo.environment["TOMO_FIXTURE_DIR"] ?? NSHomeDirectory() + "/Movies/development-videos"
        let url = URL(fileURLWithPath: dir).appendingPathComponent("T100 REMUX H264 SSA real.mkv")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw XCTSkip("T100 not built; run npm run make:test-media -- --only T100")
        }

        let session = try RemuxSession(
            config: makeConfig(
                durationSeconds: 60,
                inputUrl: url.path,
                subtitles: [
                    RemuxSubtitle(
                        index: 2, name: "English", language: "eng", vttUrl: "", localVtt: "",
                        isDefault: true, isForced: false, isImage: false, isEngineText: true)
                ],
                codecs: "avc1.64001f,mp4a.40.2",
                width: 1280, height: 720, frameRate: 24
            ))
        defer { session.stop() }
        session.start()

        // No pause: the playlist and its segments are asked for immediately, in
        // parallel, which is what the HTTP server does with them.
        let playlist = try XCTUnwrap(session.subtitlePlaylist(streamIndex: 2))
        let count = playlist.components(separatedBy: ".vtt").count - 1
        XCTAssertEqual(count, 10)

        // A player pulls both tracks, and it is the video demand that drives the
        // producer: asking for cues alone leaves the read head where it started.
        let bodies = (0 ..< count).map { n -> String? in
            _ = session.segmentURL(n)
            return session.subtitleSegment(streamIndex: 2, segment: n)
        }
        let cues = bodies.compactMap { $0 }.map { $0.components(separatedBy: " --> ").count - 1 }.reduce(0, +)
        XCTAssertEqual(bodies.count, count)
        // Every second slot of the fixture carries a line, so an empty answer
        // anywhere means the track was lost the way it was on the device.
        XCTAssertGreaterThan(cues, 20, "segments came back without cues: \(bodies.map { ($0 ?? "").count })")
    }
}
