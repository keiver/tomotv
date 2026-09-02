import Foundation
import ImageIO
import XCTest
@testable import TomoEngine

/// The chapter keyframe path end to end on a generated clip: seek, decode, scale, JPEG, pool.
final class FrameGrabberTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    /// Cached under .build so a repeat run costs only the grab, not the encode.
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

    private func scratchDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("framegrab-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func pixelSize(_ url: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (width, height)
    }

    private func modified(_ url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }

    func testGrabsAScaledKeyframeOnceAndServesItFromTheDirectoryAfter() throws {
        let clip = try fixture("chapters-h264.mp4", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-an",
        ])
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        let first = try XCTUnwrap(grabber.frame(atMilliseconds: 7500))
        XCTAssertEqual(first.lastPathComponent, "7500.jpg")
        XCTAssertEqual(pixelSize(first)?.width, 480)
        XCTAssertEqual(pixelSize(first)?.height, 270)
        XCTAssertEqual(grabber.decodes, 1)

        let stamp = try XCTUnwrap(modified(first))
        Thread.sleep(forTimeInterval: 0.05)
        let again = try XCTUnwrap(grabber.frame(atMilliseconds: 7500))
        XCTAssertEqual(again, first)
        XCTAssertEqual(grabber.decodes, 1, "a second request is served from the file, not decoded again")
        XCTAssertGreaterThan(try XCTUnwrap(modified(again)), stamp, "a hit refreshes the file's date for the pool's eviction order")

        XCTAssertNotNil(grabber.frame(atMilliseconds: 0), "the first keyframe answers time zero")
        XCTAssertNil(grabber.frame(atMilliseconds: 60_000), "a time past the end has no frame")
        XCTAssertNil(grabber.frame(atMilliseconds: -1))
    }

    /// An index that keys no video entry while the audio entries are keyed: the demuxer refuses
    /// every backward seek. The shape of a VP6 AVI in the fixture library.
    private func unkeyedAvi() throws -> URL {
        let keyed = try fixture("chapters-keyed.avi", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
            "-c:v", "mpeg4", "-g", "25", "-c:a", "mp3", "-shortest",
        ])
        let out = Self.fixtureDir.appendingPathComponent("chapters-unkeyed.avi")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        var data = try Data(contentsOf: keyed)
        guard let idx = data.range(of: Data("idx1".utf8), options: .backwards) else { throw XCTSkip("no idx1 in the generated AVI") }
        let sizeAt = idx.upperBound
        let entries = Int(UInt32(data[sizeAt]) | UInt32(data[sizeAt + 1]) << 8 | UInt32(data[sizeAt + 2]) << 16 | UInt32(data[sizeAt + 3]) << 24) / 16
        for entry in 0 ..< entries {
            let base = sizeAt + 4 + entry * 16
            guard base + 16 <= data.count else { break }
            if data[base ..< base + 4] == Data("00dc".utf8) { data[base + 4] &= ~0x10 }
        }
        try data.write(to: out)
        return out
    }

    func testASourceThatRefusesTheSeekGivesAPosterFromItsStartAndNoChapterFrame() throws {
        let clip = try unkeyedAvi()
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        XCTAssertNil(grabber.frame(atMilliseconds: 13_500), "a chapter must not be answered with a frame from the wrong place")
        XCTAssertEqual(grabber.decodes, 0)

        let poster = try XCTUnwrap(grabber.frame(atMilliseconds: 13_500, named: "poster.jpg", nearestFromStart: true))
        XCTAssertEqual(poster.lastPathComponent, "poster.jpg")
        XCTAssertEqual(pixelSize(poster)?.width, 480)
        XCTAssertEqual(grabber.decodes, 1)
    }

    func testAudioOnlySourceAnswersNothing() throws {
        let clip = try fixture("chapters-audio.m4a", [
            "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "aac",
        ])
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        XCTAssertNil(grabber.frame(atMilliseconds: 1000))
    }

    func testMissingSourceAnswersNothingWithoutRetrying() throws {
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: "file:///nonexistent/clip.mkv", directory: dir)
        defer { grabber.stop() }

        XCTAssertNil(grabber.frame(atMilliseconds: 1000))
        XCTAssertNil(grabber.frame(atMilliseconds: 2000))
    }

    func testPoolTrimsOldestFramesFirstAndDropsEmptiedItems() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let fm = FileManager.default
        func seed(_ item: String, _ name: String, bytes: Int, age: TimeInterval) throws -> URL {
            let dir = root.appendingPathComponent(item, isDirectory: true)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(name)
            try Data(repeating: 0, count: bytes).write(to: url)
            try fm.setAttributes([.modificationDate: Date().addingTimeInterval(-age)], ofItemAtPath: url.path)
            return url
        }
        let oldest = try seed("film-a", "1000.jpg", bytes: 4000, age: 300)
        let older = try seed("film-a", "2000.jpg", bytes: 4000, age: 200)
        let newer = try seed("film-b", "1000.jpg", bytes: 4000, age: 100)
        let newest = try seed("film-c", "1000.jpg", bytes: 4000, age: 0)

        ChapterFramePool.trim(toBytes: 9000, root: root)

        XCTAssertFalse(fm.fileExists(atPath: oldest.path))
        XCTAssertFalse(fm.fileExists(atPath: older.path))
        XCTAssertTrue(fm.fileExists(atPath: newer.path))
        XCTAssertTrue(fm.fileExists(atPath: newest.path))
        XCTAssertFalse(fm.fileExists(atPath: root.appendingPathComponent("film-a").path), "an item left empty goes with its frames")
    }

    func testPoolTrimLeavesAnEmptyDirectoryItDidNotEmpty() throws {
        // The race the simulator hit: the item directory is created, a trim is scheduled, and the
        // first frame has not been written yet. The trim must not take the directory away.
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let fresh = root.appendingPathComponent("film-new", isDirectory: true)
        try FileManager.default.createDirectory(at: fresh, withIntermediateDirectories: true)

        ChapterFramePool.trim(toBytes: 0, root: root)

        XCTAssertTrue(FileManager.default.fileExists(atPath: fresh.path))
    }

    func testPoolRefusesAnIdThatIsNotAPlainToken() {
        XCTAssertNil(ChapterFramePool.directory(for: "../escape"))
        XCTAssertNil(ChapterFramePool.directory(for: ""))
    }
}
