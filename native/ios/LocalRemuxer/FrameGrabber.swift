//
//  FrameGrabber.swift
//  TomoTV
//
//  One keyframe of a source as a small JPEG, made on demand for the tvOS chapter
//  list. AVKit asks for the artwork asynchronously as the player item loads, so
//  nothing here holds the start, and nothing runs on the main thread: the loopback
//  server's routing queue is the caller, and it blocks there until the file exists.
//
//  The grabber opens the source on a context of its own. The playing remux
//  session never sees it; the two share nothing but the link. Frames land in the
//  chapter frame pool, keyed by item, so a replay decodes nothing it already has.
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
    /// Measured on real frames at this width: 5 to 13 KB against 100 to 165 KB as PNG.
    private static let jpegQuality = 0.7
    /// Frames decoded, not served from the directory. Read by tests.
    private(set) var decodes = 0
    /// Packets read past the seek before a request gives up. A keyframe decodes from
    /// its own packet; the budget covers decoders that hold a frame of delay.
    private static let packetBudget = 64
    /// Packets decoded from the start when the source cannot seek; bounds a poster's cost on
    /// a file with a broken index to its first seconds.
    private static let forwardPacketBudget = 300
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

    /// The JPEG for the keyframe at or before `ms` of source time, written on the first
    /// request and served from the directory afterwards. Nil when the source has no video,
    /// the time is past its end, or the grab failed; the caller answers 404.
    /// The file is named by its time unless the caller names it. A source that refuses the
    /// seek answers nothing, unless `nearestFromStart` lets the frames it can reach stand in:
    /// right for a poster, wrong for a chapter.
    func frame(atMilliseconds ms: Int64, named name: String? = nil, nearestFromStart: Bool = false) -> URL? {
        guard ms >= 0 else { return nil }
        let url = directory.appendingPathComponent(name ?? "\(ms).jpg")
        if touch(url) { return url }
        return queue.sync {
            if touch(url) { return url }
            guard !isCancelled, open() else { return nil }
            return grab(ms: ms, to: url, nearestFromStart: nearestFromStart) ? url : nil
        }
    }

    /// A hit refreshes the file's date, which is the pool's eviction order.
    private func touch(_ url: URL) -> Bool {
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return true
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

    private func grab(ms: Int64, to url: URL, nearestFromStart: Bool) -> Bool {
        guard let opened = input else { return false }
        let started = Date()
        let duration = opened.pointee.duration
        if duration != SWIFT_AV_NOPTS_VALUE, ms * 1000 > duration { return false }

        // Backward from the target: the keyframe at or before the chapter, the same
        // contract the pipeline's seek-restart relies on.
        let containerStart = opened.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : opened.pointee.start_time
        let targetUs = ms * 1000 + containerStart
        let seekRet = avformat_seek_file(opened, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
        // An index that keys no video frame refuses every seek. Reopened at the start, the
        // frames within the budget stand in, the last one decoded being the nearest.
        let forward = seekRet < 0
        if forward {
            guard nearestFromStart else {
                NSLog("[FrameGrabber] seek to %lldms failed: %@", ms, grabErr(seekRet))
                return false
            }
            close()
            guard open() else { return false }
        }
        guard let input, let decoder, let stream = input.pointee.streams[Int(videoIndex)] else { return false }
        avcodec_flush_buffers(decoder)
        let sought = Date()

        guard let frame = av_frame_alloc(), let kept = av_frame_alloc(), let pkt = av_packet_alloc() else { return false }
        defer {
            var freeingFrame: UnsafeMutablePointer<AVFrame>? = frame
            av_frame_free(&freeingFrame)
            var freeingKept: UnsafeMutablePointer<AVFrame>? = kept
            av_frame_free(&freeingKept)
            var freeingPacket: UnsafeMutablePointer<AVPacket>? = pkt
            av_packet_free(&freeingPacket)
        }
        let microseconds = AVRational(num: 1, den: 1_000_000)
        let budget = forward ? Self.forwardPacketBudget : Self.packetBudget

        var packets = 0
        var decoded = false
        readLoop: while packets < budget, Date().timeIntervalSince(started) < Self.deadline, !isCancelled {
            if av_read_frame(input, pkt) < 0 {
                // End of file: drain the decoder for a frame it may still hold.
                _ = avcodec_send_packet(decoder, nil)
                if avcodec_receive_frame(decoder, frame) >= 0 {
                    av_frame_unref(kept)
                    av_frame_ref(kept, frame)
                    decoded = true
                }
                break
            }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIndex else { continue }
            packets += 1
            guard avcodec_send_packet(decoder, pkt) >= 0 else { continue }
            while avcodec_receive_frame(decoder, frame) >= 0 {
                av_frame_unref(kept)
                av_frame_ref(kept, frame)
                decoded = true
                guard forward else { break readLoop }
                let pts = frame.pointee.best_effort_timestamp
                if pts != SWIFT_AV_NOPTS_VALUE, av_rescale_q(pts, stream.pointee.time_base, microseconds) >= targetUs { break readLoop }
            }
        }
        guard decoded else { return false }
        let decodedAt = Date()

        let w = Int(kept.pointee.width)
        let h = Int(kept.pointee.height)
        guard w > 0, h > 0 else { return false }
        let outW = Self.width
        let outH = max(1, Int((Double(h) * Double(outW) / Double(w)).rounded()))
        // Every pixel goes through libswscale, whatever the source format: 8-bit, 10-bit,
        // 4:2:2 and 4:1:1 alike, and never through a Swift loop.
        let srcFormat = AVPixelFormat(rawValue: kept.pointee.format)
        sws = sws_getCachedContext(sws, Int32(w), Int32(h), srcFormat,
                                   Int32(outW), Int32(outH), AV_PIX_FMT_RGBA,
                                   Int32(SWS_BILINEAR.rawValue), nil, nil, nil)
        guard let sws else { return false }

        var rgba = Data(count: outW * outH * 4)
        let rows: Int32 = rgba.withUnsafeMutableBytes { raw -> Int32 in
            guard let dst = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
            var srcData = (0 ..< 4).map { plane(kept, $0).map { UnsafePointer($0) } }
            var srcStride = (0 ..< 4).map { linesize(kept, $0) }
            var dstData: [UnsafeMutablePointer<UInt8>?] = [dst, nil, nil, nil]
            var dstStride: [Int32] = [Int32(outW * 4), 0, 0, 0]
            return sws_scale(sws, &srcData, &srcStride, 0, Int32(h), &dstData, &dstStride)
        }
        guard rows > 0 else { return false }
        let scaled = Date()

        // The directory can be gone by now: the pool trims between plays and a session removes
        // its own on stop. Recreating it is a no-op when it is still there.
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard ImageWriter.jpeg(rgba, width: outW, height: outH, quality: Self.jpegQuality, to: url) else { return false }
        decodes += 1
        NSLog("[FrameGrabber] %@", String(format: "%lldms %dx%d %@ %.2fs decode %.2fs (%d packets) jpeg %.2fs",
                                          ms, outW, outH, forward ? "reopen" : "seek",
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

/// Where chapter frames live between plays: `Caches/chapter-frames/<itemId>/<ms>.jpg`,
/// outside the session tree so no session sweep touches it, trimmed to a fixed size with
/// the least recently used frames going first. The OS may purge Caches on top of this.
enum ChapterFramePool {
    static let capBytes: Int64 = 64 * 1024 * 1024
    private static let queue = DispatchQueue(label: "tv.tomo.framepool", qos: .utility)

    static var root: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("chapter-frames", isDirectory: true)
    }

    /// Where the item's frames live, whether or not the directory exists yet. Nil for an id
    /// that is not a plain token, which must never become a path.
    static func location(for itemId: String, in root: URL = root) -> URL? {
        guard !itemId.isEmpty, itemId.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else { return nil }
        return root.appendingPathComponent(itemId, isDirectory: true)
    }

    /// The item's directory, created, with a trim scheduled behind it.
    static func directory(for itemId: String, in root: URL = root) -> URL? {
        guard let dir = location(for: itemId, in: root) else { return nil }
        guard (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil else { return nil }
        queue.async { trim(toBytes: capBytes, root: root) }
        return dir
    }

    /// Oldest files go first until the pool fits. Only a directory this pass emptied is removed:
    /// an empty one it found was just created for a frame that has not been written yet.
    static func trim(toBytes cap: Int64, root: URL = root) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        var files: [(url: URL, size: Int64, modified: Date)] = []
        for item in items {
            let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey]
            guard let entries = try? fm.contentsOfDirectory(at: item, includingPropertiesForKeys: Array(keys)) else { continue }
            for entry in entries {
                let values = try? entry.resourceValues(forKeys: keys)
                files.append((entry, Int64(values?.fileSize ?? 0), values?.contentModificationDate ?? .distantPast))
            }
        }
        var total = files.reduce(0) { $0 + $1.size }
        var touched = Set<URL>()
        for file in files.sorted(by: { $0.modified < $1.modified }) where total > cap {
            try? fm.removeItem(at: file.url)
            total -= file.size
            touched.insert(file.url.deletingLastPathComponent())
        }
        for item in touched where (try? fm.contentsOfDirectory(atPath: item.path))?.isEmpty == true {
            try? fm.removeItem(at: item)
        }
    }
}

/// A grabber with a token of its own, for the lanes that run no remux session: direct play
/// and the server transcode. Same shape as PlaylistShim. Frames go to the pool; only an item
/// without a usable id gets a private directory, removed with the provider.
final class FrameProvider {
    let token = "frame-" + UUID().uuidString
    let grabber: FrameGrabber
    private let privateDirectory: URL?

    init(inputUrl: String, itemId: String) throws {
        if let pooled = ChapterFramePool.directory(for: itemId) {
            privateDirectory = nil
            grabber = FrameGrabber(inputUrl: inputUrl, directory: pooled)
        } else {
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            let dir = caches.appendingPathComponent("localremux", isDirectory: true).appendingPathComponent(token, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            privateDirectory = dir
            grabber = FrameGrabber(inputUrl: inputUrl, directory: dir)
        }
    }

    func stop() {
        grabber.stop()
        if let privateDirectory { try? FileManager.default.removeItem(at: privateDirectory) }
    }
}
