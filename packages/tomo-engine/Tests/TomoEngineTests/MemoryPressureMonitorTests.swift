import Foundation
import XCTest

@testable import TomoEngine

final class MemoryPressureMonitorTests: XCTestCase {
    func testCriticalNamesItselfEvenBesideWarning() {
        XCTAssertEqual(MemoryPressureMonitor.levelName(.critical), "critical")
        XCTAssertEqual(MemoryPressureMonitor.levelName([.warning, .critical]), "critical")
    }

    func testWarningAloneIsWarning() {
        XCTAssertEqual(MemoryPressureMonitor.levelName(.warning), "warning")
    }

    func testStartReturnsAnActivatedSourceWithoutFiring() {
        let source = MemoryPressureMonitor.start()
        XCTAssertFalse(source.isCancelled)
        source.cancel()
    }
}
