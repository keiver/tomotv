import Foundation
import ImageIO
import XCTest
@testable import TomoEngine

/// The chapter keyframe path end to end on a generated clip: seek, decode, scale, PNG, cache.
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

        let first = try XCTUnwrap(grabber.png(atMilliseconds: 7500))
        XCTAssertEqual(first.lastPathComponent, "frame-7500.png")
        XCTAssertEqual(pixelSize(first)?.width, 480)
        XCTAssertEqual(pixelSize(first)?.height, 270)

        let stamp = try XCTUnwrap(modified(first))
        Thread.sleep(forTimeInterval: 0.05)
        let again = try XCTUnwrap(grabber.png(atMilliseconds: 7500))
        XCTAssertEqual(again, first)
        XCTAssertEqual(modified(again), stamp, "a second request must be served from the file, not decoded again")

        XCTAssertNotNil(grabber.png(atMilliseconds: 0), "the first keyframe answers time zero")
        XCTAssertNil(grabber.png(atMilliseconds: 60_000), "a time past the end has no frame")
        XCTAssertNil(grabber.png(atMilliseconds: -1))
    }

    func testAudioOnlySourceAnswersNothing() throws {
        let clip = try fixture("chapters-audio.m4a", [
            "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "aac",
        ])
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: clip.absoluteString, directory: dir)
        defer { grabber.stop() }

        XCTAssertNil(grabber.png(atMilliseconds: 1000))
    }

    func testMissingSourceAnswersNothingWithoutRetrying() throws {
        let dir = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let grabber = FrameGrabber(inputUrl: "file:///nonexistent/clip.mkv", directory: dir)
        defer { grabber.stop() }

        XCTAssertNil(grabber.png(atMilliseconds: 1000))
        XCTAssertNil(grabber.png(atMilliseconds: 2000))
    }
}
