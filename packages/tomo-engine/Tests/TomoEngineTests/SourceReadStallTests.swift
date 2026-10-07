import Darwin
import Libavformat
import Libavutil
import XCTest

@testable import TomoEngine

/// A loopback file origin whose first response sends a prefix and then goes silent on an open
/// connection, the way a receiver withholding its window looks to the reader; ranged requests are served whole.
/// `silentFirst` instead holds the first request's answer for 3s, the way a server behind a sleeping disk answers.
private final class StallingFileOrigin {
    let body: Data
    let prefix: Int
    let silentFirst: Bool
    let port: UInt16
    private let listener: Int32
    private let lock = NSLock()
    private var held: [Int32] = []
    private var served = 0

    init(body: Data, prefix: Int, silentFirst: Bool = false) throws {
        self.body = body
        self.prefix = prefix
        self.silentFirst = silentFirst
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard bound == 0, Darwin.listen(fd, 8) == 0 else { throw XCTSkip("loopback listener unavailable") }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.getsockname(fd, $0, &length) } }
        listener = fd
        port = UInt16(bigEndian: address.sin_port)
        Thread.detachNewThread { [weak self] in self?.acceptLoop() }
    }

    var requests: Int {
        lock.lock()
        defer { lock.unlock() }
        return served
    }

    func stop() {
        lock.lock()
        let open = held
        held = []
        lock.unlock()
        open.forEach { Darwin.close($0) }
        Darwin.shutdown(listener, SHUT_RDWR)
        Darwin.close(listener)
    }

    private func acceptLoop() {
        while true {
            let client = Darwin.accept(listener, nil, nil)
            if client < 0 { return }
            DispatchQueue.global().async { [weak self] in self?.serve(client) }
        }
    }

    private func serve(_ client: Int32) {
        var head = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while head.range(of: Data("\r\n\r\n".utf8)) == nil {
            let count = Darwin.read(client, &buffer, buffer.count)
            if count <= 0 {
                Darwin.close(client)
                return
            }
            head.append(buffer, count: count)
        }
        let range = String(decoding: head, as: UTF8.self).components(separatedBy: "\r\n")
            .first { $0.lowercased().hasPrefix("range: bytes=") }
            .flatMap { Int($0.dropFirst("range: bytes=".count).split(separator: "-").first ?? "") } ?? 0
        lock.lock()
        served += 1
        let first = served == 1
        lock.unlock()
        if silentFirst && first {
            Thread.sleep(forTimeInterval: 3)
            Darwin.close(client)
            return
        }
        let rest = body.subdata(in: range..<body.count)
        var reply = range > 0 ? "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes \(range)-\(body.count - 1)/\(body.count)\r\n" : "HTTP/1.1 200 OK\r\n"
        reply += "Content-Length: \(rest.count)\r\nAccept-Ranges: bytes\r\n\r\n"
        if range == 0, !silentFirst {
            write(client, Data(reply.utf8) + rest.prefix(prefix))
            lock.lock()
            held.append(client)
            lock.unlock()
        } else {
            write(client, Data(reply.utf8) + rest)
            Darwin.close(client)
        }
    }

    private func write(_ client: Int32, _ data: Data) {
        data.withUnsafeBytes { raw in
            var sent = 0
            while sent < data.count {
                let n = Darwin.write(client, raw.baseAddress! + sent, data.count - sent)
                if n <= 0 { return }
                sent += n
            }
        }
    }
}

final class SourceReadStallTests: XCTestCase {
    /// A file read that goes silent mid-body resumes on a new connection at its offset within the
    /// read timeout, byte for byte, instead of waiting out the stall.
    func testASilentFileReadResumesAtItsOffsetWithinTheTimeout() throws {
        let body = Data((0..<(4 << 20)).map { UInt8(truncatingIfNeeded: $0 &* 31 &+ $0 >> 9) })
        let origin = try StallingFileOrigin(body: body, prefix: 1 << 20)
        defer { origin.stop() }
        var opts = sourceHttpOptions(headers: [:], file: true)
        defer { av_dict_free(&opts) }
        var pb: UnsafeMutablePointer<AVIOContext>?
        let started = Date()
        XCTAssertGreaterThanOrEqual(avio_open2(&pb, "http://127.0.0.1:\(origin.port)/source", AVIO_FLAG_READ, nil, &opts), 0)
        var received = Data()
        var chunk = [UInt8](repeating: 0, count: 65536)
        while true {
            let n = avio_read(pb, &chunk, Int32(chunk.count))
            if n <= 0 { break }
            received.append(chunk, count: Int(n))
        }
        avio_closep(&pb)
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(received, body)
        XCTAssertEqual(origin.requests, 2, "one reconnect at the stalled offset")
        XCTAssertLessThan(elapsed, 3.5, "the stall was waited out instead of reconnected")
    }

    /// A grabber whose first open runs out the file timeout opens on the next request instead of
    /// failing every grab of the session.
    func testAGrabberOpensAgainAfterATimedOutOpen() throws {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/tier-segment.mpegts")
        let origin = try StallingFileOrigin(body: try Data(contentsOf: fixture), prefix: 0, silentFirst: true)
        defer { origin.stop() }
        let grabber = FrameGrabber(inputUrl: "http://127.0.0.1:\(origin.port)/source.ts",
                                   directory: FileManager.default.temporaryDirectory, pool: nil, epoch: ChapterFramePool.epoch)
        defer { grabber.stop() }
        XCTAssertFalse(grabber.open(), "the first open answered inside the stall")
        XCTAssertTrue(grabber.open(), "a timed-out open was not tried again")
    }
}
