import XCTest

@testable import TomoEngine

/// The LL-HLS playlist against draft-pantos-hls-rfc8216bis-22 and the Low-Latency Server Configuration Profile (Appendix B.1).
final class LivePartPlaylistTests: XCTestCase {
    private func part(_ duration: Double, independent: Bool = false) -> LivePart {
        LivePart(data: Data([0]), size: 1, duration: duration, independent: independent)
    }

    private func render(closed: [Int], open: Int?, parts: [Int: [LivePart]], durations: [Int: Double], target: Int = 1,
                        generationStarts: [Int: Int] = [0: 0], reports: [RemuxSession.RenditionReport] = [], skip: String? = nil) -> String {
        RemuxSession.renderLowLatencyPlaylist(
            target: target, partTarget: 0.5, closed: closed, open: open, parts: parts, durations: durations,
            generationStarts: generationStarts, discontinuitiesRemoved: 0, dates: [:], fallbackDuration: 1,
            initName: { RemuxSession.liveInitName(prefix: "", generation: $0) },
            segmentName: { "seg\($0).m4s" }, partName: { "seg\($0).\($1).m4s" }, reports: reports, skip: skip)
    }

    private func oneSecondSegments(_ count: Int) -> (closed: [Int], parts: [Int: [LivePart]], durations: [Int: Double]) {
        let closed = Array(0..<count)
        return (closed, Dictionary(uniqueKeysWithValues: closed.map { ($0, [part(0.5, independent: true), part(0.5)]) }),
                Dictionary(uniqueKeysWithValues: closed.map { ($0, 1.0) }))
    }

    func testTheHeaderDeclaresVersionSixBlockingReloadDeltaUpdatesAndAHoldBackOfThreeParts() {
        let text = render(closed: [], open: 0, parts: [0: [part(0.5, independent: true)]], durations: [:])
        XCTAssertTrue(text.hasPrefix("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:1\n"))
        XCTAssertTrue(text.contains("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=6.0,PART-HOLD-BACK=1.500\n"))
        XCTAssertTrue(text.contains("#EXT-X-PART-INF:PART-TARGET=0.500\n"))
    }

    func testTheOpenSegmentIsListedByItsPartsAndTheHintNamesTheNextPart() {
        let text = render(closed: [4], open: 5, parts: [4: [part(0.48, independent: true), part(0.48), part(0.04)], 5: [part(0.48, independent: true)]],
                          durations: [4: 1])
        XCTAssertTrue(text.contains("#EXT-X-MEDIA-SEQUENCE:4\n"))
        XCTAssertTrue(text.contains("#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-PART:DURATION=0.48000,URI=\"seg4.0.m4s\",INDEPENDENT=YES\n#EXT-X-PART:DURATION=0.48000,URI=\"seg4.1.m4s\"\n"))
        XCTAssertTrue(text.contains("seg4.2.m4s\"\n#EXTINF:1.000000,\nseg4.m4s\n#EXT-X-PART:DURATION=0.48000,URI=\"seg5.0.m4s\",INDEPENDENT=YES\n"))
        XCTAssertFalse(text.contains("seg5.m4s"), "the open segment is listed as a whole")
        XCTAssertTrue(text.hasSuffix("#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"seg5.1.m4s\"\n"))
    }

    func testAfterASegmentClosesTheHintNamesTheNextSegmentsFirstPart() {
        let text = render(closed: [4], open: nil, parts: [4: [part(0.5, independent: true), part(0.5)]], durations: [4: 1])
        XCTAssertTrue(text.hasSuffix("#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"seg5.0.m4s\"\n"))
    }

    func testPartsAreListedOnlyForTheLastThreeTargetDurations() {
        let (closed, parts, durations) = oneSecondSegments(6)
        let text = render(closed: closed, open: nil, parts: parts, durations: durations)
        XCTAssertFalse(text.contains("seg2.0.m4s"))
        for n in 3...5 { XCTAssertTrue(text.contains("URI=\"seg\(n).0.m4s\""), "segment \(n)") }
    }

    func testAPartDurationIsNeverWrittenPastThePartTarget() {
        let text = render(closed: [], open: 0, parts: [0: [part(0.5004, independent: true)]], durations: [:])
        XCTAssertTrue(text.contains("#EXT-X-PART:DURATION=0.50000,URI=\"seg0.0.m4s\""))
    }

    func testReportsCarryLastPartOnlyForARenditionWithParts() {
        let text = render(closed: [], open: 0, parts: [0: [part(0.5, independent: true)]], durations: [:],
                          reports: [("a1.m3u8", 0, 2), ("sub3.m3u8", 4, nil)])
        XCTAssertTrue(text.contains("#EXT-X-RENDITION-REPORT:URI=\"a1.m3u8\",LAST-MSN=0,LAST-PART=2\n#EXT-X-RENDITION-REPORT:URI=\"sub3.m3u8\",LAST-MSN=4\n"))
    }

    func testADeltaUpdateSkipsTheSegmentsPastSixTargetDurationsFromTheLastFullSegment() {
        let (closed, parts, durations) = oneSecondSegments(20)
        let text = render(closed: closed, open: nil, parts: parts, durations: durations, skip: "YES")
        XCTAssertTrue(text.hasPrefix("#EXTM3U\n#EXT-X-VERSION:9\n"))
        XCTAssertTrue(text.contains("#EXT-X-MEDIA-SEQUENCE:0\n"), "a delta keeps the full playlist's sequence")
        XCTAssertTrue(text.contains("#EXT-X-SKIP:SKIPPED-SEGMENTS=13\n#EXTINF:1.000000,\nseg13.m4s\n"))
        XCTAssertFalse(text.contains("seg12.m4s"))
        XCTAssertFalse(text.contains("EXT-X-MAP"), "the MAP applied to a skipped segment goes with it")
    }

    func testADeltaUpdateKeepsTheTagsOfASpliceAfterTheSkip() {
        let (closed, parts, durations) = oneSecondSegments(20)
        let text = render(closed: closed, open: nil, parts: parts, durations: durations, generationStarts: [0: 0, 15: 1], skip: "YES")
        XCTAssertTrue(text.contains("seg14.m4s\n#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI=\"init-g1.mp4\"\n"))
        XCTAssertEqual(text.components(separatedBy: "EXT-X-MAP").count, 2)
    }

    func testADeltaUpdateThatAlsoSkipsDateRangesListsNoneRemovedAtVersionTen() {
        let (closed, parts, durations) = oneSecondSegments(20)
        let text = render(closed: closed, open: nil, parts: parts, durations: durations, skip: "v2")
        XCTAssertTrue(text.hasPrefix("#EXTM3U\n#EXT-X-VERSION:10\n"))
        XCTAssertTrue(text.contains("#EXT-X-SKIP:SKIPPED-SEGMENTS=13,RECENTLY-REMOVED-DATERANGES=\"\"\n"))
    }

    func testAPlaylistWithNothingPastTheSkipBoundaryIsTheFullPlaylist() {
        let (closed, parts, durations) = oneSecondSegments(5)
        XCTAssertEqual(render(closed: closed, open: nil, parts: parts, durations: durations, skip: "YES"),
                       render(closed: closed, open: nil, parts: parts, durations: durations))
    }

    func testABlockingReloadTooFarAheadIsABadRequest() {
        XCTAssertTrue(RemuxSession.reloadTooFarAhead(msn: 13, part: nil, lastSegment: 10, lastPart: (11, 0), partTarget: 0.5))
        XCTAssertFalse(RemuxSession.reloadTooFarAhead(msn: 12, part: nil, lastSegment: 10, lastPart: (11, 0), partTarget: 0.5))
        XCTAssertEqual(RemuxSession.advancePartLimit(partTarget: 0.5), 6)
        XCTAssertEqual(RemuxSession.advancePartLimit(partTarget: 1), 3)
        XCTAssertTrue(RemuxSession.reloadTooFarAhead(msn: 11, part: 8, lastSegment: 10, lastPart: (11, 1), partTarget: 0.5))
        XCTAssertFalse(RemuxSession.reloadTooFarAhead(msn: 11, part: 7, lastSegment: 10, lastPart: (11, 1), partTarget: 0.5))
        XCTAssertTrue(RemuxSession.reloadTooFarAhead(msn: 12, part: 6, lastSegment: 10, lastPart: (11, 1), partTarget: 0.5))
        XCTAssertFalse(RemuxSession.reloadTooFarAhead(msn: 12, part: 5, lastSegment: 10, lastPart: (11, 1), partTarget: 0.5))
    }

    func testDirectiveValuesAreUnsignedDecimalIntegers() {
        XCTAssertEqual(RemuxSession.directiveValue(["_HLS_msn": "7"], "_HLS_msn"), .some(7))
        XCTAssertEqual(RemuxSession.directiveValue([:], "_HLS_msn"), nil)
        for bad in ["-1", "", "1.5", "x"] {
            XCTAssertEqual(RemuxSession.directiveValue(["_HLS_msn": bad], "_HLS_msn"), .some(nil), bad)
        }
    }

    func testPartNamesAndReloadQueriesParse() {
        XCTAssertEqual(RemuxSession.partIndices("seg12.3.m4s").map { [$0.segment, $0.part] }, [12, 3])
        XCTAssertNil(RemuxSession.partIndices("seg12.m4s"))
        XCTAssertNil(RemuxSession.partIndices("seg12.x.m4s"))
        XCTAssertEqual(LocalHTTPServer.queryParameters("/t/media.m3u8?_HLS_msn=7&_HLS_part=2"), ["_HLS_msn": "7", "_HLS_part": "2"])
        XCTAssertEqual(LocalHTTPServer.queryParameters("/t/media.m3u8"), [:])
    }

    func testAPlainLivePlaylistWithoutReportsIsUnchanged() {
        let plain = RemuxSession.renderLivePlaylist(prefix: "", target: 2, firstRetained: 0, segments: [0], durations: [0: 2],
                                                    generationStarts: [0: 0], dates: [:], fallbackDuration: 2)
        XCTAssertFalse(plain.contains("RENDITION-REPORT"))
        XCTAssertTrue(plain.hasSuffix("#EXTINF:2.000000,\nseg0.m4s\n"))
    }
}
