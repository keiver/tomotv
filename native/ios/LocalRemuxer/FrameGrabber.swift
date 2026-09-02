//
//  FrameGrabber.swift
//  TomoTV
//
//  One keyframe of a source as a small PNG, made on demand for the tvOS chapter
//  list. AVKit asks for the artwork asynchronously as the player item loads, so
//  nothing here holds the start, and nothing runs on the main thread: the loopback
//  server's routing queue is the caller, and it blocks there until the file exists.
//
//  The grabber opens the source on a context of its own. The playing remux
//  session never sees it; the two share nothing but the link.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil
import Libswscale

// FFmpeg's error/constant macros don't survive the Clang importer.
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AVSEEK_FLAG_BACKWARD: Int32 = 1

private func grabErr(_ code: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buf, buf.count)
    return String(cString: buf)
}

final class FrameGrabber {
    /// Every frame is scaled to this width; the panel shows them small.
    static let width = 480
    /// Packets read past the seek before a request gives up. A keyframe decodes from
    /// its own packet; the budget covers decoders that hold a frame of delay.
    private static let packetBudget = 64
    private static let deadline: TimeInterval = 10

    private let inputUrl: String
    private let directory: URL
    /// One context answers every request in turn. Concurrent chapter requests queue
    /// here, each on its own routing thread.
    private let queue = DispatchQueue(label: "tv.tomo.framegrab", qos: .utility)
    private let lock = NSLock()
    private var cancelled = false

    private var input: UnsafeMutablePointer<AVFormatContext>?
    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    private var videoIndex: Int32 = -1
    private var sws: UnsafeMutablePointer<SwsContext>?
    /// A source that would not open is not retried: every chapter would pay the same failure.
    private var openFailed = false

    init(inputUrl: String, directory: URL) {
        self.inputUrl = inputUrl
        self.directory = directory
    }

    deinit { close() }

    private var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    /// Interrupt callback: aborts blocking network I/O once the owner has stopped.
    private static let interruptCallback: @convention(c) (UnsafeMutableRawPointer?) -> Int32 = { opaque in
        guard let opaque else { return 0 }
        return Unmanaged<FrameGrabber>.fromOpaque(opaque).takeUnretainedValue().isCancelled ? 1 : 0
    }

    /// The PNG for the keyframe at or before `ms` of source time, written on the first
    /// request and served from the directory afterwards. Nil when the source has no video,
    /// the time is past its end, or the grab failed; the caller answers 404.
    func png(atMilliseconds ms: Int64) -> URL? {
        guard ms >= 0 else { return nil }
        let url = directory.appendingPathComponent("frame-\(ms).png")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        return queue.sync {
            if FileManager.default.fileExists(atPath: url.path) { return url }
            guard !isCancelled, open() else { return nil }
            return grab(ms: ms, to: url) ? url : nil
        }
    }

    /// Stops any blocking read and releases the contexts once the request in flight has let go.
    func stop() {
        lock.lock()
        cancelled = true
        lock.unlock()
        queue.async { [self] in close() }
    }

    // MARK: - FFmpeg

    private func open() -> Bool {
        if input != nil { return true }
        if openFailed { return false }
        openFailed = true

        var ctx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard ctx != nil else { return false }
        ctx!.pointee.interrupt_callback = AVIOInterruptCB(callback: Self.interruptCallback, opaque: Unmanaged.passUnretained(self).toOpaque())

        // The same terms the remux pipeline opens with (Remuxer.swift): reconnects on a
        // dropped link, a bounded wait per I/O call, and no trust store to verify against.
        var opts: OpaquePointer? = nil
        av_dict_set(&opts, "reconnect", "1", 0)
        av_dict_set(&opts, "reconnect_streamed", "1", 0)
        av_dict_set(&opts, "reconnect_delay_max", "5", 0)
        av_dict_set(&opts, "rw_timeout", "15000000", 0)
        av_dict_set(&opts, "tls_verify", "0", 0)
        var ret = avformat_open_input(&ctx, inputUrl, nil, &opts)
        av_dict_free(&opts)
        guard ret >= 0, let opened = ctx else {
            NSLog("[FrameGrabber] open_input failed: %@", grabErr(ret))
            return false
        }
        var closing: UnsafeMutablePointer<AVFormatContext>? = opened
        ret = avformat_find_stream_info(opened, nil)
        guard ret >= 0 else {
            NSLog("[FrameGrabber] find_stream_info failed: %@", grabErr(ret))
            avformat_close_input(&closing)
            return false
        }

        let index = av_find_best_stream(opened, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard index >= 0, let stream = opened.pointee.streams[Int(index)], let params = stream.pointee.codecpar,
              let codec = avcodec_find_decoder(params.pointee.codec_id),
              let dec = avcodec_alloc_context3(codec) else {
            NSLog("[FrameGrabber] no decodable video stream")
            avformat_close_input(&closing)
            return false
        }
        var freeing: UnsafeMutablePointer<AVCodecContext>? = dec
        guard avcodec_parameters_to_context(dec, params) >= 0, avcodec_open2(dec, codec, nil) >= 0 else {
            NSLog("[FrameGrabber] decoder open failed")
            avcodec_free_context(&freeing)
            avformat_close_input(&closing)
            return false
        }

        input = opened
        decoder = dec
        videoIndex = index
        openFailed = false
        return true
    }

    private func close() {
        if let decoder {
            var freeing: UnsafeMutablePointer<AVCodecContext>? = decoder
            avcodec_free_context(&freeing)
        }
        if let input {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }
        if let sws { sws_freeContext(sws) }
        decoder = nil
        input = nil
        sws = nil
    }

    private func grab(ms: Int64, to url: URL) -> Bool {
        guard let input, let decoder else { return false }
        let started = Date()
        let duration = input.pointee.duration
        if duration != SWIFT_AV_NOPTS_VALUE, ms * 1000 > duration { return false }

        guard let frame = av_frame_alloc(), let pkt = av_packet_alloc() else { return false }
        defer {
            var freeingFrame: UnsafeMutablePointer<AVFrame>? = frame
            av_frame_free(&freeingFrame)
            var freeingPacket: UnsafeMutablePointer<AVPacket>? = pkt
            av_packet_free(&freeingPacket)
        }

        // Backward from the target: the keyframe at or before the chapter, the same
        // contract the pipeline's seek-restart relies on.
        let containerStart = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : input.pointee.start_time
        let targetUs = ms * 1000 + containerStart
        let seekRet = avformat_seek_file(input, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
        guard seekRet >= 0 else {
            NSLog("[FrameGrabber] seek to %lldms failed: %@", ms, grabErr(seekRet))
            return false
        }
        avcodec_flush_buffers(decoder)
        let sought = Date()

        var packets = 0
        var decoded = false
        while packets < Self.packetBudget, Date().timeIntervalSince(started) < Self.deadline, !isCancelled {
            if av_read_frame(input, pkt) < 0 {
                // End of file: drain the decoder for a frame it may still hold.
                _ = avcodec_send_packet(decoder, nil)
                decoded = avcodec_receive_frame(decoder, frame) >= 0
                break
            }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIndex else { continue }
            packets += 1
            guard avcodec_send_packet(decoder, pkt) >= 0 else { continue }
            if avcodec_receive_frame(decoder, frame) >= 0 {
                decoded = true
                break
            }
        }
        guard decoded else { return false }
        let decodedAt = Date()

        let w = Int(frame.pointee.width)
        let h = Int(frame.pointee.height)
        guard w > 0, h > 0 else { return false }
        let outW = Self.width
        let outH = max(1, Int((Double(h) * Double(outW) / Double(w)).rounded()))
        // Every pixel goes through libswscale, whatever the source format: 8-bit, 10-bit,
        // 4:2:2 and 4:1:1 alike, and never through a Swift loop.
        let srcFormat = AVPixelFormat(rawValue: frame.pointee.format)
        sws = sws_getCachedContext(sws, Int32(w), Int32(h), srcFormat,
                                   Int32(outW), Int32(outH), AV_PIX_FMT_RGBA,
                                   Int32(SWS_BILINEAR.rawValue), nil, nil, nil)
        guard let sws else { return false }

        var rgba = Data(count: outW * outH * 4)
        let rows: Int32 = rgba.withUnsafeMutableBytes { raw -> Int32 in
            guard let dst = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
            var srcData = (0 ..< 4).map { plane(frame, $0).map { UnsafePointer($0) } }
            var srcStride = (0 ..< 4).map { linesize(frame, $0) }
            var dstData: [UnsafeMutablePointer<UInt8>?] = [dst, nil, nil, nil]
            var dstStride: [Int32] = [Int32(outW * 4), 0, 0, 0]
            return sws_scale(sws, &srcData, &srcStride, 0, Int32(h), &dstData, &dstStride)
        }
        guard rows > 0 else { return false }
        let scaled = Date()

        guard PNGWriter.write(rgba, width: outW, height: outH, to: url) else { return false }
        NSLog("[FrameGrabber] %@", String(format: "%lldms %dx%d seek %.2fs decode %.2fs (%d packets) png %.2fs",
                                          ms, outW, outH,
                                          sought.timeIntervalSince(started),
                                          decodedAt.timeIntervalSince(sought), packets,
                                          Date().timeIntervalSince(scaled)))
        return true
    }

    /// `data[i]` and `linesize[i]` read out of the C tuples AVFrame imports as.
    private func plane(_ frame: UnsafeMutablePointer<AVFrame>, _ index: Int) -> UnsafeMutablePointer<UInt8>? {
        withUnsafePointer(to: &frame.pointee.data) {
            $0.withMemoryRebound(to: UnsafeMutablePointer<UInt8>?.self, capacity: 8) { $0[index] }
        }
    }

    private func linesize(_ frame: UnsafeMutablePointer<AVFrame>, _ index: Int) -> Int32 {
        withUnsafePointer(to: &frame.pointee.linesize) {
            $0.withMemoryRebound(to: Int32.self, capacity: 8) { $0[index] }
        }
    }
}

/// A grabber with a token and a directory of its own, for the lanes that run no remux
/// session: direct play and the server transcode. Same shape as PlaylistShim.
final class FrameProvider {
    let token = "frame-" + UUID().uuidString
    let grabber: FrameGrabber
    private let directory: URL

    init(inputUrl: String) throws {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        directory = caches.appendingPathComponent("localremux", isDirectory: true).appendingPathComponent(token, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        grabber = FrameGrabber(inputUrl: inputUrl, directory: directory)
    }

    func stop() {
        grabber.stop()
        try? FileManager.default.removeItem(at: directory)
    }
}
