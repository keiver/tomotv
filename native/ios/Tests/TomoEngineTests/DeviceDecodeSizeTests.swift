import Foundation
import Libavformat
import XCTest

@testable import TomoEngine

/// The copy decision is a hardware decode at the stream's own size. Measured on this host:
/// VideoToolbox opens 1920x1080 H.264 and refuses 8192x4320 once hardware is required.
final class DeviceDecodeSizeTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// One grey x264 frame at the given size, in mp4 so the stream carries an avcC record.
    private static func fixture(_ size: String) -> URL? {
        let out = fixtureDir.appendingPathComponent("h264-\(size).mp4")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=gray:size=\(size):rate=24", "-frames:v", "1",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", out.path,
        ]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: out.path) else {
            try? FileManager.default.removeItem(at: out)
            return nil
        }
        return out
    }

    private func decodes(_ size: String) throws -> Bool {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        guard let url = Self.fixture(size) else { throw XCTSkip("libx264 produced no \(size) fixture") }
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, url.path, nil, nil) == 0, let ctx else { throw XCTSkip("could not open \(url.path)") }
        defer { var c: UnsafeMutablePointer<AVFormatContext>? = ctx; avformat_close_input(&c) }
        guard avformat_find_stream_info(ctx, nil) >= 0, let stream = ctx.pointee.streams[0] else { throw XCTSkip("no stream in \(url.path)") }
        return DeviceDecode.canDecode(stream: stream)
    }

    func testHostDecodesH264InHardware() {
        XCTAssertTrue(DeviceDecode.h264)
    }

    func testFullHdH264IsCopied() throws {
        XCTAssertTrue(try decodes("1920x1080"))
    }

    func testH264BeyondTheHardwareDecoderIsNotCopied() throws {
        guard #available(macOS 10.9, *) else { throw XCTSkip("no hardware requirement below iOS/tvOS 17") }
        XCTAssertFalse(try decodes("8192x4320"))
    }
}
