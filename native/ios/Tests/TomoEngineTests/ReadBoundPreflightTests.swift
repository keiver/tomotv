import Foundation
import Network
import XCTest
@testable import TomoEngine

/// A loopback HTTP server that hands a file out at a fixed rate: the slow link the engine's
/// opening segment waits on. Honours a byte Range so the demuxer's probe seeks still work.
final class ThrottledFileServer {
    private let listener: NWListener
    private let data: Data
    private let bytesPerSecond: Int
    private let queue = DispatchQueue(label: "throttled-file-server")
    private let ready = DispatchSemaphore(value: 0)

    init(data: Data, bytesPerSecond: Int) throws {
        self.data = data
        self.bytesPerSecond = bytesPerSecond
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.stateUpdateHandler = { [ready] state in if case .ready = state { ready.signal() } }
        listener.start(queue: queue)
        ready.wait()
    }

    var port: UInt16 { listener.port?.rawValue ?? 0 }

    func stop() { listener.cancel() }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        var request = Data()
        func readHeader() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [self] chunk, _, _, error in
                guard error == nil, let chunk else { connection.cancel(); return }
                request.append(chunk)
                if let text = String(data: request, encoding: .utf8), text.contains("\r\n\r\n") {
                    respond(connection, request: text)
                } else {
                    readHeader()
                }
            }
        }
        readHeader()
    }

    private func respond(_ connection: NWConnection, request: String) {
        var start = 0
        if let line = request.split(separator: "\r\n").first(where: { $0.lowercased().hasPrefix("range: bytes=") }),
           let from = Int(line.dropFirst("range: bytes=".count).split(separator: "-").first ?? "") {
            start = min(max(0, from), data.count)
        }
        let body = data.subdata(in: start ..< data.count)
        let head = start == 0
            ? "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
            : "HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Range: bytes \(start)-\(data.count - 1)/\(data.count)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        DispatchQueue.global(qos: .utility).async { [self] in
            send(connection, Data(head.utf8))
            let started = Date()
            var sent = 0
            let chunk = 32 * 1024
            while sent < body.count {
                let end = min(sent + chunk, body.count)
                guard send(connection, body.subdata(in: sent ..< end)) else { return }
                sent = end
                let due = Double(sent) / Double(bytesPerSecond)
                let elapsed = Date().timeIntervalSince(started)
                if due > elapsed { Thread.sleep(forTimeInterval: due - elapsed) }
            }
            connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in connection.cancel() })
        }
    }

    @discardableResult
    private func send(_ connection: NWConnection, _ bytes: Data) -> Bool {
        let done = DispatchSemaphore(value: 0)
        var ok = false
        connection.send(content: bytes, completion: .contentProcessed { error in
            ok = error == nil
            done.signal()
        })
        done.wait()
        return ok
    }
}

/// A short clip served slower than it plays: the opening segment is the whole clip, so it
/// cannot finish before the file has been read, and the sample must say the wait was the input's.
final class ReadBoundPreflightTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 7.0

    private static let fixture: URL? = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("read-bound-7s.mp4")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-t", String(seconds),
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-b:v", "4M", "-minrate", "4M", "-maxrate", "4M", "-bufsize", "2M",
            "-g", "24", "-an", "-movflags", "+faststart", out.path,
        ]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        return p.terminationStatus == 0 && FileManager.default.fileExists(atPath: out.path) ? out : nil
    }()

    func testASlowLinkIsReportedAsReadTimeAndProgress() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        guard let fixture = Self.fixture, let bytes = try? Data(contentsOf: fixture) else { throw XCTSkip("libx264 produced no fixture") }
        // Whole file in ~1.6x its duration: the segment lands late, and the wait is the read.
        let server = try ThrottledFileServer(data: bytes, bytesPerSecond: Int(Double(bytes.count) / (Self.seconds * 1.6)))
        defer { server.stop() }

        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(server.port)/clip.mp4", width: 1280, height: 720))
        let lock = NSLock()
        var samples: [[String: Any]] = []
        session.onThroughput = { sample in
            lock.lock()
            samples.append(sample)
            lock.unlock()
        }
        session.start()
        defer { session.stop() }

        // Mid-read, the progress the app polls at its deadline says the session is alive and pulling.
        Thread.sleep(forTimeInterval: 3)
        let early = session.progress()
        let earlyBytes = early["bytesRead"] as? Int64 ?? 0
        XCTAssertEqual(early["alive"] as? Bool, true)
        XCTAssertGreaterThan(earlyBytes, 0)
        Thread.sleep(forTimeInterval: 2)
        let later = session.progress()
        XCTAssertGreaterThan(later["bytesRead"] as? Int64 ?? 0, earlyBytes)
        let elapsed = later["elapsedSeconds"] as? Double ?? 0
        let waited = later["readSeconds"] as? Double ?? 0
        XCTAssertGreaterThanOrEqual(waited / max(elapsed, 0.001), 0.6, "read \(waited)s of \(elapsed)s")

        let deadline = Date().addingTimeInterval(40)
        var first: [String: Any]?
        while Date() < deadline, first == nil {
            lock.lock()
            first = samples.first
            lock.unlock()
            usleep(50_000)
        }
        let sample = try XCTUnwrap(first, "segment 0 never reported")
        let produce = try XCTUnwrap(sample["produceSeconds"] as? Double)
        let read = try XCTUnwrap(sample["readSeconds"] as? Double)
        XCTAssertEqual(sample["segment"] as? Int, 0)
        XCTAssertGreaterThan(produce, sample["segmentSeconds"] as? Double ?? 0, "the segment should land late on this link")
        XCTAssertGreaterThanOrEqual(read / produce, 0.6, "produce \(produce)s, read \(read)s")

        session.stop()
        XCTAssertEqual(session.progress()["alive"] as? Bool, false)
    }
}
