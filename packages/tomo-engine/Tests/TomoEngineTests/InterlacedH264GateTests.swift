import Foundation
import Libavcodec
import Libavformat
import Libavutil
import XCTest

@testable import TomoEngine

/// Interlaced H.264 must never stream-copy: HLS forbids interlaced samples
/// (authoring spec 1.14) and AVPlayer weaves them. Live TS leaves field_order
/// unknown, so the gate and the transcoder read the SPS's frame_mbs_only_flag.
final class InterlacedH264GateTests: XCTestCase {
    private static let ffmpeg: String = {
        let jellyfin = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
        return FileManager.default.isExecutableFile(atPath: jellyfin) ? jellyfin : "/opt/homebrew/bin/ffmpeg"
    }()

    private static let fixtureDir: URL = {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".build/codec-fixtures", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func fixture(_ name: String, _ args: [String]) throws -> URL {
        guard FileManager.default.isExecutableFile(atPath: Self.ffmpeg) else {
            throw XCTSkip("no ffmpeg at \(Self.ffmpeg); fixtures cannot be generated")
        }
        let out = Self.fixtureDir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: out.path) { return out }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Self.ffmpeg)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y"] + args + [out.path]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: out.path) else {
            try? FileManager.default.removeItem(at: out)
            throw XCTSkip("ffmpeg could not generate \(name)")
        }
        return out
    }

    private func interlaced(container: String) throws -> URL {
        try fixture("h264-mbaff.\(container)", [
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=50:duration=2",
            "-c:v", "libx264", "-flags", "+ilme+ildct", "-x264opts", "tff=1",
            "-pix_fmt", "yuv420p", "-an",
        ])
    }

    private func progressive() throws -> URL {
        try fixture("h264-progressive-gate.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
        ])
    }

    private func withVideoStream<T>(_ url: URL, _ body: (UnsafeMutablePointer<AVStream>) throws -> T) throws -> T {
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, url.path, nil, nil) >= 0, let input = ctx else { throw XCTSkip("fixture did not open") }
        defer { avformat_close_input(&ctx) }
        guard avformat_find_stream_info(input, nil) >= 0 else { throw XCTSkip("no stream info") }
        let index = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard index >= 0, let stream = input.pointee.streams[Int(index)] else { throw XCTSkip("no video stream") }
        liftParameterSets(input, stream)
        return try body(stream)
    }

    /// What the pipeline does for TS input: this build's demux leaves extradata
    /// empty (no extract_extradata bsf), so the opening keyframe supplies it.
    private func liftParameterSets(_ input: UnsafeMutablePointer<AVFormatContext>, _ stream: UnsafeMutablePointer<AVStream>) {
        guard stream.pointee.codecpar.pointee.extradata_size == 0 else { return }
        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        guard let pkt = packet else { return }
        while av_read_frame(input, pkt) >= 0 {
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == stream.pointee.index, pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0,
                  let sets = TierRewrapper.annexBParameterSets(pkt, hevc: false),
                  let buf = av_mallocz(sets.count + SWIFT_AV_INPUT_BUFFER_PADDING_SIZE) else { continue }
            sets.withUnsafeBytes { raw in buf.copyMemory(from: raw.baseAddress!, byteCount: sets.count) }
            stream.pointee.codecpar.pointee.extradata = buf.assumingMemoryBound(to: UInt8.self)
            stream.pointee.codecpar.pointee.extradata_size = Int32(sets.count)
            return
        }
    }

    func testSpsReadsFieldCodingFromAnnexB() throws {
        try withVideoStream(try interlaced(container: "ts")) { stream in
            let size = stream.pointee.codecpar.pointee.extradata_size
            XCTAssertEqual(H264ParameterSets.codedInterlaced(stream.pointee.codecpar), true, "extradata_size \(size)")
        }
    }

    func testSpsReadsFieldCodingFromAvcC() throws {
        try withVideoStream(try interlaced(container: "mp4")) { stream in
            XCTAssertEqual(stream.pointee.codecpar.pointee.extradata.map { $0[0] }, 1, "mp4 extradata is avcC")
            XCTAssertEqual(H264ParameterSets.codedInterlaced(stream.pointee.codecpar), true)
        }
    }

    func testSpsReadsProgressiveCoding() throws {
        try withVideoStream(try progressive()) { stream in
            XCTAssertEqual(H264ParameterSets.codedInterlaced(stream.pointee.codecpar), false)
        }
    }

    func testGateRoutesInterlacedPastTheCopy() throws {
        try withVideoStream(try interlaced(container: "ts")) { stream in
            XCTAssertTrue(VideoTranscoder.needsTranscode(stream: stream))
        }
    }

    /// The live HLS probe answers field_order unknown (measured on a 1080i25
    /// PAFF origin); the gate and the transcoder must still see the interlace.
    func testUnknownFieldOrderFallsBackToSps() throws {
        try withVideoStream(try interlaced(container: "ts")) { stream in
            stream.pointee.codecpar.pointee.field_order = AV_FIELD_UNKNOWN
            XCTAssertTrue(VideoTranscoder.needsTranscode(stream: stream))
            let transcoder = try XCTUnwrap(VideoTranscoder(inputStream: stream))
            XCTAssertTrue(transcoder.deinterlacing)
            XCTAssertTrue(transcoder.frameFlagDeinterlacing)
        }
    }

    func testProgressiveKeepsTheCopy() throws {
        try XCTSkipUnless(DeviceDecode.h264, "host has no H.264 hardware decoder")
        try withVideoStream(try progressive()) { stream in
            XCTAssertFalse(VideoTranscoder.needsTranscode(stream: stream))
        }
    }

    func testKnownFieldOrderStaysContainerDriven() throws {
        try withVideoStream(try interlaced(container: "ts")) { stream in
            XCTAssertEqual(stream.pointee.codecpar.pointee.field_order, AV_FIELD_TT)
            let transcoder = try XCTUnwrap(VideoTranscoder(inputStream: stream))
            XCTAssertTrue(transcoder.deinterlacing)
            XCTAssertFalse(transcoder.frameFlagDeinterlacing)
        }
    }
}
