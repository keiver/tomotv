import Foundation
import ImageIO
import XCTest
@testable import TomoEngine

/// The live frame path: the first keyframe with no seek, a time-named file replacing the last,
/// a duplicate request refused, a cancel before its turn, and the watchdog on a dead origin.
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

        guard case .frame(let url)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no frame") }
        XCTAssertTrue(url.lastPathComponent.hasPrefix("live-"))
        XCTAssertEqual(url.deletingLastPathComponent().lastPathComponent, "chan-a")
        XCTAssertEqual(pixelWidth(url), 480)
    }

    func testEachGrabReplacesTheChannelsLastFrame() throws {
        let stream = try midGopStream()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        guard case .frame(let first)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no first frame") }
        Thread.sleep(forTimeInterval: 0.01)
        guard case .frame(let second)? = settle(queue, "chan-a", stream.absoluteString) else { return XCTFail("no second frame") }
        XCTAssertNotEqual(first, second, "a live grab is never served from the directory")
        let left = try FileManager.default.contentsOfDirectory(atPath: first.deletingLastPathComponent().path)
        XCTAssertEqual(left, [second.lastPathComponent])
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
        guard case .frame? = firstOutcome else { return XCTFail("the first request still answers its frame") }
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

    func testTheWatchdogStopsAGrabOnADeadOrigin() throws {
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = LiveFrameQueue(root: root)

        // A non-routable address: the connect hangs until the watchdog's stop interrupts it.
        let started = Date()
        let outcome = settle(queue, "chan-dead", "http://10.255.255.1:9/live.m3u8", deadline: 1, timeout: 12)
        guard case .none(let opened)? = outcome else { return XCTFail("a dead origin gives no frame") }
        XCTAssertFalse(opened)
        XCTAssertLessThan(Date().timeIntervalSince(started), 6, "the deadline bounds the grab, not rw_timeout")
    }

    func testRefusesAChannelIdThatIsNotAPlainToken() {
        let queue = LiveFrameQueue()
        var outcome: LiveFrameQueue.Outcome?
        queue.request(channelId: "../escape", inputUrl: "file:///nowhere", headers: [:]) { outcome = $0 }
        guard case .none(let opened)? = outcome else { return XCTFail("refused before any open") }
        XCTAssertTrue(opened)
    }
}
