import AudioToolbox
import Foundation
import XCTest

@testable import TomoEngine

/// Apple's ADTS parser against the host ffmpeg's AudioToolbox encoder: the setup it returns per
/// profile, from the start and from a join in the middle of the stream.
final class AdtsConfigReaderTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"

    /// ADTS frames of a 4 s stereo 48 kHz tone at one AAC profile (2 LC, 4 HE-AAC, 28 HE-AACv2).
    private func adtsFrames(profile: Int) throws -> [[UInt8]] {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("adts-\(profile)-\(UUID().uuidString).aac")
        defer { try? FileManager.default.removeItem(at: out) }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                       "-c:a", "aac_at", "-profile:a", "\(profile)", "-b:a", "64k", "-ar", "48000", "-ac", "2", "-f", "adts", out.path]
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0, let data = try? Data(contentsOf: out) else { throw XCTSkip("ffmpeg could not encode profile \(profile)") }
        let bytes = [UInt8](data)
        var frames: [[UInt8]] = []
        var at = 0
        while at + 7 <= bytes.count {
            let length = (Int(bytes[at + 3] & 0x03) << 11) | (Int(bytes[at + 4]) << 3) | (Int(bytes[at + 5]) >> 5)
            guard length > 7, at + length <= bytes.count else { break }
            frames.append(Array(bytes[at..<(at + length)]))
            at += length
        }
        return frames
    }

    private func read(_ frames: ArraySlice<[UInt8]>) -> (config: AdtsConfig?, fed: Int) {
        guard let reader = AdtsConfigReader() else { return (nil, 0) }
        for frame in frames {
            if let config = frame.withUnsafeBufferPointer({ reader.feed($0.baseAddress!, count: $0.count) }) { return (config, reader.framesFed) }
        }
        return (nil, reader.framesFed)
    }

    private func hex(_ data: Data?) -> String { data.map { $0.map { String(format: "%02x", $0) }.joined(separator: " ") } ?? "none" }

    func testLowComplexityGivesTheTwoByteConfigAndNoLayerBelow() throws {
        let frames = try adtsFrames(profile: 2)
        let (config, fed) = read(frames[...])
        XCTAssertEqual(hex(config?.audioSpecificConfig), "11 90")
        XCTAssertEqual(config?.richest, kAudioFormatMPEG4AAC)
        XCTAssertEqual(config?.codecs, "mp4a.40.2")
        XCTAssertEqual(config?.coreSampleRate, 48000)
        XCTAssertEqual(config?.coreChannels, 2)
        XCTAssertLessThanOrEqual(fed, 2)
    }

    func testHeAacGivesExplicitSbrSignalingOverAStereoCoreAtHalfTheRate() throws {
        let frames = try adtsFrames(profile: 4)
        let (config, fed) = read(frames[...])
        XCTAssertEqual(hex(config?.audioSpecificConfig), "13 10 56 e5 98")
        XCTAssertEqual(config?.richest, kAudioFormatMPEG4AAC_HE)
        XCTAssertEqual(config?.codecs, "mp4a.40.5")
        XCTAssertEqual(config?.coreSampleRate, 24000)
        XCTAssertEqual(config?.coreChannels, 2)
        XCTAssertLessThanOrEqual(fed, 2)
    }

    func testHeAacV2GivesParametricStereoSignalingOverAMonoCore() throws {
        let frames = try adtsFrames(profile: 28)
        let (config, fed) = read(frames[...])
        XCTAssertEqual(hex(config?.audioSpecificConfig), "13 08 56 e5 9d 48 80")
        XCTAssertEqual(config?.richest, kAudioFormatMPEG4AAC_HE_V2)
        XCTAssertEqual(config?.codecs, "mp4a.40.29")
        XCTAssertEqual(config?.coreSampleRate, 24000)
        XCTAssertEqual(config?.coreChannels, 1)
        XCTAssertLessThanOrEqual(fed, 2)
    }

    func testAJoinInTheMiddleOfAnHeAacStreamGivesTheSameSetup() throws {
        let frames = try adtsFrames(profile: 4)
        for start in [1, 17, 40, frames.count - 3] {
            let (config, fed) = read(frames[start...])
            XCTAssertEqual(hex(config?.audioSpecificConfig), "13 10 56 e5 98", "from frame \(start)")
            XCTAssertLessThanOrEqual(fed, 2, "from frame \(start)")
        }
    }

    func testAFrameThatIsNotAdtsGivesNothing() {
        let junk = [UInt8](repeating: 0x00, count: 64)
        let (config, fed) = read([junk, junk, junk][...])
        XCTAssertNil(config)
        XCTAssertEqual(fed, 3)
    }

    func testTheDecoderSpecificInfoIsUnwrappedFromApplesDescriptor() {
        let cookie: [UInt8] = [0x03, 0x80, 0x80, 0x80, 0x25, 0x00, 0x00, 0x00, 0x04, 0x80, 0x80, 0x80, 0x17, 0x40, 0x14, 0x00, 0x18,
                               0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x80, 0x80, 0x80, 0x05, 0x13, 0x10, 0x56,
                               0xe5, 0x98, 0x06, 0x80, 0x80, 0x80, 0x01, 0x02]
        XCTAssertEqual(hex(AdtsConfigReader.decoderSpecificInfo(Data(cookie))), "13 10 56 e5 98")
        XCTAssertEqual(hex(AdtsConfigReader.decoderSpecificInfo(Data([0x03, 0x02, 0x00, 0x00]))), "none")
        let dependent: [UInt8] = [0x03, 0x18, 0x00, 0x01, 0x80, 0x12, 0x34, 0x04, 0x11, 0x40, 0x15] + [UInt8](repeating: 0, count: 11) + [0x05, 0x02, 0x11, 0x90]
        XCTAssertEqual(hex(AdtsConfigReader.decoderSpecificInfo(Data(dependent))), "11 90", "an ES_Descriptor with a stream dependence")
    }
}
