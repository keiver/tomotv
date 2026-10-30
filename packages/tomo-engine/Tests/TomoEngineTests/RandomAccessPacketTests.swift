import Foundation
import XCTest
@testable import TomoEngine

final class RandomAccessPacketTests: XCTestCase {
    private func opens(_ bytes: [UInt8], hevc: Bool, lengthSize: Int? = 4) -> Bool {
        bytes.withUnsafeBytes { RandomAccessPacket.opens($0, hevc: hevc, lengthSize: lengthSize) }
    }

    /// A length-prefixed NAL: `type` is the H.264 nal_unit_type, or the HEVC type in the header's high bits.
    private func nal(_ type: UInt8, hevc: Bool, payload: Int = 3, lengthSize: Int = 4) -> [UInt8] {
        let header: [UInt8] = hevc ? [type << 1, 1] : [type]
        let length = header.count + payload
        let prefix = (0 ..< lengthSize).map { UInt8((length >> (8 * (lengthSize - 1 - $0))) & 0xFF) }
        return prefix + header + [UInt8](repeating: 0x55, count: payload)
    }

    func testAnH264PacketOpeningOnAnIdrSliceIsAKeyframe() {
        XCTAssertTrue(opens(nal(9, hevc: false) + nal(6, hevc: false) + nal(5, hevc: false), hevc: false))
        XCTAssertFalse(opens(nal(9, hevc: false) + nal(1, hevc: false), hevc: false))
        XCTAssertFalse(opens(nal(7, hevc: false) + nal(8, hevc: false), hevc: false), "parameter sets alone decide nothing")
    }

    func testAnHevcPacketOpeningOnAnyIrapIsAKeyframe() {
        for irap: UInt8 in 16...21 {
            XCTAssertTrue(opens(nal(32, hevc: true) + nal(33, hevc: true) + nal(34, hevc: true) + nal(39, hevc: true) + nal(irap, hevc: true), hevc: true), "type \(irap)")
        }
        XCTAssertFalse(opens(nal(1, hevc: true), hevc: true), "TRAIL_R")
        XCTAssertFalse(opens(nal(35, hevc: true) + nal(8, hevc: true), hevc: true), "AUD then RASL")
    }

    func testTheLengthPrefixComesFromTheCallerNotTheBytes() {
        XCTAssertTrue(opens(nal(5, hevc: false, lengthSize: 2), hevc: false, lengthSize: 2))
        XCTAssertFalse(opens(nal(5, hevc: false, lengthSize: 2), hevc: false, lengthSize: 4), "a 4-byte read of a 2-byte prefix is not a keyframe")
        // A 261-byte P slice: its 4-byte prefix reads 00 00 01 05, which is not a start code before an IDR.
        XCTAssertFalse(opens(nal(1, hevc: false, payload: 260), hevc: false, lengthSize: 4))
        XCTAssertFalse(opens(nal(1, hevc: true, payload: 292), hevc: true, lengthSize: 4))
        XCTAssertFalse(opens([0, 0, 0, 0], hevc: false), "a zero length ends the walk")
    }

    func testAnnexBPacketsAreWalkedByStartCode() {
        let annexB: [UInt8] = [0, 0, 0, 1, 9, 0xF0, 0, 0, 1, 7, 0x42, 0, 0, 1, 5, 0x88]
        XCTAssertTrue(opens(annexB, hevc: false, lengthSize: nil))
        let hevcIdr: [UInt8] = [0, 0, 0, 1, 0x40, 1, 0x0C, 0, 0, 1, 0x26, 1, 0xAF]
        XCTAssertTrue(opens(hevcIdr, hevc: true, lengthSize: nil), "VPS then IDR_W_RADL")
        let trailing: [UInt8] = [0, 0, 1, 0x02, 1, 0xAF, 0, 0, 0, 1, 0x02, 1, 0xAF]
        XCTAssertFalse(opens(trailing, hevc: true, lengthSize: nil), "TRAIL_R")
        XCTAssertFalse(opens([0, 0, 1, 5, 0x88], hevc: false, lengthSize: 4), "length-prefixed bytes that look like a start code")
    }
}
