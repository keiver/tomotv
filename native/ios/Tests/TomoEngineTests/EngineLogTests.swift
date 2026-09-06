import Foundation
import Libavutil
import VideoToolbox
import XCTest
@testable import TomoEngine

/// The two claims EngineLog makes: libav's floor is the level the engine meant, and a probe
/// status is named after the VTErrors.h constant it actually is.
final class EngineLogTests: XCTestCase {

    /// AV_LOG_ERROR is a plain #define that does not import into Swift, so EngineLog carries
    /// the number itself and this is what pins it: AV_LOG_WARNING (24) would let the muxer's
    /// per-session warnings back into the console, AV_LOG_FATAL (8) would swallow errors
    /// worth reading.
    ///
    /// Reads the level without setting it to anything else: configure() applies once per
    /// process and nothing else in the package touches the floor, so this holds whether or
    /// not another test's engine work already ran it.
    func testConfigureSetsLibavFloorToError() {
        EngineLog.configure()
        XCTAssertEqual(EngineLog.errorLevel, 16)
        XCTAssertEqual(av_log_get_level(), EngineLog.errorLevel)
    }

    /// Each name is checked against the SDK constant rather than a copied number, so a
    /// mistyped code or a swapped pair fails here instead of mislabelling a probe result.
    func testStatusNamesMatchTheVideoToolboxConstants() {
        XCTAssertEqual(EngineLog.vtStatus(noErr), "ok")
        XCTAssertEqual(EngineLog.vtStatus(kVTCouldNotFindVideoDecoderErr), "no decoder (-12906)")
        XCTAssertEqual(EngineLog.vtStatus(kVTVideoDecoderBadDataErr), "bad data (-12909)")
        XCTAssertEqual(EngineLog.vtStatus(kVTVideoDecoderUnsupportedDataFormatErr), "unsupported format (-12910)")
        XCTAssertEqual(EngineLog.vtStatus(kVTCouldNotCreateInstanceErr), "no instance (-12907)")
        XCTAssertEqual(EngineLog.vtStatus(kVTVideoDecoderNotAvailableNowErr), "decoder busy (-12913)")
        XCTAssertEqual(EngineLog.vtStatus(kVTParameterErr), "bad parameter (-12902)")
    }

    /// The numbers in those names are the point: a reader greps the log for the code Apple
    /// printed, so the parenthesised value must be the status itself.
    func testEachNameCarriesItsOwnStatusNumber() {
        for status in [kVTCouldNotFindVideoDecoderErr, kVTVideoDecoderBadDataErr,
                       kVTVideoDecoderUnsupportedDataFormatErr, kVTCouldNotCreateInstanceErr,
                       kVTVideoDecoderNotAvailableNowErr, kVTParameterErr] {
            XCTAssertTrue(EngineLog.vtStatus(status).hasSuffix("(\(status))"),
                          "\(EngineLog.vtStatus(status)) does not carry \(status)")
        }
    }

    /// An unmapped status still says what it was, so a code this switch has never seen
    /// reaches the log as a number rather than as silence.
    func testUnmappedStatusReportsItsNumber() {
        XCTAssertEqual(EngineLog.vtStatus(-99999), "status -99999")
    }
}
