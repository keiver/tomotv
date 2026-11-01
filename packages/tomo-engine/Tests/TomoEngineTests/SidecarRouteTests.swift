import XCTest

@testable import TomoEngine

final class SidecarRouteTests: XCTestCase {
    private let header = "WEBVTT\n\nRegion: id:subtitle width:80% lines:3 regionanchor:50%,100% viewportanchor:50%,90%\n\n"

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
