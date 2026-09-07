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

    /// Mean red, green and blue of the written picture, 0 to 255.
    private func meanColor(_ url: URL) -> (r: Double, g: Double, b: Double)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        let w = image.width, h = image.height
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        guard let context = CGContext(data: &rgba, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var sum = (r: 0.0, g: 0.0, b: 0.0)
        for i in stride(from: 0, to: rgba.count, by: 4) {
            sum.r += Double(rgba[i]); sum.g += Double(rgba[i + 1]); sum.b += Double(rgba[i + 2])
        }
        let n = Double(w * h)
        return (sum.r / n, sum.g / n, sum.b / n)
    }

    private func meanLuma(_ url: URL) -> Double? {
        meanColor(url).map { 0.2126 * $0.r + 0.7152 * $0.g + 0.0722 * $0.b }
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
        XCTAssertTrue(grabber.sourceOpened, "a file with no video did open; the poster queue tells the two apart")
    }

    func testMissingSourceAnswersNothingWithoutRetrying() throws {
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: "file:///nonexistent/clip.mkv", directory: dir)
        defer { grabber.stop() }

        XCTAssertNil(grabber.frame(atMilliseconds: 1000))
        XCTAssertNil(grabber.frame(atMilliseconds: 2000))
        XCTAssertFalse(grabber.sourceOpened)
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

    func testAWriteTrimsThePoolBehindIt() throws {
        let clip = try fixture("chapters-h264.mp4", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-an",
        ])
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let fm = FileManager.default
        // A pool just under the cap, with an hour-old frame as the one to go.
        let old = root.appendingPathComponent("film-old", isDirectory: true)
        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        let filler = old.appendingPathComponent("1000.jpg")
        try Data(count: Int(ChapterFramePool.capBytes) - 1024).write(to: filler)
        try fm.setAttributes([.modificationDate: Date().addingTimeInterval(-3600)], ofItemAtPath: filler.path)
        guard let dir = ChapterFramePool.directory(for: "film-new", in: root) else { return XCTFail("no directory") }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir, pool: root)
        defer { grabber.stop() }

        XCTAssertNotNil(grabber.frame(atMilliseconds: 2000))

        let deadline = Date().addingTimeInterval(5)
        while fm.fileExists(atPath: filler.path), Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        XCTAssertFalse(fm.fileExists(atPath: filler.path), "the write left the pool over the cap")
        XCTAssertTrue(fm.fileExists(atPath: dir.appendingPathComponent("2000.jpg").path), "the frame just written is the newest and stays")
    }

    func testAGrabberOutlivingAPurgeAnswersNothing() throws {
        let clip = try fixture("chapters-h264.mp4", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-an",
        ])
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        guard let dir = ChapterFramePool.directory(for: "film-a", in: root) else { return XCTFail("no directory") }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir, pool: root)
        defer { grabber.stop() }

        // The app switched server while this provider was alive: its source belongs to the old pool.
        ChapterFramePool.purge(root: root)

        XCTAssertNil(grabber.frame(atMilliseconds: 2000))
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2000.jpg").path))
    }

    func testAnAnamorphicSourceIsWrittenAtItsDisplayShape() throws {
        // 720x480 with a 32:27 sample aspect ratio displays as 16:9.
        let clip = try fixture("chapters-anamorphic.mp4", [
            "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=25:duration=4",
            "-vf", "setsar=32/27", "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-an",
        ])
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        guard let url = grabber.frame(atMilliseconds: 1000) else { return XCTFail("no frame") }
        let size = pixelSize(url)
        XCTAssertEqual(size?.width, 480)
        XCTAssertEqual(size?.height, 270)
    }

    func testAPosterMovesPastAWhiteFrameWhileAChapterKeepsIt() throws {
        // Keyframes land at 1.8 s (white starts) and 2.64 s (white ends): the seek to 2 s finds white.
        let clip = try fixture("chapters-flash.mp4", [
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20",
            "-vf", "drawbox=c=white:t=fill:enable='between(t,1.8,2.6)'",
            "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-an",
        ])
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        let chapter = try XCTUnwrap(grabber.frame(atMilliseconds: 2000))
        XCTAssertGreaterThan(try XCTUnwrap(meanLuma(chapter)), 230, "a chapter shows its own frame, fade or not")

        let poster = try XCTUnwrap(grabber.frame(atMilliseconds: 2000, named: "poster.jpg", alternatives: [3000, 4000]))
        XCTAssertLessThan(try XCTUnwrap(meanLuma(poster)), 200, "the poster moves on from the white frame")
        XCTAssertEqual(grabber.decodes, 2, "one write per request; the rejected candidate is not kept")
    }

    func testAnUntaggedHdFrameDecodesWithTheBt709Matrix() throws {
        // A flat colour encoded through BT.709 at 720p with the tag stripped. Read back through
        // BT.601 the red comes out 15 levels low and the green 14 low.
        let clip = try fixture("chapters-hd-untagged.mp4", [
            "-f", "lavfi", "-i", "color=c=0xC03020:size=1280x720:rate=25:duration=1",
            "-vf", "scale=out_color_matrix=bt709,setparams=colorspace=unknown,format=yuv420p",
            "-c:v", "libx264", "-g", "25", "-an",
        ])
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        let color = try XCTUnwrap(meanColor(try XCTUnwrap(grabber.frame(atMilliseconds: 500))))
        XCTAssertEqual(color.r, 0xC0, accuracy: 6)
        XCTAssertEqual(color.g, 0x30, accuracy: 6)
        XCTAssertEqual(color.b, 0x20, accuracy: 6)
    }

    func testFrameScoreReadsLumaAndContrast() {
        let w = 8, h = 8
        var flat = Data(count: w * h * 4)
        for i in stride(from: 0, to: flat.count, by: 4) { flat[i] = 200; flat[i + 1] = 200; flat[i + 2] = 200; flat[i + 3] = 255 }
        let white = FrameScore(rgba: flat, width: w, height: h, stride: 1)
        XCTAssertEqual(white.luma, 200, accuracy: 0.01)
        XCTAssertEqual(white.contrast, 0, accuracy: 0.01)
        XCTAssertFalse(white.isUsable, "a flat bright frame is a fade or a white")

        var split = Data(count: w * h * 4)
        for i in stride(from: 0, to: split.count, by: 4) where (i / 4) % w >= w / 2 { split[i] = 160; split[i + 1] = 160; split[i + 2] = 160 }
        let scene = FrameScore(rgba: split, width: w, height: h, stride: 1)
        XCTAssertEqual(scene.luma, 80, accuracy: 0.01)
        XCTAssertEqual(scene.contrast, 80, accuracy: 0.01)
        XCTAssertTrue(scene.isUsable)
    }
}
