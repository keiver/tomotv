import Foundation
import Libavcodec
import Libavformat
import Libavutil
import XCTest

@testable import TomoEngine

private let noPts = Int64(bitPattern: 0x8000_0000_0000_0000)

/// The whole profile 7 chain against a real file, not a fixture: demux, convert every video
/// packet, mux, then re-open the result and read back what a player would see.
///
/// The sample is a 4K dual-layer disc rip, far too large to commit, so the path comes from
/// `TOMO_DV_P7_SAMPLE` and the test skips without it. Fixtures/README.md names the source.
final class DolbyVisionEndToEndTests: XCTestCase {
    private func openInput(_ path: String) throws -> UnsafeMutablePointer<AVFormatContext> {
        var input: UnsafeMutablePointer<AVFormatContext>? = nil
        guard avformat_open_input(&input, path, nil, nil) >= 0, let input else {
            throw XCTSkip("cannot open \(path)")
        }
        guard avformat_find_stream_info(input, nil) >= 0 else {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
            throw XCTSkip("no stream info in \(path)")
        }
        return input
    }

    private func videoStream(_ ctx: UnsafeMutablePointer<AVFormatContext>) -> UnsafeMutablePointer<AVStream>? {
        for i in 0..<Int(ctx.pointee.nb_streams) {
            guard let stream = ctx.pointee.streams[i] else { continue }
            if stream.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_VIDEO { return stream }
        }
        return nil
    }

    /// NAL types in one length-prefixed access unit.
    private func nalTypes(_ data: UnsafePointer<UInt8>, _ size: Int, lengthSize: Int) -> [UInt8] {
        var types: [UInt8] = []
        var offset = 0
        while offset + lengthSize <= size {
            var nalSize = 0
            for i in 0..<lengthSize { nalSize = (nalSize << 8) | Int(data[offset + i]) }
            guard nalSize >= 2, offset + lengthSize + nalSize <= size else { break }
            types.append((data[offset + lengthSize] >> 1) & 0x3F)
            offset += lengthSize + nalSize
        }
        return types
    }

    func testConvertsARealProfile7FileIntoASingleLayer81Track() throws {
        guard let path = ProcessInfo.processInfo.environment["TOMO_DV_P7_SAMPLE"] else {
            throw XCTSkip("set TOMO_DV_P7_SAMPLE to a profile 7 source")
        }

        let input = try openInput(path)
        var closingInput: UnsafeMutablePointer<AVFormatContext>? = input
        defer { avformat_close_input(&closingInput) }

        guard let inStream = videoStream(input) else { return XCTFail("no video stream") }
        let source = DolbyVisionConverter.configuration(inStream.pointee.codecpar)
        XCTAssertEqual(source?.dv_profile, 7, "sample is not profile 7")
        XCTAssertEqual(source?.el_present_flag, 1, "sample is not dual layer")

        guard let converter = DolbyVisionConverter(inputStream: inStream) else {
            return XCTFail("converter declined a profile 7 source")
        }

        // TOMO_DV_P7_OUT keeps the converted file for inspection; otherwise it is temporary.
        let keep = ProcessInfo.processInfo.environment["TOMO_DV_P7_OUT"]
        let outPath = keep ?? (NSTemporaryDirectory() + "tomo-dv-p7-\(getpid()).mp4")
        defer { if keep == nil { try? FileManager.default.removeItem(atPath: outPath) } }

        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        XCTAssertGreaterThanOrEqual(avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil), 0)
        guard let output = outputCtx else { return XCTFail("no muxer") }
        // Exactly what buildMuxer does: without it movenc drops the record entirely.
        output.pointee.strict_std_compliance = FF_COMPLIANCE_UNOFFICIAL

        guard let outStream = avformat_new_stream(output, nil) else { return XCTFail("no output stream") }
        XCTAssertGreaterThanOrEqual(avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar), 0)
        outStream.pointee.codecpar.pointee.codec_tag =
            UInt32(UInt8(ascii: "h")) | UInt32(UInt8(ascii: "v")) << 8
            | UInt32(UInt8(ascii: "c")) << 16 | UInt32(UInt8(ascii: "1")) << 24
        DolbyVisionConverter.rewriteConfiguration(outStream.pointee.codecpar)

        XCTAssertGreaterThanOrEqual(avio_open(&output.pointee.pb, outPath, AVIO_FLAG_WRITE), 0)
        XCTAssertGreaterThanOrEqual(avformat_write_header(output, nil), 0)

        let pkt = av_packet_alloc()!
        var ownedPkt: UnsafeMutablePointer<AVPacket>? = pkt
        defer { av_packet_free(&ownedPkt) }

        var written = 0
        var converted = 0
        var firstDts: Int64? = nil
        while av_read_frame(input, pkt) >= 0 {
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == inStream.pointee.index else { continue }

            let before = nalTypes(pkt.pointee.data, Int(pkt.pointee.size), lengthSize: 4)
            XCTAssertTrue(converter.rewrite(packet: pkt), "rewrite rejected a real packet")
            if before.contains(63) { converted += 1 }

            let after = nalTypes(pkt.pointee.data, Int(pkt.pointee.size), lengthSize: 4)
            XCTAssertFalse(after.contains(63), "an enhancement layer NAL survived the rewrite")

            if firstDts == nil, pkt.pointee.dts != noPts { firstDts = pkt.pointee.dts }
            if let base = firstDts {
                if pkt.pointee.pts != noPts { pkt.pointee.pts -= base }
                if pkt.pointee.dts != noPts { pkt.pointee.dts -= base }
            }
            av_packet_rescale_ts(pkt, inStream.pointee.time_base, outStream.pointee.time_base)
            pkt.pointee.stream_index = 0
            pkt.pointee.pos = -1
            XCTAssertGreaterThanOrEqual(av_interleaved_write_frame(output, pkt), 0)
            written += 1
            if written >= 48 { break }
        }
        XCTAssertGreaterThanOrEqual(av_write_trailer(output), 0)
        avio_closep(&output.pointee.pb)
        avformat_free_context(output)

        XCTAssertGreaterThan(written, 0, "nothing was written")
        XCTAssertGreaterThan(converted, 0, "no packet actually carried an enhancement layer")

        // Re-open what we wrote and read it as a player would.
        let result = try openInput(outPath)
        var closingResult: UnsafeMutablePointer<AVFormatContext>? = result
        defer { avformat_close_input(&closingResult) }

        guard let resultStream = videoStream(result) else { return XCTFail("no video stream in the output") }
        let record = DolbyVisionConverter.configuration(resultStream.pointee.codecpar)
        XCTAssertEqual(record?.dv_profile, 8, "the container still declares dual layer")
        XCTAssertEqual(record?.dv_bl_signal_compatibility_id, 1, "not 8.1")
        XCTAssertEqual(record?.el_present_flag, 0, "the container still signals an enhancement layer")
        XCTAssertEqual(record?.rpu_present_flag, 1, "the RPU claim was lost")

        var sawRpu = false
        while av_read_frame(result, pkt) >= 0 {
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == resultStream.pointee.index else { continue }
            let types = nalTypes(pkt.pointee.data, Int(pkt.pointee.size), lengthSize: 4)
            XCTAssertFalse(types.contains(63), "an enhancement layer NAL reached the file")
            if types.contains(62) { sawRpu = true }
        }
        XCTAssertTrue(sawRpu, "no RPU reached the file")
    }
}
