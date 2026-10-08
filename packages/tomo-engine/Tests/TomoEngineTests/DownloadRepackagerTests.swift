import XCTest

@testable import TomoEngine

/// The rewrap deletes its source once it succeeds, so it must never write an MP4 missing a track.
final class DownloadRepackagerTests: XCTestCase {
    private func fixture(_ name: String) -> String {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/\(name)").path
    }

    private func output() -> String {
        FileManager.default.temporaryDirectory.appendingPathComponent("rewrap-\(UUID().uuidString).mp4").path
    }

    /// AAC copies into MP4 and FLAC is not on the copy list: the file keeps both, unwrapped.
    func testAFileWithATrackMp4CannotCarryIsDeclinedForGood() throws {
        let out = output()
        defer { try? FileManager.default.removeItem(atPath: out) }
        XCTAssertThrowsError(try DownloadRepackager.run(inputPath: fixture("two-audio.mkv"), outputPath: out, isCancelled: { false }, progress: { _ in })) { error in
            guard case DownloadRepackager.Failure.declined(let reason, let permanent) = error else { return XCTFail("expected a decline, got \(error)") }
            XCTAssertTrue(permanent, "the file will never allow it, so the sweep stops offering it")
            XCTAssertEqual(reason, "audio stream 2 cannot be copied into MP4")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: out), "nothing was written")
    }

    /// A file whose every track copies still rewraps.
    func testAFileWhoseTracksAllCopyIsRewrapped() throws {
        let out = output()
        defer { try? FileManager.default.removeItem(atPath: out) }
        let report = try DownloadRepackager.run(inputPath: fixture("tier-segment.mpegts"), outputPath: out, isCancelled: { false }, progress: { _ in })
        XCTAssertEqual(report.droppedAudioIndices, [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: out))
    }
}
