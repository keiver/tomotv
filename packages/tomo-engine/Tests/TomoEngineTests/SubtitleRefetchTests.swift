import AVFoundation
import XCTest

@testable import TomoEngine

/// How the host AVPlayer asks for a text track's cues again, which is what carries a time offset set
/// in the running session to the screen without a restart.
final class SubtitleRefetchTests: XCTestCase {
    private var fixture: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/text-subtitles.mkv")
    }

    func testTurningTheTrackOffAndOnAsksForItsCuesAgain() throws {
        let track = RemuxSubtitle(
            index: 2, name: "Track 2", language: "spa", vttUrl: "", localVtt: "",
            isDefault: false, isForced: false, isImage: false, isEngineText: true)
        let session = try RemuxSession(config: makeConfig(durationSeconds: 30, inputUrl: fixture.absoluteString, subtitles: [track]))
        session.start()
        defer { session.stop() }
        let lock = NSLock()
        var requests: [String] = []
        let server = LocalHTTPServer { request in
            let name = String(request.dropFirst())
            lock.lock()
            requests.append(name)
            lock.unlock()
            return session.route(name)
        }
        let port = try server.start()
        defer { server.stop() }
        func cueRequests() -> Int {
            lock.lock()
            defer { lock.unlock() }
            return requests.filter { $0.hasPrefix("sub2-") }.count
        }

        let item = AVPlayerItem(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/master.m3u8")))
        let player = AVPlayer(playerItem: item)
        player.play()
        defer { player.pause() }
        // The legible group is what the measurement needs; the host player loads it whether or not the picture starts.
        XCTAssertTrue(spinMainRunLoop(seconds: 60) { item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible) != nil }, "no legible group: \(String(describing: item.error))")
        let group = try XCTUnwrap(item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible), "no legible group")
        let option = try XCTUnwrap(group.options.first, "no legible option")
        item.select(option, in: group)
        XCTAssertTrue(spinMainRunLoop(seconds: 15) { cueRequests() > 0 }, "selecting the track never asked for its cues")
        spinMainRunLoop(seconds: 3) { false }
        let afterSelect = cueRequests()

        item.select(nil, in: group)
        spinMainRunLoop(seconds: 1) { false }
        item.select(option, in: group)
        let reselected = spinMainRunLoop(seconds: 10) { cueRequests() > afterSelect }
        let afterReselect = cueRequests()

        player.seek(to: player.currentTime(), toleranceBefore: .zero, toleranceAfter: .zero)
        let seeked = spinMainRunLoop(seconds: 10) { cueRequests() > afterReselect }
        let afterSeek = cueRequests()

        print("[SubtitleRefetchTests] cue requests: \(afterSelect) after the select, \(afterReselect) after off and on (\(reselected ? "asked again" : "not asked")), \(afterSeek) after a seek in place (\(seeked ? "asked again" : "not asked"))")
        XCTAssertTrue(reselected, "turning the track off and on did not make the player ask for the cues again")
    }
}
