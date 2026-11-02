import XCTest

@testable import TomoEngine

final class LivePartPlaylistTests: XCTestCase {
    private func part(_ duration: Double, independent: Bool = false) -> LivePart {
        LivePart(data: Data([0]), size: 1, duration: duration, independent: independent)
    }

    private func render(closed: [Int], open: Int?, parts: [Int: [LivePart]], durations: [Int: Double], target: Int = 1,
                        reports: [(uri: String, msn: Int, part: Int)] = []) -> String {
        RemuxSession.renderLowLatencyPlaylist(
            target: target, partTarget: 0.5, closed: closed, open: open, parts: parts, durations: durations,
            generationStarts: [0: 0], discontinuitiesRemoved: 0, dates: [:], fallbackDuration: 1,
            initName: { RemuxSession.liveInitName(prefix: "", generation: $0) },
            segmentName: { "seg\($0).m4s" }, partName: { "seg\($0).\($1).m4s" }, reports: reports)
    }

    func testTheOpenSegmentIsListedByItsPartsAndTheHintNamesTheNextPart() {
        let text = render(closed: [4], open: 5, parts: [4: [part(0.48, independent: true), part(0.48), part(0.04)], 5: [part(0.48, independent: true)]],
                          durations: [4: 1])
        XCTAssertTrue(text.contains("#EXT-X-VERSION:9\n"))
        XCTAssertTrue(text.contains("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500\n"))
        XCTAssertTrue(text.contains("#EXT-X-PART-INF:PART-TARGET=0.500\n"))
        XCTAssertTrue(text.contains("#EXT-X-MEDIA-SEQUENCE:4\n"))
        XCTAssertTrue(text.contains("#EXT-X-PART:DURATION=0.48000,URI=\"seg4.0.m4s\",INDEPENDENT=YES\n#EXT-X-PART:DURATION=0.48000,URI=\"seg4.1.m4s\"\n"))
        XCTAssertTrue(text.contains("seg4.2.m4s\"\n#EXTINF:1.000000,\nseg4.m4s\n#EXT-X-PART:DURATION=0.48000,URI=\"seg5.0.m4s\",INDEPENDENT=YES\n"))
        XCTAssertFalse(text.contains("seg5.m4s"), "the open segment is listed as a whole")
        XCTAssertTrue(text.hasSuffix("#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"seg5.1.m4s\"\n"))
    }

    func testAfterASegmentClosesTheHintNamesTheNextSegmentsFirstPart() {
        let text = render(closed: [4], open: nil, parts: [4: [part(0.5, independent: true), part(0.5)]], durations: [4: 1])
        XCTAssertTrue(text.hasSuffix("#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"seg5.0.m4s\"\n"))
    }

    func testPartsAreListedOnlyForTheLastThreeTargetDurations() {
        let closed = Array(0..<6)
        let parts = Dictionary(uniqueKeysWithValues: closed.map { ($0, [part(0.5, independent: true), part(0.5)]) })
        let text = render(closed: closed, open: nil, parts: parts, durations: Dictionary(uniqueKeysWithValues: closed.map { ($0, 1.0) }))
        XCTAssertFalse(text.contains("seg2.0.m4s"))
        for n in 3...5 { XCTAssertTrue(text.contains("URI=\"seg\(n).0.m4s\""), "segment \(n)") }
    }

    func testAPartDurationIsNeverWrittenPastThePartTarget() {
        let text = render(closed: [], open: 0, parts: [0: [part(0.5004, independent: true)]], durations: [:])
        XCTAssertTrue(text.contains("#EXT-X-PART:DURATION=0.50000,URI=\"seg0.0.m4s\""))
    }

    func testAnotherRenditionIsReportedWithItsLastPart() {
        let text = render(closed: [], open: 0, parts: [0: [part(0.5, independent: true)]], durations: [:], reports: [("a1.m3u8", 0, 2)])
        XCTAssertTrue(text.contains("#EXT-X-RENDITION-REPORT:URI=\"a1.m3u8\",LAST-MSN=0,LAST-PART=2\n"))
    }

    func testPartNamesAndReloadQueriesParse() {
        XCTAssertEqual(RemuxSession.partIndices("seg12.3.m4s").map { [$0.segment, $0.part] }, [12, 3])
        XCTAssertNil(RemuxSession.partIndices("seg12.m4s"))
        XCTAssertNil(RemuxSession.partIndices("seg12.x.m4s"))
        XCTAssertEqual(LocalHTTPServer.queryParameters("/t/media.m3u8?_HLS_msn=7&_HLS_part=2"), ["_HLS_msn": "7", "_HLS_part": "2"])
        XCTAssertEqual(LocalHTTPServer.queryParameters("/t/media.m3u8"), [:])
    }
}
