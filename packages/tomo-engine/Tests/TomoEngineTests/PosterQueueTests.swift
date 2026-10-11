import Foundation
import ImageIO
import XCTest
@testable import TomoEngine

/// The poster path on a generated clip: one decode into a scratch pool, a hit served from
/// the file, a cancel before its turn, and a source with nothing to give.
final class PosterQueueTests: XCTestCase {
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

    private func scratchRoot() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("posters-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func pixelWidth(_ url: URL) -> Int? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return nil }
        return properties[kCGImagePropertyPixelWidth] as? Int
    }

    private func clip() throws -> URL {
        try fixture("chapters-h264.mp4", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-an",
        ])
    }

    private func settle(_ queue: PosterQueue, _ itemId: String, _ url: URL, ms: Int64 = 2000) -> PosterQueue.Outcome? {
        let done = XCTestExpectation(description: "poster \(itemId)")
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: itemId, inputUrl: url.absoluteString, milliseconds: ms) {
            outcome = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 15)
        return outcome
    }

    func testDecodesOncePerItemAndServesTheFileAfter() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        guard case .poster(let first, let fresh)? = settle(queue, "film-a", clip) else { return XCTFail("no poster") }
        XCTAssertTrue(fresh)
        XCTAssertEqual(first.lastPathComponent, PosterQueue.fileName)
        XCTAssertEqual(first.deletingLastPathComponent().lastPathComponent, "film-a")
        XCTAssertEqual(pixelWidth(first), 480)

        // A hit is answered on the caller's thread, before the request returns.
        var answered = false
        queue.request(itemId: "film-a", inputUrl: clip.absoluteString, milliseconds: 2000) { _ in answered = true }
        XCTAssertTrue(answered, "a poster already in the pool is served without queueing")
    }

    func testCancelBeforeItsTurnWritesNothing() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        // The first job holds the serial queue; the second is cancelled while it waits.
        let first = XCTestExpectation(description: "first")
        queue.request(itemId: "film-a", inputUrl: clip.absoluteString, milliseconds: 2000) { _ in first.fulfill() }
        let second = XCTestExpectation(description: "second")
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: "film-b", inputUrl: clip.absoluteString, milliseconds: 2000) {
            outcome = $0
            second.fulfill()
        }
        queue.cancel(itemId: "film-b")
        wait(for: [first, second], timeout: 15)

        guard case .cancelled? = outcome else { return XCTFail("expected a cancelled outcome, got \(String(describing: outcome))") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("film-b/\(PosterQueue.fileName)").path))
    }

    func testTheNewestRequestDecodesFirst() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        // A parked block holds the serial queue while both requests line up.
        let hold = DispatchSemaphore(value: 0)
        queue.queue.async { hold.wait() }
        var order: [String] = []
        let both = XCTestExpectation(description: "both posters")
        both.expectedFulfillmentCount = 2
        for itemId in ["film-a", "film-b"] {
            queue.request(itemId: itemId, inputUrl: clip.absoluteString, milliseconds: 2000) { _ in
                order.append(itemId)
                both.fulfill()
            }
        }
        hold.signal()
        wait(for: [both], timeout: 30)

        XCTAssertEqual(order, ["film-b", "film-a"], "the card that asked last is the one on screen")
    }

    func testACancelResolvesAPendingJobWithoutWaitingItsTurn() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        let hold = DispatchSemaphore(value: 0)
        queue.queue.async { hold.wait() }
        defer { hold.signal() }
        let done = XCTestExpectation(description: "cancelled")
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: "film-b", inputUrl: clip.absoluteString, milliseconds: 2000) {
            outcome = $0
            done.fulfill()
        }
        queue.cancel(itemId: "film-b")
        // The queue is still parked: the answer must not have waited for it.
        wait(for: [done], timeout: 2)

        guard case .cancelled? = outcome else { return XCTFail("expected a cancelled outcome, got \(String(describing: outcome))") }
    }

    func testARequestAfterACancelRunsAgain() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        queue.cancel(itemId: "film-a")
        guard case .poster? = settle(queue, "film-a", clip) else { return XCTFail("a stale cancel must not kill a fresh request") }
    }

    func testASourceWithoutVideoAnswersNothing() throws {
        let audio = try fixture("chapters-audio.m4a", ["-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "aac"])
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        guard case .none? = settle(queue, "song-a", audio) else { return XCTFail("expected no poster") }
    }

    func testRefusesAnIdThatIsNotAPlainToken() {
        let queue = PosterQueue(root: FileManager.default.temporaryDirectory)
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: "../escape", inputUrl: "file:///nowhere", milliseconds: 0) { outcome = $0 }
        guard case .none? = outcome else { return XCTFail("expected no poster") }
    }

    func testAPurgeCancelsTheJobQueuedBehindIt() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        // A parked block holds the serial queue, so the request is still waiting when the pool is purged.
        let hold = DispatchSemaphore(value: 0)
        queue.queue.async { hold.wait() }
        let done = XCTestExpectation(description: "poster")
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: "film-b", inputUrl: clip.absoluteString, milliseconds: 2000) {
            outcome = $0
            done.fulfill()
        }
        ChapterFramePool.purge(root: root)
        hold.signal()
        wait(for: [done], timeout: 15)

        guard case .cancelled? = outcome else { return XCTFail("expected a cancelled outcome, got \(String(describing: outcome))") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("film-b/\(PosterQueue.fileName)").path))
    }

    func testPauseParksTheWaitingBacklogAndUnpauseDrainsIt() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        // The serial queue is parked so the request is still waiting when the pause lands.
        let hold = DispatchSemaphore(value: 0)
        queue.queue.async { hold.wait() }
        let done = XCTestExpectation(description: "poster")
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: "film-a", inputUrl: clip.absoluteString, milliseconds: 2000) {
            outcome = $0
            done.fulfill()
        }
        queue.setPaused(true)
        hold.signal()
        Thread.sleep(forTimeInterval: 0.3)
        XCTAssertNil(outcome, "a parked job must not decode")

        queue.setPaused(false)
        wait(for: [done], timeout: 15)
        guard case .poster? = outcome else { return XCTFail("no poster after unpause, got \(String(describing: outcome))") }
    }

    func testARequestMadeWhilePausedStillRuns() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        queue.setPaused(true)
        guard case .poster? = settle(queue, "film-a", clip) else {
            return XCTFail("the player's own artwork must not wait behind the parked backlog")
        }
    }

    func testUnpauseDrainsNewestFirst() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        let hold = DispatchSemaphore(value: 0)
        queue.queue.async { hold.wait() }
        var order: [String] = []
        let both = XCTestExpectation(description: "both posters")
        both.expectedFulfillmentCount = 2
        for itemId in ["film-a", "film-b"] {
            queue.request(itemId: itemId, inputUrl: clip.absoluteString, milliseconds: 2000) { _ in
                order.append(itemId)
                both.fulfill()
            }
        }
        queue.setPaused(true)
        hold.signal()
        queue.setPaused(false)
        wait(for: [both], timeout: 30)

        XCTAssertEqual(order, ["film-b", "film-a"], "the backlog keeps its newest-first order across a pause")
    }

    func testCancelReachesAParkedJobAtOnce() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        let hold = DispatchSemaphore(value: 0)
        queue.queue.async { hold.wait() }
        let done = XCTestExpectation(description: "cancelled")
        var outcome: PosterQueue.Outcome?
        queue.request(itemId: "film-b", inputUrl: clip.absoluteString, milliseconds: 2000) {
            outcome = $0
            done.fulfill()
        }
        queue.setPaused(true)
        hold.signal()
        queue.cancel(itemId: "film-b")
        wait(for: [done], timeout: 2)
        queue.setPaused(false)

        guard case .cancelled? = outcome else { return XCTFail("expected a cancelled outcome, got \(String(describing: outcome))") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("film-b/\(PosterQueue.fileName)").path))
    }

    func testAPosterFoundInThePoolIsNotFresh() throws {
        let clip = try clip()
        let root = try scratchRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = PosterQueue(root: root)

        guard case .poster(_, let first)? = settle(queue, "film-a", clip) else { return XCTFail("no poster") }
        guard case .poster(_, let second)? = settle(queue, "film-a", clip) else { return XCTFail("no poster") }
        XCTAssertTrue(first)
        XCTAssertFalse(second)
    }
}
