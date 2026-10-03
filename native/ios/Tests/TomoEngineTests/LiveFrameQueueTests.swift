import AVFoundation
import Foundation
import ImageIO
import XCTest
@testable import TomoEngine

/// The live frame path: the first keyframe with no seek, a time-named file replacing the last, a keyframe
/// already shown left alone, a duplicate refused, a cancel before its turn or mid-read, and the watchdog.
final class LiveFrameQueueTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(".build/frame-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func fixture(_ name: String, _ args: [String]) throws -> URL {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg); fixtures cannot be generated")
        }
        let out = Self.fixtureDir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y"] + args + [out.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: out.path) else {
            try? FileManager.default.removeItem(at: out)
            throw XCTSkip("ffmpeg could not generate \(name)")
        }
        return out
    }

    /// A long-GOP transport stream cut mid-GOP, the shape of a tuner joined between keyframes.
    private func midGopStream() throws -> URL {
        let whole = try fixture("longgop.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-c:v", "libx264", "-g", "250", "-keyint_min", "250", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-an",
        ])
        let out = Self.fixtureDir.appendingPathComponent("longgop-midgop.ts")
        if !FileManager.default.fileExists(atPath: out.path) {
            let data = try Data(contentsOf: whole)
            let cut = data.count * 3 / 20 / 188 * 188
            try data.subdata(in: cut ..< data.count).write(to: out)
        }
        return out
    }

    /// A short-GOP transport stream: a keyframe a second, enough of them for a whole sparse burst.
    private func shortGopStream() throws -> URL {
        try fixture("shortgop.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=60",
            "-c:v", "libx264", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-an",
        ])
    }

    private func scratchRoot() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("liveframes-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func pixelWidth(_ url: URL) -> Int? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return nil }
        return properties[kCGImagePropertyPixelWidth] as? Int
    }

    private func settle(_ queue: LiveFrameQueue, _ channelId: String, _ url: String, deadline: TimeInterval = 8, timeout: TimeInterval = 15) -> LiveFrameQueue.Outcome? {
        let done = XCTestExpectation(description: "frame \(channelId)")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: channelId, inputUrl: url, headers: [:], deadline: deadline) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: timeout)
        return outcome
    }

    func testTheFirstKeyframeOfAStreamJoinedMidGopIsTheFrame() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let urls, _, _)? = settle(queue, "chan-a", stream.absoluteString), let url = urls.first else { return XCTFail("no frame") }
        XCTAssertTrue(url.lastPathComponent.hasPrefix("live-"))
        XCTAssertTrue(url.lastPathComponent.hasSuffix("-0.jpg"))
        XCTAssertEqual(url.deletingLastPathComponent().lastPathComponent, "chan-a")
        XCTAssertEqual(pixelWidth(url), 480)
    }

    func testOneOpenYieldsABurstOfKeyframesAnIntervalApart() throws {
        // 60 s of one-second GOPs: a keyframe at or past each 3 s interval fills the burst.
        let stream = try shortGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let urls, _, _)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no burst") }
        XCTAssertEqual(urls.count, LiveFrameQueue.defaultCount)
        XCTAssertEqual(urls.map(LiveFrameQueue.index), Array(0 ..< LiveFrameQueue.defaultCount))
        XCTAssertEqual(Set(urls.map(LiveFrameQueue.stamp)).count, 1, "one burst shares one stamp")
        for url in urls { XCTAssertEqual(pixelWidth(url), 480) }
        let left = try FileManager.default.contentsOfDirectory(atPath: urls[0].deletingLastPathComponent().path).sorted()
        XCTAssertEqual(left, urls.map(\.lastPathComponent).sorted())
    }

    func testEachFrameIsAnnouncedOnDiskBeforeTheBurstCompletes() throws {
        let stream = try shortGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        let done = XCTestExpectation(description: "burst")
        var streamed: [(URL, Int)] = []
        var onDiskWhenAnnounced = true
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "chan-a", inputUrl: stream.absoluteString, headers: [:], frame: { url, index in
            if !FileManager.default.fileExists(atPath: url.path) { onDiskWhenAnnounced = false }
            streamed.append((url, index))
        }) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .frames(let urls, _, _)? = outcome else { return XCTFail("no burst") }
        XCTAssertTrue(onDiskWhenAnnounced, "an announced frame is already readable")
        XCTAssertEqual(streamed.map(\.0), urls)
        XCTAssertEqual(streamed.map(\.1), Array(0 ..< urls.count))
    }

    func testEachGrabKeepsTheChannelsLastTwoBursts() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let first, _, _)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no first burst") }
        Thread.sleep(forTimeInterval: 0.01)
        guard case .frames(let second, _, _)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no second burst") }
        XCTAssertNotEqual(first, second, "a live grab is never served from the directory")
        let directory = first[0].deletingLastPathComponent().path
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory).sorted(), (first + second).map(\.lastPathComponent).sorted(), "the burst a card may still be loading stays")
        Thread.sleep(forTimeInterval: 0.01)
        guard case .frames(let third, _, _)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no third burst") }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory).sorted(), (second + third).map(\.lastPathComponent).sorted())
    }

    func testTheNewestBurstOnDiskAnswersForAChannelBeforeAnyGrab() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dir = root.appendingPathComponent("chan-a", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let newest = Int64(Date().timeIntervalSince1970 * 1000)
        for name in ["live-\(newest - 2000).jpg", "live-\(newest)-1.jpg", "live-\(newest)-0.jpg", "live-\(newest - 1000)-0.jpg", "poster.jpg"] {
            try Data([0xFF, 0xD8]).write(to: dir.appendingPathComponent(name))
        }
        let queue = LiveFrameQueue(root: root)
        let found = queue.queue.sync { queue.latest(channelIds: ["chan-a", "chan-none", "../escape"]) }
        XCTAssertEqual(found.keys.sorted(), ["chan-a"])
        XCTAssertEqual(found["chan-a"]?.urls.map(\.lastPathComponent), ["live-\(newest)-0.jpg", "live-\(newest)-1.jpg"])
        XCTAssertEqual(LiveFrameQueue.stamp(found["chan-a"]!.urls[0]), newest)
        XCTAssertEqual(LiveFrameQueue.stamp(dir.appendingPathComponent("live-1000.jpg")), 1000)
    }

    func testAClipLeftHalfWrittenIsNeitherTheBurstsClipNorOneOfItsFrames() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dir = root.appendingPathComponent("chan-a", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let stamp = Int64(Date().timeIntervalSince1970 * 1000)
        for name in ["live-\(stamp)-0.jpg", "live-\(stamp)-1.jpg", "live-\(stamp)-clip.mp4.part"] {
            try Data([0xFF, 0xD8]).write(to: dir.appendingPathComponent(name))
        }
        let queue = LiveFrameQueue(root: root)
        let found = queue.queue.sync { queue.latest(channelIds: ["chan-a"]) }
        XCTAssertEqual(found["chan-a"]?.urls.map(\.lastPathComponent), ["live-\(stamp)-0.jpg", "live-\(stamp)-1.jpg"])
        XCTAssertNil(found["chan-a"]?.clip)
    }

    /// Writes a burst whose files were last written or verified at `at`.
    private func writeBurst(_ dir: URL, stamp: Int64, count: Int, at: Date) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for index in 0 ..< count {
            let url = dir.appendingPathComponent("live-\(stamp)-\(index).jpg")
            try Data([0xFF, 0xD8]).write(to: url)
            try FileManager.default.setAttributes([.modificationDate: at], ofItemAtPath: url.path)
        }
    }

    private func names(_ dir: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).sorted()
    }

    func testABurstPastItsValidityAnswersNothingAndItsDateIsItsFilesNotItsName() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let now = Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))
        let expiry = TimeInterval(LiveFrameQueue.expiryMs) / 1000
        // Named long ago but verified a minute ago: valid, dated by the verification.
        let verified = root.appendingPathComponent("chan-verified", isDirectory: true)
        try writeBurst(verified, stamp: 1000, count: 2, at: now.addingTimeInterval(-60))
        let stale = root.appendingPathComponent("chan-stale", isDirectory: true)
        try writeBurst(stale, stamp: Int64(now.timeIntervalSince1970 * 1000), count: 2, at: now.addingTimeInterval(-expiry - 1))

        let queue = LiveFrameQueue(root: root)
        let found = queue.queue.sync { queue.latest(channelIds: ["chan-verified", "chan-stale"], now: now) }
        XCTAssertEqual(found.keys.sorted(), ["chan-verified"])
        XCTAssertEqual(found["chan-verified"]?.at, Int64(now.addingTimeInterval(-60).timeIntervalSince1970 * 1000))
    }

    func testTheSweepTakesEveryExpiredBurstOffDiskAndArmsTheNextOne() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let now = Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))
        let life = TimeInterval(LiveFrameQueue.expiryMs + LiveFrameQueue.diskGraceMs) / 1000
        let gone = root.appendingPathComponent("chan-gone", isDirectory: true)
        try writeBurst(gone, stamp: 1, count: 3, at: now.addingTimeInterval(-life - 1))
        let mixed = root.appendingPathComponent("chan-mixed", isDirectory: true)
        try writeBurst(mixed, stamp: 1, count: 2, at: now.addingTimeInterval(-life - 1))
        try writeBurst(mixed, stamp: 2, count: 2, at: now.addingTimeInterval(-600))
        try Data([0xFF, 0xD8]).write(to: mixed.appendingPathComponent("poster.jpg"))
        // Expired for the screen but still inside the grace: its files stay a moment longer.
        let grace = root.appendingPathComponent("chan-grace", isDirectory: true)
        try writeBurst(grace, stamp: 1, count: 1, at: now.addingTimeInterval(-TimeInterval(LiveFrameQueue.expiryMs) / 1000 - 10))

        let queue = LiveFrameQueue(root: root)
        let next = queue.queue.sync { queue.sweep(now: now) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: gone.path), "a directory the sweep emptied goes")
        XCTAssertEqual(names(mixed), ["live-2-0.jpg", "live-2-1.jpg", "poster.jpg"])
        XCTAssertEqual(names(grace), ["live-1-0.jpg"])
        let graceDue = Int64(now.timeIntervalSince1970 * 1000) - LiveFrameQueue.expiryMs - 10_000 + LiveFrameQueue.expiryMs + LiveFrameQueue.diskGraceMs
        XCTAssertEqual(next, graceDue, "the next sweep is due when the oldest burst left runs out")
    }

    func testReverifyingRestartsTheShownBurstsValidityClipIncludedAndReportsAMissingOne() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let now = Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))
        let ms = { (date: Date) in Int64(date.timeIntervalSince1970 * 1000) }
        let dir = root.appendingPathComponent("chan-a", isDirectory: true)
        // The shown burst is the older one: a cancelled grab left a newer partial beside it.
        try writeBurst(dir, stamp: 1, count: 2, at: now.addingTimeInterval(-3000))
        let clipFile = dir.appendingPathComponent("live-1-clip.mp4")
        try Data([0xFF, 0xD8]).write(to: clipFile)
        try FileManager.default.setAttributes([.modificationDate: now.addingTimeInterval(-3000)], ofItemAtPath: clipFile.path)
        try writeBurst(dir, stamp: 2, count: 1, at: now.addingTimeInterval(-1500))

        XCTAssertTrue(LiveFrameQueue.touch(burstOf: dir.appendingPathComponent("live-1-0.jpg"), in: dir, now: now))
        let bursts = LiveFrameQueue.bursts(in: dir).sorted { $0.stamp < $1.stamp }
        XCTAssertEqual(bursts.map(\.at), [ms(now), ms(now.addingTimeInterval(-1500))])
        XCTAssertEqual(bursts[0].urls.count, 3, "the clip shares its burst's validity")
        XCTAssertFalse(LiveFrameQueue.touch(burstOf: dir.appendingPathComponent("live-9-0.jpg"), in: dir, now: now))
        XCTAssertFalse(LiveFrameQueue.touch(burstOf: nil, in: root.appendingPathComponent("chan-none", isDirectory: true), now: now))
    }

    /// The clip as AVFoundation opens it: its one video track's codec, its duration in seconds and where its
    /// first media segment starts (over zero means an empty edit leads the file; timeRange.start stays 0 for one).
    private func playable(_ url: URL) throws -> (tracks: Int, codec: String, seconds: Double, start: Double) {
        let asset = AVURLAsset(url: url)
        let tracks = asset.tracks(withMediaType: .video)
        let format = tracks.first?.formatDescriptions.first.map { $0 as! CMFormatDescription }
        let fourcc = format.map { CMFormatDescriptionGetMediaSubType($0) } ?? 0
        let codec = String(bytes: [24, 16, 8, 0].map { UInt8((fourcc >> $0) & 0xFF) }, encoding: .ascii) ?? ""
        let media = tracks.first?.segments.first { !$0.isEmpty }
        let start = media.map { CMTimeGetSeconds($0.timeMapping.target.start) } ?? -1
        return (asset.tracks.count, codec, CMTimeGetSeconds(asset.duration), start)
    }

    private func grab(_ queue: LiveFrameQueue, _ stream: URL, clipSpan: TimeInterval) -> LiveFrameQueue.Outcome? {
        let done = XCTestExpectation(description: "burst with clip")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "chan-a", inputUrl: stream.absoluteString, headers: [:], deadline: 12, clipSpan: clipSpan) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 20)
        return outcome
    }

    func testAFullGrabCopiesAFiveSecondVideoClipBesideItsBurst() throws {
        // 60 s of one-second GOPs: the clip is the stream itself, the burst still gets its keyframes.
        let stream = try shortGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let urls, let clip?, _)? = grab(queue, stream, clipSpan: 5) else { return XCTFail("no burst with a clip") }
        XCTAssertEqual(urls.count, LiveFrameQueue.defaultCount)
        XCTAssertEqual(clip.lastPathComponent, "live-\(LiveFrameQueue.stamp(urls[0]))-clip.mp4")
        let opened = try playable(clip)
        XCTAssertEqual(opened.tracks, 1, "video only, no audio")
        XCTAssertEqual(opened.codec, "avc1")
        XCTAssertEqual(opened.seconds, 5, accuracy: 0.1)

        let found = queue.queue.sync { queue.latest(channelIds: ["chan-a"]) }
        XCTAssertEqual(found["chan-a"]?.urls.map(\.lastPathComponent), urls.map(\.lastPathComponent))
        XCTAssertEqual(found["chan-a"]?.clip?.lastPathComponent, clip.lastPathComponent)
    }

    func testAClipFromAStreamJoinedMidGopStartsOnItsFirstKeyframe() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(_, let clip?, _)? = grab(queue, stream, clipSpan: 2) else { return XCTFail("no clip") }
        let opened = try playable(clip)
        XCTAssertEqual(opened.codec, "avc1")
        XCTAssertEqual(opened.seconds, 2, accuracy: 0.25)
        // B-frames hold the keyframe's presentation behind its decode time; the clip's zero is its presentation.
        XCTAssertEqual(opened.start, 0, "no empty edit leads the clip")
    }

    func testAClipCutShortOfThreeOfItsFiveSecondsIsNotWritten() throws {
        // The stream ends 2.4 s in, the way a watchdog stop, a cancel or a timestamp wrap cuts a read.
        let short = try fixture("shortgop-2s.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=2.4",
            "-c:v", "libx264", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-an",
        ])
        let enough = try fixture("shortgop-4s.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=4",
            "-c:v", "libx264", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-an",
        ])
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let urls, let clip, _)? = grab(queue, short, clipSpan: 5) else { return XCTFail("no burst") }
        XCTAssertFalse(urls.isEmpty, "the burst still lands")
        XCTAssertNil(clip, "2.4 s of a 5 s clip would loop a fraction of a second")
        let left = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("chan-a").path)
        XCTAssertFalse(left.contains { $0.contains("clip") }, "neither the clip nor its .part stays: \(left)")

        guard case .frames(_, let kept?, _)? = grab(queue, enough, clipSpan: 5) else { return XCTFail("no clip") }
        let opened = try playable(kept)
        XCTAssertEqual(opened.seconds, 4, accuracy: 0.25, "three of the five seconds is enough")
    }

    func testAnHevcChannelsClipIsEncodedToH264AVFoundationPlays() throws {
        let stream = try fixture("hevc-shortgop.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-c:v", "libx265", "-x265-params", "keyint=25:min-keyint=25:log-level=error", "-pix_fmt", "yuv420p", "-an",
        ])
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(_, let clip?, _)? = grab(queue, stream, clipSpan: 3) else { return XCTFail("no clip") }
        let opened = try playable(clip)
        XCTAssertEqual(opened.codec, "avc1")
        XCTAssertEqual(opened.seconds, 3, accuracy: 0.25)
    }

    func testAnMpeg2ChannelIsTranscodedOnTheDeviceIntoAClipAVFoundationPlays() throws {
        // A broadcast tuner's codec: AVPlayer cannot play it, so the engine's VideoTranscoder makes the clip.
        let stream = try fixture("mpeg2-progressive.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=30:duration=12",
            "-c:v", "mpeg2video", "-b:v", "4M", "-g", "15", "-an",
        ])
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let urls, let clip?, _)? = grab(queue, stream, clipSpan: 5) else { return XCTFail("no clip") }
        XCTAssertFalse(urls.isEmpty)
        let opened = try playable(clip)
        XCTAssertEqual(opened.tracks, 1)
        XCTAssertEqual(opened.codec, "avc1")
        XCTAssertEqual(opened.seconds, 5, accuracy: 0.25)
    }

    func testAnInterlacedMpeg2ChannelIsDeinterlacedIntoItsClip() throws {
        let stream = try fixture("mpeg2-interlaced.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=30000/1001:duration=12",
            "-vf", "tinterlace=interleave_top,setfield=tff",
            "-c:v", "mpeg2video", "-flags", "+ildct+ilme", "-top", "1", "-b:v", "4M", "-g", "15", "-an",
        ])
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(_, let clip?, _)? = grab(queue, stream, clipSpan: 5) else { return XCTFail("no clip") }
        let opened = try playable(clip)
        XCTAssertEqual(opened.codec, "avc1")
        XCTAssertEqual(opened.seconds, 5, accuracy: 0.25)
    }

    func testAGrabWithoutAClipSpanWritesNoClip() throws {
        let stream = try shortGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        guard case .frames(_, let clip, _)? = grab(queue, stream, clipSpan: 0) else { return XCTFail("no burst") }
        XCTAssertNil(clip)
    }

    func testTheKeyframeAlreadyShownWritesNothing() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frames(let burst, _, let pts)? = settle(queue, "chan-a", stream.absoluteString), let first = burst.first else { return XCTFail("no first frame") }
        let shown = try XCTUnwrap(pts)
        let written = Date(timeIntervalSinceNow: -600)
        for url in burst { try FileManager.default.setAttributes([.modificationDate: written], ofItemAtPath: url.path) }
        let done = XCTestExpectation(description: "second")
        var outcome: LiveFrameQueue.Outcome?
        let origin = "unchanged-\(UUID().uuidString)"
        let broker = LiveConnectionBroker.shared
        let playing = try XCTUnwrap(broker.tryAcquire(key: origin, priority: .playback, onRevoke: {}))
        defer { playing.release() }
        queue.request(channelId: "chan-a", inputUrl: stream.absoluteString, headers: [:], originKey: origin, shownPts: shown) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .unchanged(let onDisk)? = outcome else { return XCTFail("the same keyframe is not written again") }
        XCTAssertTrue(onDisk)
        XCTAssertNil(broker.budget(for: origin), "an unchanged preview beside playback is a successful connection")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: first.deletingLastPathComponent().path).sorted(), burst.map(\.lastPathComponent).sorted())
        let verifiedAt = LiveFrameQueue.bursts(in: first.deletingLastPathComponent()).first?.at ?? 0
        XCTAssertGreaterThan(verifiedAt, Int64(written.timeIntervalSince1970 * 1000) + 300_000, "the verified burst's validity restarts on disk")
        guard case .frames? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("a grab with nothing shown writes its burst") }
    }

    func testASuccessfulShortSpanDoesNotLearnAConnectionLimit() throws {
        let stream = try shortGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        let origin = "short-span-\(UUID().uuidString)"
        let broker = LiveConnectionBroker.shared
        let playing = try XCTUnwrap(broker.tryAcquire(key: origin, priority: .playback, onRevoke: {}))
        defer { playing.release() }
        let done = expectation(description: "short span")
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "short", inputUrl: stream.absoluteString, headers: [:], span: 0.1, count: 10, originKey: origin) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        guard case .frames(let files, _, _)? = outcome else { return XCTFail("expected a successful burst") }
        XCTAssertEqual(files.count, 1)
        XCTAssertNil(broker.budget(for: origin), "ending at the requested span is not a provider kick")
    }

    func testAnInputEndingBeforeTheBurstStillLearnsAConnectionLimit() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        let origin = "ended-input-\(UUID().uuidString)"
        let broker = LiveConnectionBroker.shared
        let playing = try XCTUnwrap(broker.tryAcquire(key: origin, priority: .playback, onRevoke: {}))
        defer { playing.release() }
        let done = expectation(description: "input ended")
        queue.request(channelId: "ended", inputUrl: stream.absoluteString, headers: [:], span: 60, count: 100, originKey: origin) { _ in done.fulfill() }
        wait(for: [done], timeout: 15)
        XCTAssertEqual(broker.budget(for: origin), 1, "an actual early input end beside playback still teaches the broker")
    }

    func testADuplicateRequestForAChannelInFlightAnswersCancelled() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        let first = XCTestExpectation(description: "first")
        var firstOutcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "chan-a", inputUrl: stream.absoluteString, headers: [:]) {
            firstOutcome = $0
            first.fulfill()
        }
        var duplicate: LiveFrameQueue.Outcome?
        queue.request(channelId: "chan-a", inputUrl: stream.absoluteString, headers: [:]) { duplicate = $0 }
        guard case .cancelled? = duplicate else { return XCTFail("the duplicate should answer cancelled at once") }
        wait(for: [first], timeout: 15)
        guard case .frames? = firstOutcome else { return XCTFail("the first request still answers its frame") }
    }

    func testACancelBeforeItsTurnOpensNothing() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        let first = XCTestExpectation(description: "first")
        let second = XCTestExpectation(description: "second")
        var secondOutcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "chan-a", inputUrl: stream.absoluteString, headers: [:]) { _ in first.fulfill() }
        queue.request(channelId: "chan-b", inputUrl: stream.absoluteString, headers: [:]) {
            secondOutcome = $0
            second.fulfill()
        }
        queue.cancel(channelId: "chan-b")
        wait(for: [first, second], timeout: 15)
        guard case .cancelled? = secondOutcome else { return XCTFail("the cancelled job should not run") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("chan-b").path))
    }

    func testACancelStopsAGrabAlreadyReading() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)
        let done = XCTestExpectation(description: "cancelled")
        var outcome: LiveFrameQueue.Outcome?
        let started = Date()
        queue.request(channelId: "chan-dead", inputUrl: "http://10.255.255.1:9/live.m3u8", headers: [:], deadline: 8) {
            outcome = $0
            done.fulfill()
        }
        Thread.sleep(forTimeInterval: 0.5)
        queue.cancel(channelId: "chan-dead")
        wait(for: [done], timeout: 12)
        guard case .cancelled? = outcome else { return XCTFail("a cancelled grab answers cancelled") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3, "the read is stopped, not left to its 8 s deadline")
    }

    func testTheWatchdogStopsAGrabOnADeadOrigin() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        // A non-routable address: the connect hangs until the watchdog's stop interrupts it.
        let started = Date()
        let outcome = settle(queue, "chan-dead", "http://10.255.255.1:9/live.m3u8", deadline: 1, timeout: 12)
        guard case .none(let opened, _)? = outcome else { return XCTFail("a dead origin gives no frame") }
        XCTAssertFalse(opened)
        XCTAssertLessThan(Date().timeIntervalSince(started), 6, "the deadline bounds the grab, not rw_timeout")
    }

    func testRefusesAChannelIdThatIsNotAPlainToken() {
        let queue = LiveFrameQueue()
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "../escape", inputUrl: "file:///nowhere", headers: [:]) { outcome = $0 }
        guard case .none(let opened, _)? = outcome else { return XCTFail("refused before any open") }
        XCTAssertTrue(opened)
    }
}
