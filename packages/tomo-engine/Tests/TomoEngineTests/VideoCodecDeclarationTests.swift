import XCTest
@testable import TomoEngine

final class VideoCodecDeclarationTests: XCTestCase {
    private func box(_ type: String, _ payload: Data, extended: Bool = false) -> Data {
        let size = UInt64(payload.count + (extended ? 16 : 8))
        let header = extended ? Data([0, 0, 0, 1]) : Data((0..<4).reversed().map { UInt8(truncatingIfNeeded: size >> ($0 * 8)) })
        return header + Data(type.utf8) + (extended ? Data((0..<8).reversed().map { UInt8(truncatingIfNeeded: size >> ($0 * 8)) }) : Data()) + payload
    }

    private func initialization(_ type: String, configuration: String, bytes: Data, extended: Bool = false) -> Data {
        let entry = box(type, Data(repeating: 0, count: 78) + box(configuration, bytes))
        let descriptions = box("stsd", Data([0, 0, 0, 0, 0, 0, 0, 1]) + entry)
        return box("moov", box("trak", box("mdia", box("minf", box("stbl", descriptions)))), extended: extended)
    }

    private func hevc(profile: UInt8, compatibility: UInt8, constraints: [UInt8], level: UInt8) -> Data {
        Data([1, profile, compatibility, 0, 0, 0] + constraints + [level] + Array(repeating: 0, count: 10))
    }

    func testAvcProfilesAndConstraintsComeFromOutputNotAMetadataTable() {
        for (profile, constraints, level, expected) in [
            (UInt8(66), UInt8(192), UInt8(30), "avc1.42C01E"),
            (77, 64, 31, "avc1.4D401F"),
            (100, 0, 40, "avc1.640028"),
            (110, 16, 51, "avc1.6E1033"),
        ] {
            XCTAssertEqual(VideoCodecDeclaration.fromInit(initialization("avc1", configuration: "avcC", bytes: Data([1, profile, constraints, level, 255, 225, 0]))), expected)
        }
    }

    func testHevcMainMain10AndRangeExtensionsPreserveCompatibilityTierAndLevel() {
        for (profile, compatibility, constraints, level, expected) in [
            (UInt8(1), UInt8(0x60), [UInt8(0x80), 0, 0, 0, 0, 0], UInt8(93), "hvc1.1.6.L93.80"),
            (2, 0x20, [0xB0, 0, 0, 0, 0, 0], 153, "hvc1.2.4.L153.B0"),
            (0x63, 0x10, [0x80, 0, 2, 0, 0, 0], 156, "hvc1.A3.8.H156.80.0.2"),
            (1, 0x40, [0, 0, 0, 0, 0, 0], 120, "hvc1.1.2.L120"),
        ] {
            XCTAssertEqual(VideoCodecDeclaration.fromInit(initialization("hvc1", configuration: "hvcC", bytes: hevc(profile: profile, compatibility: compatibility, constraints: constraints, level: level))), expected)
        }
    }

    func testAv1UsesActualProfileTierAndBitDepth() {
        for (bytes, expected) in [
            ([UInt8(0x81), 8, 0, 0], "av01.0.08M.08"),
            ([0x81, 13, 0xC0, 0], "av01.0.13H.10"),
            ([0x81, 0x4D, 0x60, 0], "av01.2.13M.12"),
        ] {
            XCTAssertEqual(VideoCodecDeclaration.fromInit(initialization("av01", configuration: "av1C", bytes: Data(bytes))), expected)
        }
    }

    func testMalformedAndTruncatedConfigurationsNeverInventACodec() {
        for count in 0..<23 {
            XCTAssertNil(VideoCodecDeclaration.fromConfiguration(sampleEntry: "hvc1", box: "hvcC", data: Data(([1] + Array(repeating: UInt8(0), count: 22)).prefix(count))))
        }
        let valid = initialization("avc1", configuration: "avcC", bytes: Data([1, 100, 0, 40, 255, 225, 0]))
        for count in 0..<valid.count { XCTAssertNil(VideoCodecDeclaration.fromInit(Data(valid.prefix(count)))) }
        XCTAssertNil(VideoCodecDeclaration.fromInit(Data([0, 0, 0, 1]) + Data("moov".utf8) + Data(repeating: 255, count: 8)))
        XCTAssertNil(VideoCodecDeclaration.fromConfiguration(sampleEntry: "hvc1", box: "avcC", data: Data([1, 100, 0, 40, 255, 225, 0])))
    }

    func testExtendedSizeContainersAndDataSlices() {
        let valid = initialization("avc1", configuration: "avcC", bytes: Data([1, 100, 0, 40, 255, 225, 0]), extended: true)
        let prefixed = Data([99, 99]) + valid
        XCTAssertEqual(VideoCodecDeclaration.fromInit(prefixed.dropFirst(2)), "avc1.640028")
    }
}
