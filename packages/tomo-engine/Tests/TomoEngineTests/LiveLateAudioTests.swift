import XCTest

@testable import TomoEngine

/// A live MPEG-TS whose first audio packet is muxed after the 2 s probe ends: the session carries that audio.
final class LiveLateAudioTests: XCTestCase {
    func testOnlyAProbeThatDescribedNoAudioReadsOn() {
        XCTAssertEqual(LiveLateAudio.streamsToReadOn([(1, false)]), [1])
        XCTAssertEqual(LiveLateAudio.streamsToReadOn([(1, false), (2, false)]), [1, 2])
        XCTAssertEqual(LiveLateAudio.streamsToReadOn([(1, true), (2, false)]), [])
        XCTAssertEqual(LiveLateAudio.streamsToReadOn([]), [])
    }

    func testAnAudioStreamMuxedThreeSecondsBehindTheVideoIsCarriedAndDecodes() throws {
        // A 1 MB PES payload and a 6 s mux delay put 2.96 s of video ahead of the first audio packet (measured with ffprobe).
        let (feed, path) = try startContinuousFeed(fps: "25", keyframeSeconds: 1, muxing: ["-pes_payload_size", "1000000", "-muxdelay", "6"])
        addTeardownBlock {
            feed.terminate()
            try? FileManager.default.removeItem(atPath: path)
        }
        let config = makeConfig(durationSeconds: 0, inputUrl: path, width: 1280, height: 720, isLive: true, liveSegmentSeconds: 2)
        let session = try RemuxSession(config: config)
        session.start()
        addTeardownBlock { session.stop() }

        var playlist = ""
        let formed = Date().addingTimeInterval(40)
        while Date() < formed, playlistEntries(playlist).count < 2 {
            playlist = session.mediaPlaylist()
            Thread.sleep(forTimeInterval: 0.5)
        }
        let list = playlistEntries(playlist)
        guard list.count >= 2 else { return XCTFail("no 2 segments in 40 s: \(playlist)") }
        XCTAssertTrue(session.masterPlaylist().contains("mp4a.40.2"), session.masterPlaylist())
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)
        let (fields, context) = try probeRendition(dir: dir, map: list[1].map, segment: list[1].name, stream: "a:0",
                                                   entries: "stream=codec_name,sample_rate,channels")
        XCTAssertEqual(fields, ["aac", "48000", "1"], context)
        let decoded = try decodedAudioRmsDb(dir: dir, map: list[1].map, segment: list[1].name)
        XCTAssertGreaterThan(decoded.level ?? -200, -60, "silent or undecodable audio: \(decoded.context)")
    }
}
