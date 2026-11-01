import XCTest

@testable import TomoEngine

final class SidecarWebVTTTests: XCTestCase {
    private let header = "WEBVTT\n\nRegion: id:subtitle width:80% lines:3 regionanchor:50%,100% viewportanchor:50%,90%\n\n"

    func testOverrideBlocksAreRemovedAndCueSettingsKept() {
        let body = header
            + "00:00:01.000 --> 00:00:04.000 region:subtitle line:90%\n{\\fad(120,120)}Some line\n\n"
            + "00:00:05.000 --> 00:00:06.000 region:subtitle line:90%\n{\\pos(320,40)}Top {\\i1}line{\\i0}\n\n"
        let want = header
            + "00:00:01.000 --> 00:00:04.000 region:subtitle line:90%\nSome line\n\n"
            + "00:00:05.000 --> 00:00:06.000 region:subtitle line:90%\nTop line\n\n"
        XCTAssertEqual(SidecarWebVTT.removingOverrideBlocks(body), want)
    }

    func testBracesWithoutABackslashAndAnUnclosedBlockStay() {
        let body = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n{laughs} so {\\b1 it goes\n"
        XCTAssertEqual(SidecarWebVTT.removingOverrideBlocks(body), body)
    }

    func testALineLeftEmptyIsDroppedSoTheCueKeepsItsNextLine() {
        let body = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n{\\an8}\nSecond line\n"
        XCTAssertEqual(SidecarWebVTT.removingOverrideBlocks(body), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSecond line\n")
    }

    func testACueLeftWithNoTextIsDropped() {
        let body = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:03.000 --> 00:00:04.000\n{\\p1}{\\p0}\n\n00:00:05.000 --> 00:00:06.000\nB\n"
        let out = SidecarWebVTT.removingOverrideBlocks(body)
        XCTAssertFalse(out.contains("00:00:03.000"))
        XCTAssertTrue(out.contains("00:00:01.000 --> 00:00:02.000\nA\n"))
        XCTAssertTrue(out.contains("00:00:05.000 --> 00:00:06.000\nB\n"))
    }

    func testCRLFLineEndingsAreKept() {
        let body = "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\n{\\fad(1,1)}Line\r\n\r\n"
        XCTAssertEqual(SidecarWebVTT.removingOverrideBlocks(body), "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nLine\r\n\r\n")
    }

    func testBytesWithoutOverrideBlocksOrNotUTF8AreServedAsTheyCame() {
        let plain = Data("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nNo tags\n".utf8)
        XCTAssertEqual(SidecarWebVTT.removingOverrideBlocks(plain), plain)
        let latin1 = Data([0xE9]) + Data("{\\b1}".utf8)
        XCTAssertEqual(SidecarWebVTT.removingOverrideBlocks(latin1), latin1)
    }

    // MARK: - The sub{N}.vtt route

    private func sidecar(_ index: Int, vttUrl: String = "", localVtt: String = "") -> RemuxSubtitle {
        RemuxSubtitle(index: index, name: "Track \(index)", language: "eng", vttUrl: vttUrl, localVtt: localVtt,
                      isDefault: false, isForced: false, isImage: false, isEngineText: false)
    }

    private func body(_ response: LocalHTTPResponse) -> String? {
        guard case .data(let data, let contentType) = response, contentType == "text/vtt" else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    func testServerSidecarIsFetchedAndServedWithoutOverrideBlocks() throws {
        let tagged = header + "00:00:01.000 --> 00:00:04.000 region:subtitle line:90%\n{\\fad(120,120)}Some line\n\n"
        let origin = LocalHTTPServer { path in
            path == "/Subtitles/3/Stream.vtt" ? .data(Data(tagged.utf8), contentType: "text/vtt") : .notFound
        }
        let port = try origin.start()
        defer { origin.stop() }
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [
            sidecar(3, vttUrl: "http://127.0.0.1:\(port)/Subtitles/3/Stream.vtt"),
            sidecar(4, vttUrl: "http://127.0.0.1:\(port)/Subtitles/4/Stream.vtt"),
        ]))
        defer { session.stop() }

        XCTAssertEqual(body(session.route("sub3.vtt")), header + "00:00:01.000 --> 00:00:04.000 region:subtitle line:90%\nSome line\n\n")
        guard case .temporarilyUnavailable = session.route("sub4.vtt") else { return XCTFail("a server miss is no successful empty track") }
    }

    func testDownloadedSidecarIsServedWithoutOverrideBlocks() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("sidecar-\(UUID().uuidString).vtt")
        try Data("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n{\\fad(120,120)}Saved line\n".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, subtitles: [sidecar(2, localVtt: file.absoluteString)]))
        defer { session.stop() }

        XCTAssertEqual(body(session.route("sub2.vtt")), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSaved line\n")
    }
}
