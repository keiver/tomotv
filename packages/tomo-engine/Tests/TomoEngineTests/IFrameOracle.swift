import Accelerate
import Foundation
import Libavcodec
import Libavformat
import Libavutil
import XCTest

private let SWIFT_AV_FRAME_FLAG_KEY: Int32 = 1 << 1

/// A decoded picture: its presentation time, whether it is a keyframe, and its luma on a 4 px grid.
struct DecodedFrame {
    let seconds: Double
    let key: Bool
    let luma: [Float]

    /// Mean absolute luma difference; 0 for the same picture decoded twice. vDSP, since test builds are unoptimised.
    func distance(to other: DecodedFrame) -> Double {
        guard luma.count == other.luma.count, !luma.isEmpty else { return .infinity }
        var diff = [Float](repeating: 0, count: luma.count)
        vDSP_vsub(other.luma, 1, luma, 1, &diff, 1, vDSP_Length(luma.count))
        var mean: Float = 0
        vDSP_meamgv(diff, 1, &mean, vDSP_Length(luma.count))
        return Double(mean)
    }
}

/// The I-frame rendition read the way a player reads it, with FFmpeg standing in for AVPlayer:
/// fetched over HTTP and each fragment decoded alone.
enum IFrameOracle {
    /// One GET, answered synchronously.
    static func get(_ url: URL) -> (status: Int, body: Data)? {
        let done = DispatchSemaphore(value: 0)
        var result: (Int, Data)?
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        session.dataTask(with: url) { data, response, _ in
            if let response = response as? HTTPURLResponse { result = (response.statusCode, data ?? Data()) }
            done.signal()
        }.resume()
        guard done.wait(timeout: .now() + 30) == .success else { return nil }
        return result
    }

    static func line(_ prefix: String, in playlist: String) -> String? {
        playlist.components(separatedBy: "\n").first { $0.hasPrefix(prefix) }
    }

    /// An attribute's value on a tag line, quoted or not.
    static func attribute(_ name: String, in line: String) -> String? {
        guard let start = line.range(of: ",\(name)=")?.upperBound ?? line.range(of: ":\(name)=")?.upperBound else { return nil }
        let rest = line[start...]
        if rest.first == "\"" { return String(rest.dropFirst().prefix { $0 != "\"" }) }
        return String(rest.prefix { $0 != "," })
    }

    /// Each entry's URI and where it starts on the playlist's timeline (the sum of the EXTINFs before it).
    static func entries(_ playlist: String) -> [(uri: String, start: Double, duration: Double)] {
        var out: [(String, Double, Double)] = []
        var at = 0.0
        var pending: Double?
        for line in playlist.components(separatedBy: "\n") {
            if line.hasPrefix("#EXTINF:") {
                pending = Double(line.dropFirst(8).prefix { $0 != "," })
            } else if let duration = pending, !line.isEmpty, !line.hasPrefix("#") {
                out.append((line, at, duration))
                at += duration
                pending = nil
            }
        }
        return out
    }

    /// The init's first sample entry type (avc1, hvc1...): stsd's version/flags and entry count, then the entry's size.
    static func sampleEntry(_ initSegment: Data) -> String? {
        guard let stsd = initSegment.range(of: Data("stsd".utf8)), stsd.upperBound + 16 <= initSegment.count else { return nil }
        return String(decoding: initSegment[(stsd.upperBound + 12)..<(stsd.upperBound + 16)], as: UTF8.self)
    }

    /// A one-sample fragment's tfdt and sample duration in seconds of the init's track clock, and its mfhd sequence.
    static func timing(initSegment: Data, fragment: Data) -> (tfdt: Double, duration: Double, sequence: UInt32)? {
        func u32(_ data: Data, _ at: Int) -> UInt32 {
            (UInt32(data[at]) << 24) | (UInt32(data[at + 1]) << 16) | (UInt32(data[at + 2]) << 8) | UInt32(data[at + 3])
        }
        func body(_ type: String, _ data: Data) -> Int? { data.range(of: Data(type.utf8))?.upperBound }
        guard let mdhd = body("mdhd", initSegment), let mfhd = body("mfhd", fragment), let tfdt = body("tfdt", fragment),
              let tfhd = body("tfhd", fragment), let trun = body("trun", fragment) else { return nil }
        let timescale = Double(u32(initSegment, mdhd + (initSegment[mdhd] == 1 ? 20 : 12)))
        let decode = fragment[tfdt] == 1 ? (UInt64(u32(fragment, tfdt + 4)) << 32) | UInt64(u32(fragment, tfdt + 8)) : UInt64(u32(fragment, tfdt + 4))
        let tfhdFlags = u32(fragment, tfhd) & 0xFF_FFFF
        let trunFlags = u32(fragment, trun) & 0xFF_FFFF
        let duration: UInt32
        if trunFlags & 0x100 != 0 {
            duration = u32(fragment, trun + 8 + (trunFlags & 0x01 != 0 ? 4 : 0) + (trunFlags & 0x04 != 0 ? 4 : 0))
        } else if tfhdFlags & 0x08 != 0 {
            duration = u32(fragment, tfhd + 8 + (tfhdFlags & 0x01 != 0 ? 8 : 0) + (tfhdFlags & 0x02 != 0 ? 4 : 0))
        } else {
            return nil
        }
        return (Double(decode) / timescale, Double(duration) / timescale, u32(fragment, mfhd + 4))
    }

    struct Entry {
        let start: Double
        let duration: Double
        let status: Int
        let bytes: Int
        let timing: (tfdt: Double, duration: Double, sequence: UInt32)?
        /// What the init and this fragment alone demux and decode to.
        let packets: Int
        let frames: [DecodedFrame]
    }

    struct Rendition {
        let streamInf: String
        let initSegment: Data
        let entries: [Entry]
    }

    /// The master's I-frame line, its playlist and init, then every entry it lists, each decoded alone.
    static func rendition(master masterUrl: URL) throws -> Rendition {
        let master = try XCTUnwrap(get(masterUrl), "no master")
        let masterText = String(decoding: master.body, as: UTF8.self)
        let streamInf = try XCTUnwrap(line("#EXT-X-I-FRAME-STREAM-INF:", in: masterText), "no I-frame line in \(masterText)")
        let playlistUrl = try XCTUnwrap(attribute("URI", in: streamInf).flatMap { URL(string: $0, relativeTo: masterUrl) }, streamInf)
        let playlist = try XCTUnwrap(get(playlistUrl), "no I-frame playlist")
        XCTAssertEqual(playlist.status, 200)
        let text = String(decoding: playlist.body, as: UTF8.self)
        XCTAssertTrue(text.contains("#EXT-X-I-FRAMES-ONLY\n"), text)
        let initUrl = try XCTUnwrap(line("#EXT-X-MAP:", in: text).flatMap { attribute("URI", in: $0) }.flatMap { URL(string: $0, relativeTo: playlistUrl) }, text)
        let initResponse = try XCTUnwrap(get(initUrl), "no I-frame init")
        XCTAssertEqual(initResponse.status, 200)
        let made = try entries(text).map { listed -> Entry in
            let fragment = try XCTUnwrap(get(try XCTUnwrap(URL(string: listed.uri, relativeTo: playlistUrl))), "no answer for \(listed.uri)")
            let decoded = fragment.status == 200 ? decodeEntry(initSegment: initResponse.body, fragment: fragment.body) : nil
            return Entry(start: listed.start, duration: listed.duration, status: fragment.status, bytes: fragment.body.count,
                         timing: fragment.status == 200 ? timing(initSegment: initResponse.body, fragment: fragment.body) : nil,
                         packets: decoded?.packets ?? 0, frames: decoded?.frames ?? [])
        }
        return Rendition(streamInf: streamInf, initSegment: initResponse.body, entries: made)
    }

    /// An entry decoded alone, as a player decodes it: the init, then its fragment.
    static func decodeEntry(initSegment: Data, fragment: Data) -> (packets: Int, frames: [DecodedFrame])? {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("iframe-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: file) }
        guard (try? (initSegment + fragment).write(to: file)) != nil else { return nil }
        return decode(file.path)
    }

    /// Every video picture `path` decodes to, in presentation order, and the video packets read.
    static func decode(_ path: String) -> (packets: Int, frames: [DecodedFrame])? {
        var ctx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_open_input(&ctx, path, nil, nil) >= 0, let input = ctx else { return nil }
        defer { avformat_close_input(&ctx) }
        guard avformat_find_stream_info(input, nil) >= 0 else { return nil }
        let index = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard index >= 0, let stream = input.pointee.streams[Int(index)], let par = stream.pointee.codecpar,
              let codec = avcodec_find_decoder(par.pointee.codec_id) else { return nil }
        var decoderCtx = avcodec_alloc_context3(codec)
        defer { avcodec_free_context(&decoderCtx) }
        guard let decoder = decoderCtx, avcodec_parameters_to_context(decoder, par) >= 0 else { return nil }
        decoder.pointee.pkt_timebase = stream.pointee.time_base
        guard avcodec_open2(decoder, codec, nil) >= 0 else { return nil }
        var packetPtr = av_packet_alloc()
        var framePtr = av_frame_alloc()
        defer {
            av_packet_free(&packetPtr)
            av_frame_free(&framePtr)
        }
        guard let packet = packetPtr, let frame = framePtr else { return nil }
        let timeBase = av_q2d(stream.pointee.time_base)
        var frames: [DecodedFrame] = []
        var packets = 0
        func drain() {
            while avcodec_receive_frame(decoder, frame) >= 0 {
                frames.append(DecodedFrame(seconds: Double(frame.pointee.best_effort_timestamp) * timeBase,
                                           key: frame.pointee.flags & SWIFT_AV_FRAME_FLAG_KEY != 0, luma: luma(frame)))
                av_frame_unref(frame)
            }
        }
        while av_read_frame(input, packet) >= 0 {
            if packet.pointee.stream_index == index {
                packets += 1
                _ = avcodec_send_packet(decoder, packet)
                drain()
            }
            av_packet_unref(packet)
        }
        _ = avcodec_send_packet(decoder, nil)
        drain()
        return (packets, frames.sorted { $0.seconds < $1.seconds })
    }

    private static func luma(_ frame: UnsafeMutablePointer<AVFrame>) -> [Float] {
        guard let base = frame.pointee.data.0 else { return [] }
        let stride = Int(frame.pointee.linesize.0)
        var out: [Float] = []
        for y in Swift.stride(from: 0, to: Int(frame.pointee.height), by: 4) {
            for x in Swift.stride(from: 0, to: Int(frame.pointee.width), by: 4) { out.append(Float(base[y * stride + x])) }
        }
        return out
    }
}
