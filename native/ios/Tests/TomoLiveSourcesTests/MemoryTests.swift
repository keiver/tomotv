import XCTest

@testable import TomoLiveSources

/// Repeated loads of the real fixtures: live heap bytes stay flat and `leaks` finds nothing. The
/// footprint is reported, not asserted: freed pages stay dirty in the allocator. Run one test per process.
final class MemoryTests: XCTestCase {
    private let mb = 1_048_576

    func testRepeatedGuideLoadsRetainNothing() throws {
        let data = try Fixture.realGuide()
        try cycles(5) {
            let store = GuideStore()
            let stats = try GuideLoader.parse(data: data, window: nil, store: store)
            XCTAssertEqual(store.programmeCount, 79138)
            return stats.load
        }
    }

    func testRepeatedPlaylistLoadsRetainNothing() throws {
        let data = try Fixture.realPlaylist()
        try cycles(5) {
            let store = PlaylistStore()
            let stats = try PlaylistLoader.parse(data: data, store: store)
            XCTAssertEqual(stats.entries, 10919)
            return stats.load
        }
    }

    /// The URL path (loader, session, bridge-style completion) frees each cycle's store on close.
    func testRepeatedGuideUrlLoadsRetainNothing() throws {
        let data = try Fixture.realGuide()
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("guide-cycle-\(UUID().uuidString).xml.gz")
        try data.write(to: file)
        addTeardownBlock { try? FileManager.default.removeItem(at: file) }
        try cycles(5) {
            var result: Result<GuideStats, Error>?
            let done = expectation(description: "load")
            let loader = GuideLoader.load(url: file, window: nil, store: GuideStore()) {
                result = $0
                done.fulfill()
            }
            wait(for: [done], timeout: 60)
            _ = loader
            let stats = try result!.get()
            XCTAssertEqual(stats.programmes, 79138)
            return stats.load
        }
    }

    /// The parser's own working set, with nothing retained, is bounded regardless of guide size.
    func testStreamingParseWithoutAStoreStaysSmall() throws {
        let data = try Fixture.realGuide()
        let parser = XmltvParser()
        var count = 0
        parser.onProgramme = { _ in count += 1 }
        let gunzip = Gunzip()
        let before = MemoryFootprint.bytes()
        var peak = before
        try Fixture.split(Array(data), [65536]) {
            try gunzip.push($0) { parser.push($0) }
            peak = max(peak, MemoryFootprint.bytes())
        }
        try gunzip.finish { parser.push($0) }
        parser.finish()
        print(String(format: "store-less parse: peak growth %.1f MB over %d programmes", Double(peak - before) / Double(mb), count))
        XCTAssertEqual(count, 79138)
        XCTAssertLessThan(peak - before, 16 * mb)
    }

    /// Runs `body` `count` times; after the first cycle the live heap may grow by at most 1 MB,
    /// and the cycles may add no leaked bytes over what the process carried in.
    private func cycles(_ count: Int, _ body: () throws -> LoadStats) throws {
        let leakedBefore = try leakedBytes()
        var liveAfterFirst = 0
        for cycle in 0 ..< count {
            let stats = try autoreleasepool(invoking: body)
            let live = try liveHeapBytes()
            if cycle == 0 { liveAfterFirst = live }
            print(String(format: "cycle %d: footprint before %.1f MB, peak %.1f MB, after load %.1f MB, after release %.1f MB; live heap %.2f MB", cycle,
                         Double(stats.footprintBeforeBytes) / Double(mb), Double(stats.peakFootprintBytes) / Double(mb),
                         Double(stats.footprintAfterBytes) / Double(mb), Double(MemoryFootprint.bytes()) / Double(mb), Double(live) / Double(mb)))
            XCTAssertLessThan(live - liveAfterFirst, mb, "cycle \(cycle) live heap grew")
        }
        // Other suites' machinery (URLSession stubs) leaks in a shared process and keeps dribbling;
        // the strict verdict holds in a fresh process, where these loads leak exactly 0 bytes.
        if leakedBefore == 0 {
            XCTAssertEqual(try leakedBytes(), 0)
        } else {
            print("leaks verdict skipped: the process carried \(leakedBefore) leaked bytes in")
        }
    }

    /// Bytes in live malloc blocks, from `heap`.
    private func liveHeapBytes() throws -> Int {
        let output = try tool("/usr/bin/heap", ["--sortBySize", String(ProcessInfo.processInfo.processIdentifier)])
        // "All zones: 3780 nodes (3207008 bytes)"
        guard let range = output.range(of: #"All zones: \d+ nodes \((\d+) bytes\)"#, options: .regularExpression) else {
            throw XCTSkip("heap gave no total: \(output.suffix(400))")
        }
        return Int(output[range].split(separator: "(")[1].split(separator: " ")[0]) ?? -1
    }

    /// Total leaked bytes `leaks` finds in this process.
    private func leakedBytes() throws -> Int {
        let output = try tool("/usr/bin/leaks", ["--quiet", String(ProcessInfo.processInfo.processIdentifier)])
        // "Process 123: 0 leaks for 0 total leaked bytes."
        guard let range = output.range(of: #"(\d+) total leaked bytes"#, options: .regularExpression) else {
            throw XCTSkip("leaks gave no verdict: \(output.suffix(400))")
        }
        print("leaks: \(output[range])")
        return Int(output[range].split(separator: " ")[0]) ?? -1
    }

    private func tool(_ path: String, _ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        return output
    }
}
