import XCTest

@testable import TomoLiveSources

final class GunzipTests: XCTestCase {
    private let text = Array(String(repeating: "<programme>Gunzip test payload</programme>\n", count: 400).utf8)

    func testInflatesConcatenatedMembersInAnyChunking() throws {
        let half = text.count / 2
        let gz = Fixture.gzip(Array(text[..<half])) + Fixture.gzip(Array(text[half...]))
        for chunks in [[1], [3], [7, 13, 1], [1 << 20]] {
            XCTAssertEqual(try Fixture.inflate(gz, chunks: chunks), text, "chunks \(chunks)")
        }
    }

    func testPassesPlainInputThrough() throws {
        XCTAssertEqual(try Fixture.inflate(text, chunks: [5]), text)
        XCTAssertEqual(try Fixture.inflate([0x3C], chunks: [1]), [0x3C])
        XCTAssertEqual(try Fixture.inflate([0x1F], chunks: [1]), [0x1F])
        XCTAssertEqual(try Fixture.inflate([], chunks: [1]), [])
    }

    func testRefusesATruncatedStream() {
        let gz = Fixture.gzip(text)
        XCTAssertThrowsError(try Fixture.inflate(Array(gz[..<(gz.count - 12)]), chunks: [64])) { error in
            XCTAssertEqual(error as? Gunzip.Failure, .truncated)
        }
    }

    func testRefusesCorruptDeflateData() {
        var gz = Fixture.gzip(text)
        for index in stride(from: 20, to: gz.count - 12, by: 7) { gz[index] ^= 0xA5 }
        XCTAssertThrowsError(try Fixture.inflate(gz, chunks: [512]))
    }

    func testIgnoresPaddingAfterTheLastMember() throws {
        let gz = Fixture.gzip(text) + [UInt8](repeating: 0, count: 1024)
        XCTAssertEqual(try Fixture.inflate(gz, chunks: [100]), text)
        XCTAssertEqual(try Fixture.inflate(gz, chunks: [1]), text)
    }

    func testRandomPayloadsRoundTripUnderRandomSplits() throws {
        var random = SplitMix64(state: 42)
        for trial in 0 ..< 24 {
            let size = Int.random(in: 0 ... 600_000, using: &random)
            // Half compressible text, half raw noise, which deflate stores rather than compresses.
            let payload: [UInt8] = trial.isMultiple(of: 2)
                ? (0 ..< size).map { _ in UInt8.random(in: 97 ... 102, using: &random) }
                : (0 ..< size).map { _ in UInt8.random(in: 0 ... 255, using: &random) }
            let chunks = (0 ..< 8).map { _ in Int.random(in: 1 ... 70_000, using: &random) }
            XCTAssertEqual(try Fixture.inflate(Fixture.gzip(payload), chunks: chunks), payload, "trial \(trial) size \(size)")
        }
    }

    func testCountsInflatedBytes() throws {
        let gunzip = Gunzip()
        try Fixture.gzip(text).withUnsafeBytes { try gunzip.push($0) { _ in } }
        try gunzip.finish { _ in }
        XCTAssertEqual(gunzip.inflatedBytes, text.count)
    }
}
