import Foundation
import XCTest

@testable import TomoEngine

/// The parallel ranged reader against a real local HTTP server: in-order bytes,
/// seeks, and the refusal that keeps range-less servers on the plain path.
final class ParallelRangeReaderTests: XCTestCase {
    private static let serverScript = """
    const http = require("http"), fs = require("fs");
    const file = process.argv[1], mode = process.argv[2], ranges = mode !== "plain";
    const size = fs.statSync(file).size;
    const server = http.createServer((req, res) => {
      // "hang" accepts the request and never answers it.
      if (mode === "hang") return;
      const m = ranges && /^bytes=(\\d+)-(\\d+)?$/.exec(req.headers.range || "");
      if (m) {
        const start = Number(m[1]), end = m[2] ? Number(m[2]) : size - 1;
        res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        // "stall" answers the one-byte probe and then sends headers with no body.
        if (mode === "stall" && end > start) return res.flushHeaders();
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "Content-Length": size });
        fs.createReadStream(file).pipe(res);
      }
    });
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
    """

    private var server: Process?
    private var fileURL: URL!
    private var payload: Data!
    private var port = 0

    private func startServer(ranges: Bool, bytes: Int = 9_000_000, mode: String? = nil) throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("prr-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        fileURL = dir.appendingPathComponent("payload.bin")
        var data = Data(count: bytes)
        data.withUnsafeMutableBytes { raw in
            var state: UInt64 = 0x9E37_79B9_7F4A_7C15
            for i in 0 ..< raw.count {
                state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
                raw[i] = UInt8(truncatingIfNeeded: state >> 33)
            }
        }
        payload = data
        try payload.write(to: fileURL)

        let node = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) }
        guard let node else { throw XCTSkip("no node on this host") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = ["-e", Self.serverScript, fileURL.path, mode ?? (ranges ? "ranges" : "plain")]
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        server = process
        addTeardownBlock { [weak process] in process?.terminate() }
        guard let line = pipe.fileHandleForReading.availableData.split(separator: UInt8(ascii: "\n")).first,
              let parsed = Int(String(decoding: line, as: UTF8.self)) else {
            throw XCTSkip("server did not report a port")
        }
        port = parsed
    }

    private func url() -> URL { URL(string: "http://127.0.0.1:\(port)/payload.bin")! }

    func testReadsTheWholeFileInOrderOverChunks() throws {
        try startServer(ranges: true)
        let reader = try XCTUnwrap(ParallelRangeReader.open(url: url(), headers: ["X-Probe": "1"]))
        defer { reader.close() }
        XCTAssertEqual(reader.size, Int64(payload.count))
        var collected = Data()
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: 65536, alignment: 1)
        defer { buffer.deallocate() }
        while true {
            let got = reader.read(into: buffer, count: 65536)
            XCTAssertGreaterThanOrEqual(got, 0)
            if got <= 0 { break }
            collected.append(Data(bytes: buffer, count: got))
        }
        XCTAssertEqual(collected, payload)
    }

    func testSeekServesTheTailFromTheNewOffset() throws {
        try startServer(ranges: true)
        let reader = try XCTUnwrap(ParallelRangeReader.open(url: url(), headers: [:]))
        defer { reader.close() }
        let offset = Int64(payload.count - 100_000)
        XCTAssertEqual(reader.seek(to: offset), offset)
        var collected = Data()
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: 65536, alignment: 1)
        defer { buffer.deallocate() }
        while true {
            let got = reader.read(into: buffer, count: 65536)
            if got <= 0 { break }
            collected.append(Data(bytes: buffer, count: got))
        }
        XCTAssertEqual(collected, payload.suffix(100_000))
    }

    func testARangeIgnoringServerGetsNoReader() throws {
        try startServer(ranges: false)
        XCTAssertNil(ParallelRangeReader.open(url: url(), headers: [:]))
    }

    /// A read blocked on a chunk the server never sends ends when its owner cancels.
    func testACancelEndsABlockedRead() throws {
        try startServer(ranges: true, mode: "stall")
        var cancelAt = Date.distantFuture
        let reader = try XCTUnwrap(ParallelRangeReader.open(url: url(), headers: [:], isCancelled: { Date() >= cancelAt }))
        defer { reader.close() }
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: 65536, alignment: 1)
        defer { buffer.deallocate() }
        let started = Date()
        cancelAt = started.addingTimeInterval(0.5)
        XCTAssertEqual(reader.read(into: buffer, count: 65536), -1)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    /// A probe the server never answers ends when its owner cancels, and opens no reader.
    func testACancelEndsAnUnansweredProbe() throws {
        try startServer(ranges: true, mode: "hang")
        let started = Date()
        let cancelAt = started.addingTimeInterval(0.5)
        XCTAssertNil(ParallelRangeReader.open(url: url(), headers: [:], isCancelled: { Date() >= cancelAt }))
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    /// The window, not the session, bounds what the reader holds: a chunk the cursor
    /// consumed is freed even when its completion callback trails the last read.
    func testConsumedChunksAreFreed() throws {
        try startServer(ranges: true)
        let reader = try XCTUnwrap(ParallelRangeReader.open(url: url(), headers: [:]))
        defer { reader.close() }
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: 65536, alignment: 1)
        defer { buffer.deallocate() }
        while reader.read(into: buffer, count: 65536) > 0 {}
        var heldBytes = 0
        var completeCount = 0
        for child in Mirror(reflecting: reader).children {
            if child.label == "bodies", let map = child.value as? [Int64: Data] { heldBytes = map.values.reduce(0) { $0 + $1.count } }
            if child.label == "complete", let set = child.value as? Set<Int64> { completeCount = set.count }
        }
        XCTAssertEqual(heldBytes, 0, "chunk bodies held after reading to EOF")
        XCTAssertEqual(completeCount, 0)
    }

    /// On a size that is not a chunk multiple the EOF cursor still indexes the last chunk:
    /// the seek cancels every fetch, so anything held or in flight after it was started at EOF.
    func testAnEndOfFileCursorStartsNoFetch() throws {
        try startServer(ranges: true)
        let reader = try XCTUnwrap(ParallelRangeReader.open(url: url(), headers: [:]))
        defer { reader.close() }
        XCTAssertEqual(reader.seek(to: reader.size), reader.size)
        var heldChunks = -1
        var inFlight = -1
        for child in Mirror(reflecting: reader).children {
            if child.label == "bodies", let map = child.value as? [Int64: Data] { heldChunks = map.count }
            if child.label == "tasks", let map = child.value as? [Int64: URLSessionDataTask] { inFlight = map.count }
        }
        XCTAssertEqual(heldChunks, 0)
        XCTAssertEqual(inFlight, 0)
    }

    /// A size that is an exact chunk multiple puts the EOF cursor on a chunk past the last one.
    func testExactChunkMultipleReadsToTheEndAndSeeksToSize() throws {
        try startServer(ranges: true, bytes: 2 * ParallelRangeReader.chunkBytes)
        let reader = try XCTUnwrap(ParallelRangeReader.open(url: url(), headers: [:]))
        defer { reader.close() }
        var collected = Data()
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: 65536, alignment: 1)
        defer { buffer.deallocate() }
        while true {
            let got = reader.read(into: buffer, count: 65536)
            if got <= 0 {
                XCTAssertEqual(got, 0)
                break
            }
            collected.append(Data(bytes: buffer, count: got))
        }
        XCTAssertEqual(collected, payload)
        XCTAssertEqual(reader.seek(to: reader.size), reader.size)
        XCTAssertEqual(reader.read(into: buffer, count: 65536), 0)
    }
}
