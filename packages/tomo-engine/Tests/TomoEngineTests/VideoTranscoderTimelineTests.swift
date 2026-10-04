import Foundation
import Libavcodec
import Libavformat
import Libavutil
import XCTest

@testable import TomoEngine

/// The transcoder's output keeps the input's clock: an interlaced source through bwdif, whose
/// output time base is half its input's, must encode the same span of time it was fed.
final class VideoTranscoderTimelineTests: XCTestCase {
    private static let noPts = Int64(bitPattern: 0x8000_0000_0000_0000)
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

    /// Feeds `seconds` of the source's video through a transcoder; the input and output spans in seconds.
    private func spans(_ url: URL, seconds: Double) throws -> (input: Double, output: Double, frames: Int, deinterlaced: Bool) {
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, url.path, nil, nil) >= 0, let input = ctx else { throw XCTSkip("fixture did not open") }
        defer { avformat_close_input(&ctx) }
        guard avformat_find_stream_info(input, nil) >= 0 else { throw XCTSkip("no stream info") }
        let index = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard index >= 0, let stream = input.pointee.streams[Int(index)] else { throw XCTSkip("no video stream") }
        let transcoder = try XCTUnwrap(VideoTranscoder(inputStream: stream))
        let inTb = stream.pointee.time_base
        var firstIn: Int64?
        var lastIn: Int64 = 0
        var outPts: [Int64] = []
        let collect = { (packet: UnsafeMutablePointer<AVPacket>) in
            if packet.pointee.pts != Self.noPts { outPts.append(packet.pointee.pts) }
        }
        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        let pkt = try XCTUnwrap(packet)
        while av_read_frame(input, pkt) >= 0 {
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == index, pkt.pointee.pts != Self.noPts else { continue }
            let origin = firstIn ?? pkt.pointee.pts
            firstIn = origin
            if Double(pkt.pointee.pts - origin) * av_q2d(inTb) >= seconds { break }
            lastIn = pkt.pointee.pts
            // The pipeline hands the transcoder a timeline that starts at zero.
            pkt.pointee.pts -= origin
            if pkt.pointee.dts != Self.noPts { pkt.pointee.dts -= origin }
            transcoder.process(packet: pkt, emit: collect)
            XCTAssertFalse(transcoder.failed)
        }
        transcoder.process(packet: nil, emit: collect)
        let outTb = transcoder.encoderTimeBase
        let inputSpan = Double(lastIn - (firstIn ?? lastIn)) * av_q2d(inTb)
        let outputSpan = Double((outPts.max() ?? 0) - (outPts.min() ?? 0)) * av_q2d(outTb)
        // The transcoder deinterlaces exactly the sources whose container declares a field order.
        let order = stream.pointee.codecpar.pointee.field_order
        return (inputSpan, outputSpan, outPts.count, !(order == AV_FIELD_PROGRESSIVE || order == AV_FIELD_UNKNOWN))
    }

    func testAnInterlacedSourceEncodesTheSpanOfTimeItWasFed() throws {
        let url = try fixture("timeline-mpeg2-interlaced.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=30000/1001:duration=8",
            "-vf", "tinterlace=interleave_top,setfield=tff",
            "-c:v", "mpeg2video", "-flags", "+ildct+ilme", "-top", "1", "-b:v", "4M", "-g", "15", "-an",
        ])
        let measured = try spans(url, seconds: 5)
        XCTAssertTrue(measured.deinterlaced, "the fixture must take the bwdif path")
        XCTAssertGreaterThan(measured.frames, 60)
        // One frame of slack: bwdif holds a frame of lookahead until the flush.
        XCTAssertEqual(measured.output, measured.input, accuracy: 0.1, "deinterlaced frames must keep the input's timeline")
    }

    func testAProgressiveSourceEncodesTheSpanOfTimeItWasFed() throws {
        let url = try fixture("timeline-mpeg2-progressive.ts", [
            "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=30:duration=8",
            "-c:v", "mpeg2video", "-b:v", "4M", "-g", "15", "-an",
        ])
        let measured = try spans(url, seconds: 5)
        XCTAssertFalse(measured.deinterlaced)
        XCTAssertEqual(measured.output, measured.input, accuracy: 0.1)
    }
}
