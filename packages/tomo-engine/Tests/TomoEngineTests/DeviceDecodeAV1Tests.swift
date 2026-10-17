import Libavcodec
import XCTest

@testable import TomoEngine

/// AV1 is copied only as Main profile on AV1 hardware: on an iPhone 17 Pro, High (4:4:4, RGB)
/// and Professional (12-bit) copies failed with Cannot Decode while every Main stream played.
final class DeviceDecodeAV1Tests: XCTestCase {
    func testMainProfileCopiesOnAV1Hardware() {
        XCTAssertTrue(DeviceDecode.av1Copies(profile: Int32(AV_PROFILE_AV1_MAIN), hardware: true))
    }

    func testHighAndProfessionalReencodeOnAV1Hardware() {
        XCTAssertFalse(DeviceDecode.av1Copies(profile: Int32(AV_PROFILE_AV1_HIGH), hardware: true))
        XCTAssertFalse(DeviceDecode.av1Copies(profile: Int32(AV_PROFILE_AV1_PROFESSIONAL), hardware: true))
    }

    func testUnknownProfileReencodes() {
        XCTAssertFalse(DeviceDecode.av1Copies(profile: Int32(AV_PROFILE_UNKNOWN), hardware: true))
    }

    func testMainProfileReencodesWithoutAV1Hardware() {
        XCTAssertFalse(DeviceDecode.av1Copies(profile: Int32(AV_PROFILE_AV1_MAIN), hardware: false))
    }
}
