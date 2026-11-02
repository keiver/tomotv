import AVFoundation
import CoreMedia
import XCTest

@testable import TomoEngine

/// An ADTS HE-AAC source stream-copied: the audio init has to carry the explicit SBR signaling Apple's
/// own encoder writes, or AVFoundation plays the track silent (issue 110). The feeds are the host ffmpeg's
/// AudioToolbox encoder; TOMO_LIVE_SOURCE_HEAAC names a real channel (HE-AAC v1, 48 kHz, stereo).
final class LiveHeAacTests: XCTestCase {
    private struct Expected {
        let profile: String
        let extradataBytes: String
        let formatID: AudioFormatID
        let codecs: String
    }

    private static let heAac = Expected(profile: "HE-AAC", extradataBytes: "5", formatID: kAudioFormatMPEG4AAC_HE, codecs: "mp4a.40.5")
    // ffprobe labels explicitly signaled PS "HE-AAC" (aacdec.c, decode_extension_payload); the PS layer shows in AVPlayer's richest format.
    private static let heAacV2 = Expected(profile: "HE-AAC", extradataBytes: "7", formatID: kAudioFormatMPEG4AAC_HE_V2, codecs: "mp4a.40.29")

    private func fourcc(_ id: AudioFormatID) -> String {
        String(bytes: [24, 16, 8, 0].map { UInt8((id >> $0) & 0xFF) }, encoding: .ascii) ?? "?"
    }

    private func check(source: String, expected: Expected) throws {
        var config = makeConfig(durationSeconds: 0, inputUrl: source, videoRange: "", codecs: "", width: 0, height: 0, frameRate: 0, bandwidth: 0,
                                isLive: true, liveSegmentSeconds: 2)
        config.describesInput = true
        config.liveBufferSeconds = 6
        let session = try RemuxSession(config: config)
        let lock = NSLock()
        var failure: String?
        session.onFailed = { payload in
            lock.lock()
            failure = "\(payload)"
            lock.unlock()
        }
        session.start()
        defer { session.stop() }

        var playlist = ""
        let formed = Date().addingTimeInterval(90)
        while Date() < formed, playlistEntries(playlist).count < 2 {
            lock.lock()
            let f = failure
            lock.unlock()
            if let f { return XCTFail("session failed: \(f)") }
            playlist = session.mediaPlaylist()
            Thread.sleep(forTimeInterval: 1)
        }
        let list = playlistEntries(playlist)
        XCTAssertGreaterThanOrEqual(list.count, 2, playlist)
        guard list.count >= 2 else { return }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("localremux").appendingPathComponent(session.token)

        let (fields, context) = try probeRendition(dir: dir, map: list[1].map, segment: list[1].name, stream: "a:0",
                                                   entries: "stream=codec_name,profile,sample_rate,channels,extradata_size")
        XCTAssertEqual(fields, ["aac", expected.profile, "48000", "2", expected.extradataBytes], context)
        let decoded = try decodedAudioRmsDb(dir: dir, map: list[1].map, segment: list[1].name)
        XCTAssertGreaterThan(decoded.level ?? -200, -60, "silent or undecodable audio: \(decoded.context)")
        XCTAssertTrue(session.masterPlaylist().contains(expected.codecs), session.masterPlaylist())

        let (server, url) = try serveOverLoopback(session)
        defer { server.stop() }
        let player = AVPlayer(url: url)
        player.play()
        XCTAssertTrue(spinMainRunLoop(seconds: 60) { player.currentItem?.status == .readyToPlay && player.currentTime().seconds > 2 },
                      "never played: \(String(describing: player.currentItem?.error))")
        let tracks = player.currentItem?.tracks ?? []
        let audio = tracks.first { $0.assetTrack?.mediaType == .audio }
        let description = audio?.assetTrack?.formatDescriptions.first.map { $0 as! CMFormatDescription }
        let format = description.flatMap { CMAudioFormatDescriptionGetRichestDecodableFormat($0)?.pointee.mASBD }
        let seen = format.map { "\(fourcc($0.mFormatID)) \($0.mSampleRate) Hz" } ?? "no audio format (\(tracks.count) tracks)"
        XCTAssertEqual(format?.mFormatID, expected.formatID, "AVPlayer's richest decodable format is \(seen), wanted \(fourcc(expected.formatID))")
        XCTAssertEqual(format?.mSampleRate, 48000, seen)
        XCTAssertNil(player.currentItem?.error)
    }

    private func checkFeed(profile: Int, expected: Expected) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-heaac-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let feed = try startLiveFeed(in: root, audio: ["-c:a", "aac_at", "-profile:a", "\(profile)", "-b:a", "64k", "-ar", "48000", "-ac", "2"])
        defer { feed.terminate() }
        let origin = try RecordingDirectoryServer(root: root)
        defer { origin.stop() }
        try check(source: "\(origin.base)/live.m3u8", expected: expected)
    }

    func testAnHeAacFeedCopiesWithExplicitSbrSignaling() throws {
        try checkFeed(profile: 4, expected: Self.heAac)
    }

    func testAnHeAacV2FeedCopiesWithParametricStereoSignaling() throws {
        try checkFeed(profile: 28, expected: Self.heAacV2)
    }

    func testARealHeAacChannelCopiesWithSbr() throws {
        guard let source = ProcessInfo.processInfo.environment["TOMO_LIVE_SOURCE_HEAAC"] else {
            throw XCTSkip("set TOMO_LIVE_SOURCE_HEAAC to a live HE-AAC v1 48 kHz stereo channel URL")
        }
        try check(source: source, expected: Self.heAac)
    }
}
