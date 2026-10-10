import Foundation
import XCTest

@testable import TomoEngine

/// The parallel ranged reader against a real local HTTP server: in-order bytes,
/// seeks, and the refusal that keeps range-less servers on the plain path.
final class ParallelRangeReaderTests: XCTestCase {
    private static let serverScript = """
    const http = require("http"), fs = require("fs");
    const file = process.argv[1], ranges = process.argv[2] === "ranges";
    const size = fs.statSync(file).size;
    const server = http.createServer((req, res) => {
      const m = ranges && /^bytes=(\\d+)-(\\d+)?$/.exec(req.headers.range || "");
      if (m) {
        const start = Number(m[1]), end = m[2] ? Number(m[2]) : size - 1;
        res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
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

    private func startServer(ranges: Bool, bytes: Int = 9_000_000) throws {
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
        process.arguments = ["-e", Self.serverScript, fileURL.path, ranges ? "ranges" : "plain"]
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
}
