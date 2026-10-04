import Foundation
import XCTest

@testable import TomoEngine

/// A 10-bit HEVC source on a device whose encoder is 8-bit H.264: an Apple TV HD, which
/// decodes Main 10 in software only and has no 10-bit VideoToolbox path. The converter has
/// to land in nv12 itself; a p010 buffer on that device is the failure Grant reported.
final class TenBitSourceEightBitEncoderTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// x265 Main 10, the same shape as the DCPRip that failed: yuv420p10le in mkv.
    private static func fixture() -> URL? {
        let out = fixtureDir.appendingPathComponent("hevc-main10.mkv")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=1.5",
            "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=none",
            "-an", out.path,
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

    override func tearDown() {
        DeviceDecode.main10Override = nil
        super.tearDown()
    }

    private func benchmarkFixture() throws -> [String: Any] {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg); fixtures cannot be generated")
        }
        guard let url = Self.fixture() else { throw XCTSkip("libx265 produced no Main 10 fixture") }
        return VideoTranscoder.benchmark(inputUrl: url.path, wallSeconds: 1, encode: true)
    }

    func testTenBitSourceEncodesAsEightBitH264WhereTheDeviceHasNoMain10() throws {
        DeviceDecode.main10Override = false
        let result = try benchmarkFixture()
        XCTAssertNil(result["failed"], "pipeline failed: \(result["failed"] ?? "")")
        XCTAssertEqual(result["encoder"] as? String, "h264_videotoolbox")
        XCTAssertEqual(result["conversion"] as? String, "swscale", "yuv420p10le has no direct wrap; it must go through swscale into nv12")
        XCTAssertGreaterThan(result["frames"] as? Int ?? 0, 0, "no frame reached the 8-bit encoder")
    }

    func testTenBitSourceKeepsItsDepthWhereTheDeviceDecodesMain10() throws {
        guard DeviceDecode.hevcMain10 else { throw XCTSkip("host decodes no Main 10") }
        DeviceDecode.main10Override = true
        let result = try benchmarkFixture()
        XCTAssertNil(result["failed"], "pipeline failed: \(result["failed"] ?? "")")
        XCTAssertEqual(result["encoder"] as? String, "hevc_videotoolbox")
        XCTAssertGreaterThan(result["frames"] as? Int ?? 0, 0)
    }
}
