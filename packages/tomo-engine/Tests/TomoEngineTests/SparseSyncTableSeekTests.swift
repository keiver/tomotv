import Foundation
import Network
import XCTest
@testable import TomoEngine

/// An MP4 whose sync sample table lists only its first sample: FFmpeg's mov seek lands every
/// restart on sample 0, and the engine read the file forward from byte 0 to the requested
/// segment (issue 109, an 8.6 GB HEVC file resumed at 49:00 read 4.15 GB in 106 s).
final class SparseSyncTableSeekTests: XCTestCase {
    private static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    private static let seconds = 60.0

    /// Keyframes every 50 frames (2.083 s), none on the 6 s grid, with a one-entry stss.
    private static let fixture = makeFixture(named: "stss1-gop50-60s.mp4", gopFrames: 50)
    /// One keyframe in the whole file, so no scan around the target can find one.
    private static let singleKeyframeFixture = makeFixture(named: "stss1-gop100000-60s.mp4", gopFrames: 100_000)
    /// HEVC with open GOPs: every keyframe after the first is a CRA, and the stss lists one entry.
    private static let openGopHevcFixture = makeFixture(named: "stss1-hevc-cra-gop50-60s.mp4", gopFrames: 50, hevcOpenGop: true)
    /// A healthy sync table with keyframes 25 s apart: an index seek lands up to 25 s short of its target.
    private static let longGopFixture = makeFixture(named: "gop600-60s.mp4", gopFrames: 600, keepSyncTable: true)
    /// The file issue 109 describes: HEVC Main 10 at 3840x2160 tagged hvc1, PQ and BT.2020 in a colr atom,
    /// open GOP 10 s apart with FFmpeg's sync sample groups, AAC and E-AC3 tracks, moov first; as encoded,
    /// and with its sync table cut to one entry.
    private static let replicaFixture = makeFixture(named: "replica-4k-hdr10-60s.mp4", gopFrames: 240, replica: true, keepSyncTable: true)
    private static let replicaCutFixture = makeFixture(named: "stss1-replica-4k-hdr10-60s.mp4", gopFrames: 240, replica: true)

    private static let hasLibx265: Bool = {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = ["-hide_banner", "-encoders"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return false }
        let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        p.waitUntilExit()
        return text.contains("libx265")
    }()

    private static func makeFixture(named name: String, gopFrames: Int, hevcOpenGop: Bool = false, replica: Bool = false,
                                    keepSyncTable: Bool = false) -> URL? {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: out.path) { return out }
        if hevcOpenGop || replica, !hasLibx265 { return nil }
        let encoded = dir.appendingPathComponent("full-" + name)
        let inputs: [String] = replica
            ? ["-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
               "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", String(seconds), "-map", "0:v", "-map", "1:a", "-map", "2:a"]
            : ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", String(seconds)]
        let x265 = "open-gop=1:keyint=\(gopFrames):min-keyint=\(min(gopFrames, 24)):scenecut=0:bframes=4"
        let codec: [String]
        if replica {
            codec = ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-profile:v", "main10",
                     "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
                     "-x265-params", x265 + ":colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:repeat-headers=1"
                         + ":master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400",
                     "-tag:v", "hvc1", "-c:a:0", "aac", "-b:a:0", "128k", "-c:a:1", "eac3", "-b:a:1", "384k", "-movflags", "+faststart+write_colr"]
        } else if hevcOpenGop {
            codec = ["-c:v", "libx265", "-preset", "ultrafast", "-x265-params", x265, "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]
        } else {
            codec = ["-c:v", "libx264", "-preset", "ultrafast", "-g", String(gopFrames), "-keyint_min", String(gopFrames), "-sc_threshold", "0",
                     "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y"] + inputs + codec + ["-f", "mp4", encoded.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        guard p.terminationStatus == 0, var bytes = try? Data(contentsOf: encoded) else { return nil }
        if !keepSyncTable { guard keepOnlyFirstSyncSample(&bytes) else { return nil } }
        guard (try? bytes.write(to: out)) != nil else { return nil }
        return out
    }

    /// Rewrites the moov's stss to its first entry and pads the freed bytes with a free box, so
    /// every box size and chunk offset stays as written.
    private static func keepOnlyFirstSyncSample(_ bytes: inout Data) -> Bool {
        func u32(_ at: Int) -> Int { Int(bytes[at]) << 24 | Int(bytes[at + 1]) << 16 | Int(bytes[at + 2]) << 8 | Int(bytes[at + 3]) }
        func put32(_ value: Int, at: Int) {
            bytes[at] = UInt8((value >> 24) & 0xFF); bytes[at + 1] = UInt8((value >> 16) & 0xFF)
            bytes[at + 2] = UInt8((value >> 8) & 0xFF); bytes[at + 3] = UInt8(value & 0xFF)
        }
        var at = 0
        var moov: Range<Int>?
        while at + 8 <= bytes.count {
            let size = u32(at)
            guard size >= 8 else { return false }
            if bytes[at + 4 ..< at + 8] == Data("moov".utf8) { moov = at ..< at + size }
            at += size
        }
        guard let moov else { return false }
        for i in moov.lowerBound ..< moov.upperBound - 8 where bytes[i ..< i + 4] == Data("stss".utf8) {
            let box = i - 4
            let size = u32(box)
            let entries = u32(box + 12)
            guard size == 16 + entries * 4 else { continue }
            if entries == 1 { return true }
            guard entries >= 3 else { return false }
            put32(20, at: box)
            put32(1, at: box + 12)
            put32(1, at: box + 16)
            put32(size - 20, at: box + 20)
            bytes.replaceSubrange(box + 24 ..< box + 28, with: Data("free".utf8))
            return true
        }
        return false
    }

    private func session(_ bytes: Data, realtimeFactor: Double, codecs: String, width: Int = 320, height: Int = 180,
                         videoRange: String = "SDR", ranged: Bool = false) throws -> (RemuxSession, ThrottledFileServer?, RangedFileServer?) {
        let bytesPerSecond = Int(Double(bytes.count) / (Self.seconds / realtimeFactor))
        let port: UInt16
        var throttled: ThrottledFileServer?
        var rangedServer: RangedFileServer?
        if ranged {
            let server = try RangedFileServer(data: bytes, bytesPerSecond: bytesPerSecond)
            rangedServer = server
            port = server.port
        } else {
            let server = try ThrottledFileServer(data: bytes, bytesPerSecond: bytesPerSecond)
            throttled = server
            port = server.port
        }
        let session = try RemuxSession(config: makeConfig(durationSeconds: Self.seconds, inputUrl: "http://127.0.0.1:\(port)/gop.mp4",
                                                          videoRange: videoRange, codecs: codecs, width: width, height: height, frameRate: 24))
        return (session, throttled, rangedServer)
    }

    func testAResumeOnAnMP4WhoseSyncTableMissesItsKeyframesIsServedFromTheTarget() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.fixture, "libx264 produced no fixture"))
        // Twice realtime: reading forward from byte 0 takes 21 s to reach segment 7, past the 20 s request deadline.
        let (session, server, _) = try session(bytes, realtimeFactor: 2, codecs: "avc1.64000D")
        defer { server?.stop() }
        session.start()
        defer { session.stop() }
        let started = Date()
        XCTAssertNotNil(session.segmentURL(7), "segment 7 is served from a keyframe found around the target, not after a read from byte 0")
        XCTAssertLessThan(Date().timeIntervalSince(started), 18, "served from the target, not from byte 0")
    }

    func testAResumeOnAnOpenGopHevcMP4WhoseSyncTableMissesItsKeyframesOpensOnACra() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        guard Self.hasLibx265 else { throw XCTSkip("ffmpeg has no libx265") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.openGopHevcFixture, "libx265 produced no fixture"))
        let (session, server, _) = try session(bytes, realtimeFactor: 2, codecs: "hvc1.1.6.L63.90")
        defer { server?.stop() }
        session.start()
        defer { session.stop() }
        let started = Date()
        XCTAssertNotNil(session.segmentURL(7))
        XCTAssertLessThan(Date().timeIntervalSince(started), 18, "served from the target, not from byte 0")
    }

    func testAResumeOnAnMP4WithOneKeyframeFailsInsteadOfReadingTheFileForward() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.singleKeyframeFixture, "libx264 produced no fixture"))
        // Four times realtime: the forward read would still need 10 s to reach segment 7; the scan gives up well before.
        let (session, server, _) = try session(bytes, realtimeFactor: 4, codecs: "avc1.64000D")
        defer { server?.stop() }
        let lock = NSLock()
        var failure: String?
        session.onFailed = { payload in
            lock.lock()
            failure = "\(payload)"
            lock.unlock()
        }
        session.start()
        defer { session.stop() }
        let started = Date()
        XCTAssertNil(session.segmentURL(7))
        XCTAssertLessThan(Date().timeIntervalSince(started), 19, "the session ends the request, not the 20 s deadline")
        lock.lock()
        let reason = failure
        lock.unlock()
        XCTAssertTrue(reason?.contains("landed") == true, "the session failed naming the short landing: \(reason ?? "no failure")")
    }

    /// Keyframes at 0, 25 and 50 s with a healthy sync table: the seek for segment 8 (48 s) lands at 25 s,
    /// the read looks for a keyframe around 48 s, finds the one at 50 s in segment 8, and the lookback
    /// restarts a segment earlier, where the landing is within the slack and reads forward as before.
    func testAHealthyMP4WithKeyframesFurtherApartThanTheSlackStillServesItsResume() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.longGopFixture, "libx264 produced no fixture"))
        let (session, server, _) = try session(bytes, realtimeFactor: 4, codecs: "avc1.64000D")
        defer { server?.stop() }
        session.start()
        defer { session.stop() }
        let started = Date()
        XCTAssertNotNil(session.segmentURL(8))
        XCTAssertLessThan(Date().timeIntervalSince(started), 19)
    }

    /// The reporter's file shape as encoded, read over 2 MiB ranges: a correct sync table resumes at once.
    func testTheReplicaOfIssue109sFileResumesAsEncoded() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        guard Self.hasLibx265 else { throw XCTSkip("ffmpeg has no libx265") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.replicaFixture, "libx265 produced no replica"))
        let (session, _, server) = try session(bytes, realtimeFactor: 2, codecs: "hvc1.2.4.L153.B0,mp4a.40.2,ec-3", width: 3840, height: 2160,
                                               videoRange: "PQ", ranged: true)
        defer { server?.stop() }
        session.start()
        defer { session.stop() }
        let started = Date()
        XCTAssertNotNil(session.segmentURL(7))
        XCTAssertLessThan(Date().timeIntervalSince(started), 12)
        session.stateLock.lock()
        let restarts = session.seekRestarts
        session.stateLock.unlock()
        XCTAssertEqual(restarts, 1, "the index seek lands 2 s short of segment 7 and reads forward to it")
    }

    /// The same file with its sync table cut to one entry: every index seek lands on byte 0 and the
    /// resume is served from the CRA the read finds before the target.
    func testTheReplicaOfIssue109sFileResumesWithItsSyncTableCut() throws {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else { throw XCTSkip("no ffmpeg at \(Self.ffmpeg)") }
        guard Self.hasLibx265 else { throw XCTSkip("ffmpeg has no libx265") }
        let bytes = try Data(contentsOf: try XCTUnwrap(Self.replicaCutFixture, "libx265 produced no replica"))
        let (session, _, server) = try session(bytes, realtimeFactor: 2, codecs: "hvc1.2.4.L153.B0,mp4a.40.2,ec-3", width: 3840, height: 2160,
                                               videoRange: "PQ", ranged: true)
        defer { server?.stop() }
        session.start()
        defer { session.stop() }
        let started = Date()
        XCTAssertNotNil(session.segmentURL(7), "served from the keyframe at 40 s, not after a read from byte 0")
        XCTAssertLessThan(Date().timeIntervalSince(started), 18)
    }
}

/// A loopback server that answers every Range with 206 and the exact span asked for, at a fixed
/// rate: the engine's ranged probe passes and the file is read over 2 MiB ranges, as issue 109's was.
final class RangedFileServer {
    private let listener: NWListener
    private let data: Data
    private let bytesPerSecond: Int
    private let queue = DispatchQueue(label: "ranged-file-server")
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
        var end = data.count - 1
        if let line = request.split(separator: "\r\n").first(where: { $0.lowercased().hasPrefix("range: bytes=") }) {
            let parts = line.dropFirst("range: bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
            if let from = Int(parts.first ?? "") { start = min(max(0, from), data.count) }
            if parts.count > 1, let to = Int(parts[1]) { end = min(to, data.count - 1) }
        }
        let body = data.subdata(in: start ..< end + 1)
        let head = "HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Range: bytes \(start)-\(end)/\(data.count)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        DispatchQueue.global(qos: .utility).async { [self] in
            send(connection, Data(head.utf8))
            let started = Date()
            var sent = 0
            let chunk = 32 * 1024
            while sent < body.count {
                let next = min(sent + chunk, body.count)
                guard send(connection, body.subdata(in: sent ..< next)) else { return }
                sent = next
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
        var ok = true
        connection.send(content: bytes, completion: .contentProcessed { error in
            ok = error == nil
            done.signal()
        })
        done.wait()
        return ok
    }
}
