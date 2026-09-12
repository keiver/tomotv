import Foundation
import XCTest
@testable import TomoEngine

final class RigProbeTests: XCTestCase {
    func testRigRecordings() throws {
        let cases: [(String, Int64)] = [
            ("http://localhost:8098/Videos/cb37a38d6714c1ebf24a9c702d060022/stream?Static=true&MediaSourceId=cb37a38d6714c1ebf24a9c702d060022&ApiKey=77667f7f54854d4c894446702c80337c", 59),
            ("http://localhost:8098/Videos/412408dfaba8e641b9a3be72ce845c1a/stream?Static=true&MediaSourceId=412408dfaba8e641b9a3be72ce845c1a&ApiKey=77667f7f54854d4c894446702c80337c", 10_000),
        ]
        for (url, ms) in cases {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("rigprobe-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let grabber = FrameGrabber(inputUrl: url, directory: dir)
            let started = Date()
            let alternatives = [1.5, 2, 2.5, 3].map { Int64(Double(ms) * $0) }
            let result = grabber.frame(atMilliseconds: ms, named: "poster.jpg", nearestFromStart: true, alternatives: alternatives, enhanced: true)
            let took = Date().timeIntervalSince(started)
            NSLog("RIGPROBE ms=%lld result=%@ decodes=%d took=%.2fs opened=%d", ms, result?.path ?? "nil", grabber.decodes, took, grabber.sourceOpened ? 1 : 0)
            grabber.stop()
        }
    }
}
