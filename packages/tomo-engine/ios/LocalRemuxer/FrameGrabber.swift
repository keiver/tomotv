//
//  FrameGrabber.swift
//  TomoTV
//
//  One keyframe of a source as a small JPEG, made on demand and off the main thread. The
//  grabber opens the source on a format context of its own, so the playing remux session
//  shares nothing with it but the link. Frames land in the chapter frame pool.
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
    /// Measured on 1080p sources at this width: 3 to 39 KB a frame, most near 20 KB.
    private static let jpegQuality = 0.7
    /// Frames decoded, not served from the directory. Read by tests.
    private(set) var decodes = 0
    /// Packets read past the seek before a request gives up. A keyframe decodes from
    /// its own packet; the budget covers decoders that hold a frame of delay.
    private static let packetBudget = 64
    /// Packets decoded from the start when the source cannot seek; bounds a poster's cost on
    /// a file with a broken index to its first seconds.
    private static let forwardPacketBudget = 300
    /// Packets skipped before a stream's first keyframe (a tuner recording joins mid-GOP): a GOP
    /// of ten seconds at sixty frames, read without decoding.
    private static let scanPacketBudget = 600
    private static let deadline: TimeInterval = 10
    /// A grab past this is heading for the deadline; below it a card is simply working.
    private static let slowGrab: TimeInterval = 2
    /// A bar under this share of its side is noise, and a crop keeping under half the picture
    /// is a dark scene, not a bar (mpv's autocrop guard).
    private static let minBar = 0.02
    private static let minKeep = 0.5

    private let inputUrl: String
    /// Headers the origin requires (a live manifest's User-Agent), as the remux pipeline sends them.
    private let httpHeaders: [String: String]
    /// A live source: opened with a small probe and read from its first keyframe, never sought.
    private let live: Bool
    private let directory: URL
    /// The pool `directory` sits in, trimmed behind every write; nil for a private or session directory.
    private let pool: URL?
    /// The pool generation this grabber was made in; a purge since makes its source one the app has left.
    private let epoch: Int
    /// One context answers every request in turn. Concurrent chapter requests queue
    /// here, each on its own routing thread.
    let queue = DispatchQueue(label: "tv.tomo.framegrab", qos: .utility)
    private let lock = NSLock()
    private var cancelled = false

    var input: UnsafeMutablePointer<AVFormatContext>?
    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    var videoIndex: Int32 = -1
    /// The I-frame rendition's track, built on its first request (FrameGrabber+IFrames.swift).
    var iframeTrack: IFrameTrack?
    /// An MPEG-TS source's byte map, shared with the session's pipeline: seeks land by estimate.
    var byteMap: ByteTimeMap?
    private var sws: UnsafeMutablePointer<SwsContext>?
    /// A source that would not open is not retried: every chapter would pay the same failure.
    private var openFailed = false
    /// The container and its streams were read, whether or not a video stream was in them.
    private(set) var sourceOpened = false
    /// The live input stopped delivering packets before cancellation, rather than a sampling limit.
    private(set) var liveReadEnded = false
    /// Off for a live read opened beside another on an origin whose limit is unknown: a kick then ends the read.
    var reconnects = true
    /// Bytes the last live grab read through the container's own I/O: the whole pull for a raw stream, the playlist alone for HLS.
    private(set) var bytesRead: Int64 = 0
    /// Why the source would not open, for the live grab's log line.
    private(set) var openFailure: String?
    /// What was opened: the variant picked off a multivariant playlist, else the input itself.
    private(set) var openedUrl: String?
    /// The last live grab's clip, for its log line: how it was made, wall time and packets written.
    private(set) var clipMode = "none"
    private(set) var clipMs: Double = 0
    private(set) var clipPackets = 0
    /// A card-sized preview: every clip is encoded down to this, so the cards that loop it decode little.
    private static let clipMaxBitrate: Int64 = 1_000_000
    private static let clipMaxHeight: Int32 = 360
    private static let clipFrameRate: Int32 = 15
    /// A clip holding less than this share of its span is not written: a read cut short by the watchdog,
    /// a cancel or a timestamp wrap would loop a fraction of a second on the card.
    private static let clipMinShare = 0.6
    /// The simulator has no hardware decoder; asking for one there fails every clip with -12906 before falling back.
    #if targetEnvironment(simulator)
    private static let clipHardwareDecode = false
    #else
    private static let clipHardwareDecode = true
    #endif
    /// The live read's first keyframe packet: the clip starts on it.
    private var keyPacket: UnsafeMutablePointer<AVPacket>?

    init(inputUrl: String, directory: URL, pool: URL? = nil, epoch: Int = ChapterFramePool.epoch,
         httpHeaders: [String: String] = [:], live: Bool = false) {
        self.inputUrl = inputUrl
        self.httpHeaders = httpHeaders
        self.live = live
        self.directory = directory
        self.pool = pool
        self.epoch = epoch
    }

    deinit { close() }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    /// Interrupt callback: aborts blocking network I/O once the owner has stopped.
    private static let interruptCallback: @convention(c) (UnsafeMutableRawPointer?) -> Int32 = { opaque in
        guard let opaque else { return 0 }
        return Unmanaged<FrameGrabber>.fromOpaque(opaque).takeUnretainedValue().isCancelled ? 1 : 0
    }

    /// The JPEG for the keyframe at or before `ms`, written on the first request and served from the
    /// directory after. Nil when the source has no video, the time is past its end, or the grab failed.
    /// A source that refuses the seek answers nothing unless `nearestFromStart` lets the reachable frames stand in.
    /// `alternatives` are other times tried in turn while the frame found is a fade, a black or a white.
    func frame(atMilliseconds ms: Int64, named name: String? = nil, nearestFromStart: Bool = false,
               alternatives: [Int64] = [], enhanced: Bool = false, batch: Int = 1) -> URL? {
        guard ms >= 0, ChapterFramePool.epoch == epoch else { return nil }
        let url = directory.appendingPathComponent(name ?? "\(ms).jpg")
        if touch(url) { return url }
        return queue.sync {
            if touch(url) { return url }
            guard !isCancelled, open() else { return nil }
            let started = Date()
            guard let picture = pick(ms: ms, alternatives: alternatives, nearestFromStart: nearestFromStart, batch: batch),
                  write(picture, to: url, enhanced: enhanced) else { return nil }
            if !alternatives.isEmpty || batch > 1 {
                NSLog("[FrameGrabber] %@", String(format: "picked %lldms took %lldms luma %.0f contrast %.0f %@ crop %@ %.0fms",
                                                  ms, picture.ms, picture.score.luma, picture.score.contrast, picture.matrix,
                                                  picture.crop?.description ?? "none", Date().timeIntervalSince(started) * 1000))
            }
            // The pool was emptied while this decoded: the frame answers for a source the
            // app has left, so it goes with the rest of that pool.
            guard ChapterFramePool.epoch == epoch else {
                try? FileManager.default.removeItem(at: url)
                return nil
            }
            return url
        }
    }

    /// The chapter keyframe at or before `ms`, nudged off a fade or a solid card. The mark comes
    /// first, then a few seconds later (footage inside the chapter's own scene), a little earlier
    /// as a last resort; `pick` keeps the first frame `FrameScore` calls usable.
    func chapterFrame(atMilliseconds ms: Int64) -> URL? {
        let offsets: [Int64] = [2000, 5000, 10000, 15000, -4000, -8000]
        let alternatives = offsets.map { ms + $0 }.filter { $0 >= 0 && $0 != ms }
        return frame(atMilliseconds: ms, alternatives: alternatives)
    }

    enum LiveGrab: Equatable {
        /// The burst in order, the preview clip when one was written, the first keyframe's pts.
        case frames([URL], clip: URL?, pts: Int64?)
        /// The keyframe is the one the caller already shows: the live edge has not moved a segment.
        case unchanged
        case none
    }

    /// A burst off one open: the first keyframe the source gives, then a keyframe every `interval`
    /// seconds of stream time across `span` stream seconds, `wall` bounding the read's wall clock.
    /// Files are `<base>-<i>.jpg`, each announced through `onFrame` as it is written; the base is
    /// unique per grab, so nothing is served from the directory; `clipSpan` adds `<base>-clip.mp4`.
    func liveBurst(named base: String, span: TimeInterval, interval: TimeInterval, count: Int, wall: TimeInterval,
                   clipSpan: TimeInterval = 0, unlessPts shown: Int64? = nil, onFrame: ((URL, Int) -> Void)? = nil) -> LiveGrab {
        guard ChapterFramePool.epoch == epoch else { return .none }
        let url = { [directory] (i: Int) in directory.appendingPathComponent("\(base)-\(i).jpg") }
        let clipFile = directory.appendingPathComponent("\(base)-clip.mp4")
        clipMode = "none"
        clipMs = 0
        clipPackets = 0
        return queue.sync {
            liveReadEnded = false
            guard !isCancelled, open() else { return .none }
            let started = Date()
            let first = decode(target: .firstKeyframe, nearestFromStart: false, batch: 1, started: started).first
            guard let first else {
                if let pb = input?.pointee.pb { bytesRead = pb.pointee.bytes_read }
                return .none
            }
            let pts = first.pts == SWIFT_AV_NOPTS_VALUE ? nil : first.pts
            if let pts, pts == shown { return .unchanged }
            guard write(first, to: url(0), enhanced: false) else { return .none }
            var written = [url(0)]
            onFrame?(url(0), 0)
            func emitKey(_ picture: Picture) -> Bool {
                let file = url(written.count)
                guard write(picture, to: file, enhanced: false) else { return false }
                written.append(file)
                onFrame?(file, written.count - 1)
                return true
            }
            var clip: URL?
            var resume: Int64?
            if clipSpan > 0 {
                let clipStarted = Date()
                resume = recordClip(first, to: clipFile, span: clipSpan, interval: interval, keys: count - 1, wall: wall, started: started, emitKey: emitKey)
                if resume != nil { clip = clipFile }
                clipMs = Date().timeIntervalSince(clipStarted) * 1000
            }
            decodeFollowing(first, span: span, interval: interval, count: count - written.count, wall: wall, started: started,
                            after: resume, emit: emitKey)
            if let pb = input?.pointee.pb { bytesRead = pb.pointee.bytes_read }
            guard ChapterFramePool.epoch == epoch else {
                for file in written + [clip].compactMap({ $0 }) { try? FileManager.default.removeItem(at: file) }
                return .none
            }
            return .frames(written, clip: clip, pts: pts)
        }
    }

    /// `span` stream seconds from the first keyframe as a video-only MP4, made the way playback makes
    /// video: copied when this device decodes it, else through VideoTranscoder. Burst keyframes on the
    /// way go to `emitKey`. Returns the pts the next one is due at, nil when no clip was written.
    private func recordClip(_ first: Picture, to file: URL, span: TimeInterval, interval: TimeInterval, keys: Int,
                            wall: TimeInterval, started: Date, emitKey: (Picture) -> Bool) -> Int64? {
        guard first.pts != SWIFT_AV_NOPTS_VALUE, let keyPacket, let input, let decoder,
              let inStream = input.pointee.streams[Int(videoIndex)], let inPar = inStream.pointee.codecpar else { return nil }
        // A small probe can leave the size unset; the decoder has read it off the first keyframe.
        if inPar.pointee.width <= 0 || inPar.pointee.height <= 0 {
            inPar.pointee.width = decoder.pointee.width
            inPar.pointee.height = decoder.pointee.height
        }
        // A TS demux leaves Annex-B extradata empty; the opening keyframe carries the parameter sets.
        let codec = inPar.pointee.codec_id
        let lifted = inPar.pointee.extradata_size == 0 && (codec == AV_CODEC_ID_H264 || codec == AV_CODEC_ID_HEVC)
            ? TierRewrapper.annexBParameterSets(keyPacket, hevc: codec == AV_CODEC_ID_HEVC) : nil
        let copyable = !VideoTranscoder.needsTranscode(stream: inStream) && (inPar.pointee.extradata_size > 0 || lifted != nil)
        // A copy stands in only when the encoder cannot be made.
        let transcoder = VideoTranscoder(inputStream: inStream, keyframeInterval: span, maxBitrate: Self.clipMaxBitrate,
                                         maxHeight: Self.clipMaxHeight, maxFrameRate: Self.clipFrameRate,
                                         hardwareDecode: Self.clipHardwareDecode, quiet: true)
        guard transcoder != nil || copyable else { return nil }
        clipMode = transcoder == nil ? "copy" : "transcode"

        // Written under a name the disk seed never serves, and renamed once whole: a grab killed mid-write leaves no clip.
        let partial = file.appendingPathExtension("part")
        var outputCtx: UnsafeMutablePointer<AVFormatContext>?
        guard avformat_alloc_output_context2(&outputCtx, nil, "mp4", partial.path) >= 0, let output = outputCtx else { return nil }
        var committed = false
        defer {
            if !committed {
                if output.pointee.pb != nil { avio_closep(&output.pointee.pb) }
                avformat_free_context(output)
                try? FileManager.default.removeItem(at: partial)
            }
        }
        guard let outStream = avformat_new_stream(output, nil), let outPar = outStream.pointee.codecpar,
              avcodec_parameters_copy(outPar, transcoder?.encoderParameters ?? inPar) >= 0 else { return nil }
        if transcoder == nil, let lifted, let buf = av_mallocz(lifted.count + SWIFT_AV_INPUT_BUFFER_PADDING_SIZE) {
            lifted.withUnsafeBytes { raw in buf.copyMemory(from: raw.baseAddress!, byteCount: lifted.count) }
            av_freep(&outPar.pointee.extradata)
            outPar.pointee.extradata = buf.assumingMemoryBound(to: UInt8.self)
            outPar.pointee.extradata_size = Int32(lifted.count)
        }
        // AVFoundation refuses the muxer's default 'hev1' sample entry; Apple requires 'hvc1'.
        outPar.pointee.codec_tag = outPar.pointee.codec_id == AV_CODEC_ID_HEVC ? DownloadRepackager.tag("hvc1") : 0
        let packetTb = transcoder?.encoderTimeBase ?? inStream.pointee.time_base
        outStream.pointee.time_base = packetTb
        guard avio_open(&output.pointee.pb, partial.path, AVIO_FLAG_WRITE) >= 0 else { return nil }
        var muxOpts: OpaquePointer?
        av_dict_set(&muxOpts, "movflags", "faststart", 0)
        let header = avformat_write_header(output, &muxOpts)
        av_dict_free(&muxOpts)
        guard header >= 0 else { return nil }

        let inTb = inStream.pointee.time_base
        let outTb = outStream.pointee.time_base
        let toTicks = { (seconds: Double) in Int64((seconds * Double(inTb.den) / Double(inTb.num)).rounded()) }
        // The clip's zero is the keyframe's presentation time: a decode-time zero puts its reorder delay
        // in the file as an empty leading edit, a hole at the head of every loop. The span is read on
        // decode time, which climbs where presentation does not.
        let origin = first.pts
        let decodeOrigin = keyPacket.pointee.dts != SWIFT_AV_NOPTS_VALUE ? keyPacket.pointee.dts : first.pts
        let spanTicks = toTicks(span)
        let minTicks = toTicks(span * Self.clipMinShare)
        let keyStep = toTicks(interval)
        var nextKey = first.pts + keyStep
        var keysLeft = keys
        var written = 0
        var lastPts: Int64 = 0
        func write(_ packet: UnsafeMutablePointer<AVPacket>) {
            guard let copy = av_packet_clone(packet) else { return }
            var owned: UnsafeMutablePointer<AVPacket>? = copy
            defer { av_packet_free(&owned) }
            copy.pointee.stream_index = 0
            let pts = copy.pointee.pts
            av_packet_rescale_ts(copy, packetTb, outTb)
            if av_interleaved_write_frame(output, copy) >= 0 {
                written += 1
                if pts != SWIFT_AV_NOPTS_VALUE { lastPts = max(lastPts, pts) }
            }
        }
        /// Onto the clip's own timeline from zero, then copied or transcoded; false once past the span.
        func take(_ packet: UnsafeMutablePointer<AVPacket>) -> Bool {
            let dts = packet.pointee.dts != SWIFT_AV_NOPTS_VALUE ? packet.pointee.dts : packet.pointee.pts
            guard dts - decodeOrigin < spanTicks else { return false }
            guard let shifted = av_packet_clone(packet) else { return true }
            var owned: UnsafeMutablePointer<AVPacket>? = shifted
            defer { av_packet_free(&owned) }
            shifted.pointee.pts -= origin
            shifted.pointee.dts = dts - origin
            guard let transcoder else {
                write(shifted)
                return true
            }
            transcoder.process(packet: shifted) { write($0) }
            return !transcoder.failed
        }
        guard take(keyPacket) else { return nil }
        guard let pkt = av_packet_alloc() else { return nil }
        var freeing: UnsafeMutablePointer<AVPacket>? = pkt
        defer { av_packet_free(&freeing) }
        readLoop: while Date().timeIntervalSince(started) < wall, !isCancelled {
            if readPacket(input, pkt) < 0 { break }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIndex, pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE else { continue }
            // Leading pictures of an open GOP reference the GOP before the read; nothing after them does.
            if pkt.pointee.pts < first.pts { continue }
            if keysLeft > 0, pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0, pkt.pointee.pts >= nextKey,
               let picture = decodeKeyframe(pkt, stream: inStream), emitKey(picture) {
                nextKey = pkt.pointee.pts + keyStep
                keysLeft -= 1
            }
            if !take(pkt) { break readLoop }
        }
        if let transcoder {
            // The encoder and a deinterlacer's lookahead hold frames until the end is signalled.
            transcoder.process(packet: nil) { write($0) }
            guard !transcoder.failed else { return nil }
        }
        guard lastPts >= minTicks, av_write_trailer(output) >= 0 else { return nil }
        avio_closep(&output.pointee.pb)
        avformat_free_context(output)
        committed = true
        guard (try? FileManager.default.moveItem(at: partial, to: file)) != nil else {
            try? FileManager.default.removeItem(at: partial)
            return nil
        }
        clipPackets = written
        return nextKey
    }

    /// A keyframe packet decoded on its own, the way the burst reads every keyframe.
    private func decodeKeyframe(_ pkt: UnsafeMutablePointer<AVPacket>, stream: UnsafeMutablePointer<AVStream>) -> Picture? {
        guard let decoder, let frame = av_frame_alloc() else { return nil }
        var freeing: UnsafeMutablePointer<AVFrame>? = frame
        defer {
            av_frame_free(&freeing)
            avcodec_flush_buffers(decoder)
        }
        guard avcodec_send_packet(decoder, pkt) >= 0 else { return nil }
        _ = avcodec_send_packet(decoder, nil)
        var picture: Picture?
        while avcodec_receive_frame(decoder, frame) >= 0 {
            if picture == nil { picture = makePicture(from: frame, stream: stream, ms: 0, forward: false) }
        }
        return picture
    }

    /// The keyframes after a decoded one, the first at or past each `interval` of stream time (or at
    /// `after`), handed to `emit` in turn until it declines, `count`, `span` or `wall` runs out.
    private func decodeFollowing(_ first: Picture, span: TimeInterval, interval: TimeInterval, count: Int,
                                 wall: TimeInterval, started: Date, after: Int64? = nil, emit: (Picture) -> Bool) {
        guard count > 0, let input, let decoder, let stream = input.pointee.streams[Int(videoIndex)] else { return }
        var freeingFrame: UnsafeMutablePointer<AVFrame>? = av_frame_alloc()
        var freeingPacket: UnsafeMutablePointer<AVPacket>? = av_packet_alloc()
        // Before the guard: one allocation failing still frees the other, and both frees take a nil.
        defer {
            av_frame_free(&freeingFrame)
            av_packet_free(&freeingPacket)
        }
        guard let frame = freeingFrame, let pkt = freeingPacket else { return }
        let timeBase = stream.pointee.time_base
        let step = Int64((interval * Double(timeBase.den) / Double(timeBase.num)).rounded())
        let spanPts = Int64((span * Double(timeBase.den) / Double(timeBase.num)).rounded())
        var kept = 0
        var nextPts = after ?? (first.pts == SWIFT_AV_NOPTS_VALUE ? nil : first.pts + step)
        var endPts = first.pts == SWIFT_AV_NOPTS_VALUE ? nil : first.pts + spanPts
        readLoop: while kept < count, Date().timeIntervalSince(started) < wall, !isCancelled {
            if readPacket(input, pkt) < 0 { break }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIndex else { continue }
            // Keyframes alone: each decodes on its own, and the decoder skips the rest anyway.
            guard pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0 else { continue }
            guard avcodec_send_packet(decoder, pkt) >= 0 else { continue }
            // A keyframe held back for reordering comes out on a drain; the flush readies the next.
            _ = avcodec_send_packet(decoder, nil)
            while avcodec_receive_frame(decoder, frame) >= 0 {
                let pts = frame.pointee.best_effort_timestamp
                if pts == SWIFT_AV_NOPTS_VALUE { continue }
                if nextPts == nil { nextPts = pts + step }
                if endPts == nil { endPts = pts + spanPts }
                if let end = endPts, pts >= end { break readLoop }
                guard let due = nextPts, pts >= due else { continue }
                guard let picture = makePicture(from: frame, stream: stream, ms: 0, forward: false), emit(picture) else { break readLoop }
                nextPts = pts + step
                kept += 1
                if kept >= count { break readLoop }
            }
            avcodec_flush_buffers(decoder)
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

    func readPacket(_ input: UnsafeMutablePointer<AVFormatContext>, _ packet: UnsafeMutablePointer<AVPacket>) -> Int32 {
        let result = av_read_frame(input, packet)
        if live, result < 0, !isCancelled { liveReadEnded = true }
        return result
    }

    func open() -> Bool {
        if input != nil { return true }
        if openFailed { return false }
        openFailed = true

        EngineLog.configure()
        var ctx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard ctx != nil else { return false }
        let interrupt = AVIOInterruptCB(callback: Self.interruptCallback, opaque: Unmanaged.passUnretained(self).toOpaque())
        ctx!.pointee.interrupt_callback = interrupt

        var opts = httpOptions()
        if live {
            // Extension-less segment URLs (RemuxSession+Pipeline), and a probe bounded well under
            // FFmpeg's 5 MB default: one keyframe is wanted, not every program in the multiplex.
            av_dict_set(&opts, "extension_picky", "0", 0)
            av_dict_set(&opts, "probesize", "1500000", 0)
            av_dict_set(&opts, "analyzeduration", "1500000", 0)
        }
        let url = live ? resolveVariant(interrupt: interrupt) : inputUrl
        openedUrl = url
        var ret = avformat_open_input(&ctx, url, nil, &opts)
        av_dict_free(&opts)
        // Silent: the caller reports the reason once per item (localRemux.ts). A file still being
        // copied, or one the server cannot read, fails here on every retry; a timed-out read is tried again.
        guard ret >= 0, let opened = ctx else {
            openFailure = "open: \(grabErr(ret))"
            if ret == -ETIMEDOUT { openFailed = false }
            return false
        }
        var closing: UnsafeMutablePointer<AVFormatContext>? = opened
        ret = probeStreamInfo(opened)
        guard ret >= 0 else {
            openFailure = "probe: \(grabErr(ret))"
            avformat_close_input(&closing)
            if ret == -ETIMEDOUT { openFailed = false }
            return false
        }
        sourceOpened = true

        let index = av_find_best_stream(opened, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard index >= 0, let stream = opened.pointee.streams[Int(index)], let params = stream.pointee.codecpar,
              let codec = avcodec_find_decoder(params.pointee.codec_id),
              let dec = avcodec_alloc_context3(codec) else {
            NSLog("[FrameGrabber] no decodable video stream")
            openFailure = "no decodable video stream"
            avformat_close_input(&closing)
            return false
        }
        var freeing: UnsafeMutablePointer<AVCodecContext>? = dec
        // Live: every other stream is discarded, so the HLS demuxer reads one variant's segments
        // and no audio (measured on a 5-variant master: 11 to 16 s a grab reading them all).
        if live {
            for i in 0 ..< Int(opened.pointee.nb_streams) where Int32(i) != index {
                opened.pointee.streams[i]?.pointee.discard = AVDISCARD_ALL
            }
        }
        // A poster is a keyframe; the decoder never touches the frames between them.
        dec.pointee.skip_frame = AVDISCARD_NONKEY
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

    private func httpOptions() -> OpaquePointer? {
        sourceHttpOptions(headers: httpHeaders, reconnects: reconnects, file: !live)
    }

    /// A playlist input read through FFmpeg's own HTTP (no App Transport Security in the way): a
    /// multivariant playlist resolves to the variant a card needs, anything else is opened as given.
    private func resolveVariant(interrupt: AVIOInterruptCB) -> String {
        guard let parsed = URL(string: inputUrl), ["m3u8", "m3u"].contains(parsed.pathExtension.lowercased()) else { return inputUrl }
        var pb: UnsafeMutablePointer<AVIOContext>? = nil
        var opts = httpOptions()
        var cb = interrupt
        let ret = avio_open2(&pb, inputUrl, AVIO_FLAG_READ, &cb, &opts)
        av_dict_free(&opts)
        guard ret >= 0, let reader = pb else { return inputUrl }
        var text = Data()
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        while text.count < 1024 * 1024 {
            let got = chunk.withUnsafeMutableBufferPointer { avio_read(reader, $0.baseAddress, Int32($0.count)) }
            guard got > 0 else { break }
            text.append(contentsOf: chunk[0 ..< Int(got)])
        }
        // A shortlink master: its variants resolve against where it landed.
        var base = inputUrl
        var location: UnsafeMutablePointer<UInt8>? = nil
        if av_opt_get(reader, "location", 1 /* AV_OPT_SEARCH_CHILDREN */, &location) >= 0, let location {
            if let landed = String(validatingUTF8: UnsafeRawPointer(location).assumingMemoryBound(to: CChar.self)), !landed.isEmpty { base = landed }
            av_free(location)
        }
        var closingPb = pb
        avio_closep(&closingPb)
        guard let master = String(data: text, encoding: .utf8) else { return inputUrl }
        return LiveVariantPicker.pick(master, base: base) ?? inputUrl
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
        if keyPacket != nil { av_packet_free(&keyPacket) }
        decoder = nil
        input = nil
        sws = nil
    }

    /// A decoded frame scaled for the JPEG, with what the poster search reads off it.
    private struct Picture {
        let rgba: Data
        let width: Int
        let height: Int
        /// Decoded forward from the start of an unseekable source: the only frames it has.
        let forward: Bool
        let score: FrameScore
        /// RGB colour distribution, for the representative-of-the-batch pick.
        let histogram: [Double]
        /// The position asked for and the matrix the RGB came through, for the log.
        let ms: Int64
        let matrix: String
        /// The frame's own timestamp in the stream's time base, what a second decode of it seeks by.
        let pts: Int64
        /// The picture inside its black bars, nil for an all-black frame.
        let box: ContentBox?
        /// The bars cut off this picture.
        let crop: CropFraction?
    }

    /// What a decode seeks to: a position, or one keyframe a batch already decoded.
    private enum Target {
        case milliseconds(Int64)
        case keyframe(pts: Int64, ms: Int64)
        /// Wherever the source is now: no seek, the first keyframe read.
        case firstKeyframe

        var ms: Int64 {
            switch self {
            case .milliseconds(let ms), .keyframe(_, let ms): return ms
            case .firstKeyframe: return 0
            }
        }
    }

    /// The frame for the card. A batch reads a run of keyframes from `ms` and takes the most
    /// representative (ffmpeg's thumbnail measure), decoded once more with the batch's bars cut off.
    /// Otherwise the frame at `ms`, or with alternatives the first usable among them in order, else
    /// the most contrasted seen.
    private func pick(ms: Int64, alternatives: [Int64], nearestFromStart: Bool, batch: Int) -> Picture? {
        let started = Date()
        if batch > 1 {
            let pictures = decode(target: .milliseconds(ms), nearestFromStart: nearestFromStart, batch: batch, started: started)
            guard let best = representative(pictures) else { return nil }
            guard let crop = Self.crop(across: pictures), best.pts != SWIFT_AV_NOPTS_VALUE else { return best }
            return decode(target: .keyframe(pts: best.pts, ms: best.ms), nearestFromStart: nearestFromStart,
                          batch: 1, started: started, crop: crop).first ?? best
        }
        var best: Picture?
        for candidate in [ms] + alternatives {
            guard let picture = decode(target: .milliseconds(candidate), nearestFromStart: nearestFromStart, batch: 1, started: started).first else { continue }
            if alternatives.isEmpty || picture.forward { return picture }
            if picture.score.isUsable { return picture }
            if best.map({ picture.score.contrast > $0.score.contrast }) ?? true { best = picture }
        }
        return best
    }

    /// The batch's most representative frame: nearest by colour histogram to the batch average, the
    /// measure ffmpeg's thumbnail filter uses. A black or blank frame is a colour-distribution
    /// outlier and loses. The average is taken over the usable frames alone when any are, so a
    /// long dark opening cannot pull the pick into the black.
    private func representative(_ pictures: [Picture]) -> Picture? {
        guard pictures.count > 1 else { return pictures.first }
        let usable = pictures.filter { $0.score.isUsable }
        let pool = usable.isEmpty ? pictures : usable
        guard pool.count > 1 else { return pool.first }
        var avg = [Double](repeating: 0, count: 768)
        for p in pool { for i in 0 ..< 768 { avg[i] += p.histogram[i] } }
        for i in 0 ..< 768 { avg[i] /= Double(pool.count) }
        return pool.min { squaredError($0.histogram, avg) < squaredError($1.histogram, avg) }
    }

    private func squaredError(_ a: [Double], _ b: [Double]) -> Double {
        var sum = 0.0
        for i in 0 ..< a.count { let d = a[i] - b[i]; sum += d * d }
        return sum
    }

    /// The bars every frame of the batch shares: the union of their content boxes (a black frame
    /// adds nothing, a dark one only its true bars), nil when too thin to matter or too deep to be bars.
    private static func crop(across pictures: [Picture]) -> CropFraction? {
        guard let first = pictures.first, pictures.allSatisfy({ $0.width == first.width && $0.height == first.height }) else { return nil }
        var union: ContentBox?
        for picture in pictures {
            guard let box = picture.box else { continue }
            union = union.map { $0.union(box) } ?? box
        }
        guard var box = union else { return nil }
        let w = Double(first.width), h = Double(first.height)
        let bars = [Double(box.x1) / w, Double(first.width - 1 - box.x2) / w, Double(box.y1) / h, Double(first.height - 1 - box.y2) / h]
        guard bars.contains(where: { $0 >= minBar }), Double(box.width) / w >= minKeep, Double(box.height) / h >= minKeep else { return nil }
        // The scaled edge row blends bar and picture; a cropped side gives up one more pixel.
        if box.x1 > 0 { box.x1 += 1 }
        if box.y1 > 0 { box.y1 += 1 }
        if box.x2 < first.width - 1 { box.x2 -= 1 }
        if box.y2 < first.height - 1 { box.y2 -= 1 }
        return CropFraction(box, width: first.width, height: first.height)
    }

    /// Keyframes at or after the target: one for a chapter grab, a run of `batch` for a poster. A seek
    /// that the index refuses reopens at the start and reads forward, the reachable frames standing in.
    private func decode(target: Target, nearestFromStart: Bool, batch: Int, started: Date, crop: CropFraction? = nil) -> [Picture] {
        guard let opened = input else { return [] }
        let ms = target.ms
        let containerStart = opened.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : opened.pointee.start_time
        let seekRet: Int32
        // A frame's own pts seeks in its stream's time base, so no rounding lands on the keyframe before it.
        let reached: (_ pts: Int64, _ timeBase: AVRational) -> Bool
        switch target {
        case .milliseconds:
            let duration = opened.pointee.duration
            if duration != SWIFT_AV_NOPTS_VALUE, ms * 1000 > duration { return [] }
            // Backward from the target: the keyframe at or before the chapter, the same
            // contract the pipeline's seek-restart relies on.
            let targetUs = ms * 1000 + containerStart
            seekRet = avformat_seek_file(opened, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
            reached = { pts, timeBase in av_rescale_q(pts, timeBase, AVRational(num: 1, den: 1_000_000)) >= targetUs }
        case .keyframe(let pts, _):
            seekRet = avformat_seek_file(opened, videoIndex, Int64.min, pts, pts, SWIFT_AVSEEK_FLAG_BACKWARD)
            reached = { framePts, _ in framePts >= pts }
        case .firstKeyframe:
            seekRet = 0
            reached = { _, _ in true }
        }
        // An index that keys no video frame refuses every seek. Reopened at the start, the
        // frames within the budget stand in, the last one decoded being the nearest.
        let forward = seekRet < 0
        if forward {
            guard nearestFromStart else {
                NSLog("[FrameGrabber] seek to %lldms failed: %@", ms, grabErr(seekRet))
                return []
            }
            close()
            guard open() else { return [] }
        }
        guard let input, let decoder, let stream = input.pointee.streams[Int(videoIndex)] else { return [] }
        avcodec_flush_buffers(decoder)

        var freeingFrame: UnsafeMutablePointer<AVFrame>? = av_frame_alloc()
        var freeingKept: UnsafeMutablePointer<AVFrame>? = av_frame_alloc()
        var freeingPacket: UnsafeMutablePointer<AVPacket>? = av_packet_alloc()
        // Before the guard: one allocation failing still frees the others, and every free takes a nil.
        defer {
            av_frame_free(&freeingFrame)
            av_frame_free(&freeingKept)
            av_packet_free(&freeingPacket)
        }
        guard let frame = freeingFrame, let kept = freeingKept, let pkt = freeingPacket else { return [] }
        // The chapter grab stops at one keyframe; a batch reads a keyframe per GOP, so its ceiling
        // scales with the batch. The deadline is the real bound on a slow link.
        let ceiling = forward ? Self.forwardPacketBudget : Self.packetBudget * max(1, batch)

        var results: [Picture] = []
        var packets = 0
        var scanned = 0
        var keptValid = false
        var sawKeyframe = false
        readLoop: while packets < ceiling, Date().timeIntervalSince(started) < Self.deadline, !isCancelled {
            if readPacket(input, pkt) < 0 {
                // End of file: drain the decoder for a frame it may still hold.
                _ = avcodec_send_packet(decoder, nil)
                if avcodec_receive_frame(decoder, frame) >= 0, let picture = makePicture(from: frame, stream: stream, ms: ms, forward: forward, crop: crop) {
                    results.append(picture)
                }
                break
            }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIndex else { continue }
            // Keyframes alone reach the decoder: nothing else decodes without the one before it,
            // and the decoder logs a line for every packet it cannot use.
            guard pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0 else {
                if sawKeyframe { packets += 1 } else { scanned += 1 }
                if scanned >= Self.scanPacketBudget { break }
                continue
            }
            sawKeyframe = true
            packets += 1
            guard avcodec_send_packet(decoder, pkt) >= 0 else { continue }
            if live, case .firstKeyframe = target {
                if keyPacket == nil { keyPacket = av_packet_alloc() } else { av_packet_unref(keyPacket) }
                if let keyPacket { av_packet_ref(keyPacket, pkt) }
            }
            // A keyframe held back for reordering comes out on a drain; the flush readies the next.
            _ = avcodec_send_packet(decoder, nil)
            var arrived = false
            while avcodec_receive_frame(decoder, frame) >= 0 {
                if forward {
                    let pts = frame.pointee.best_effort_timestamp
                    if pts != SWIFT_AV_NOPTS_VALUE, reached(pts, stream.pointee.time_base) {
                        if let picture = makePicture(from: frame, stream: stream, ms: ms, forward: true, crop: crop) { results.append(picture) }
                        arrived = true
                        break
                    }
                    av_frame_unref(kept); av_frame_ref(kept, frame); keptValid = true
                } else if let picture = makePicture(from: frame, stream: stream, ms: ms, forward: false, crop: crop) {
                    results.append(picture)
                }
            }
            avcodec_flush_buffers(decoder)
            if forward, arrived { break readLoop }
            if !forward, results.count >= batch { break readLoop }
        }
        // A forward read that never reached the target: the last frame decoded stands in.
        if forward, results.isEmpty, keptValid, let picture = makePicture(from: kept, stream: stream, ms: ms, forward: true, crop: crop) {
            results.append(picture)
        }
        // Only a slow grab is worth a line: a full grid decodes one batch per card, and the number
        // that matters is the one approaching the deadline that abandons the frame.
        let elapsed = Date().timeIntervalSince(started)
        if elapsed >= Self.slowGrab {
            NSLog("[FrameGrabber] %@", String(format: "slow grab %lldms %@ %.2fs (%d packets, %d frames)",
                                              ms, forward ? "reopen" : "seek", elapsed, packets, results.count))
        }
        return results
    }

    /// Scales a decoded frame to the JPEG size and reads its score and histogram off it. Called
    /// while `frame` still holds this picture, before the next receive overwrites it.
    private func makePicture(from decoded: UnsafeMutablePointer<AVFrame>, stream: UnsafeMutablePointer<AVStream>,
                             ms: Int64, forward: Bool, crop: CropFraction? = nil) -> Picture? {
        let w = Int(decoded.pointee.width)
        let h = Int(decoded.pointee.height)
        guard w > 0, h > 0 else { return nil }
        // An anamorphic source carries its shape in the sample aspect ratio; the JPEG takes the display shape.
        var sar = av_guess_sample_aspect_ratio(input, stream, decoded)
        if sar.num <= 0 || sar.den <= 0 { sar = AVRational(num: 1, den: 1) }
        let displayW = Double(w) * Double(sar.num) / Double(sar.den)
        // With a crop the whole frame is scaled larger, so the picture inside the bars comes out at
        // `width` by the height its own shape gives.
        var outW = Self.width
        var outH = max(1, Int((Double(h) * Double(outW) / displayW).rounded()))
        var cutSize = (width: outW, height: outH)
        if let crop {
            let cutH = max(1, Int((Double(Self.width) * Double(h) * crop.height / (displayW * crop.width)).rounded()))
            cutSize = (Self.width, cutH)
            outW = max(Self.width, Int((Double(Self.width) / crop.width).rounded()))
            outH = max(cutH, Int((Double(cutH) / crop.height).rounded()))
        }
        // Every pixel goes through libswscale, whatever the source format: 8-bit, 10-bit,
        // 4:2:2 and 4:1:1 alike, and never through a Swift loop.
        let srcFormat = AVPixelFormat(rawValue: decoded.pointee.format)
        sws = sws_getCachedContext(sws, Int32(w), Int32(h), srcFormat,
                                   Int32(outW), Int32(outH), AV_PIX_FMT_RGBA,
                                   Int32(SWS_BILINEAR.rawValue), nil, nil, nil)
        guard let sws else { return nil }
        // Left unset, libswscale converts every YUV frame as BT.601 limited range.
        let fullRange: Int32 = decoded.pointee.color_range == AVCOL_RANGE_JPEG ? 1 : 0
        let matrix = Self.matrix(of: decoded)
        sws_setColorspaceDetails(sws, sws_getCoefficients(matrix.coefficients), fullRange,
                                 sws_getCoefficients(SWS_CS_DEFAULT), 1, 0, 1 << 16, 1 << 16)

        var rgba = Data(count: outW * outH * 4)
        let rows: Int32 = rgba.withUnsafeMutableBytes { raw -> Int32 in
            guard let dst = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
            var srcData = (0 ..< 4).map { plane(decoded, $0).map { UnsafePointer($0) } }
            var srcStride = (0 ..< 4).map { linesize(decoded, $0) }
            var dstData: [UnsafeMutablePointer<UInt8>?] = [dst, nil, nil, nil]
            var dstStride: [Int32] = [Int32(outW * 4), 0, 0, 0]
            return sws_scale(sws, &srcData, &srcStride, 0, Int32(h), &dstData, &dstStride)
        }
        guard rows > 0 else { return nil }
        var picture = (rgba: rgba, width: outW, height: outH)
        if let crop { picture = Self.cut(rgba, width: outW, height: outH, to: crop, size: cutSize) }
        return Picture(rgba: picture.rgba, width: picture.width, height: picture.height, forward: forward,
                       score: FrameScore(rgba: picture.rgba, width: picture.width, height: picture.height),
                       histogram: FrameScore.histogram(rgba: picture.rgba, width: picture.width, height: picture.height),
                       ms: ms, matrix: matrix.name + (fullRange == 1 ? " full" : ""),
                       pts: decoded.pointee.best_effort_timestamp,
                       box: crop == nil ? FrameScore.contentBox(rgba: rgba, width: outW, height: outH) : nil,
                       crop: crop)
    }

    /// `size` pixels copied out of a tightly packed RGBA from the crop's top left corner.
    private static func cut(_ rgba: Data, width: Int, height: Int, to crop: CropFraction,
                            size: (width: Int, height: Int)) -> (rgba: Data, width: Int, height: Int) {
        let outW = min(size.width, width)
        let outH = min(size.height, height)
        let x = max(0, min(Int((crop.left * Double(width)).rounded()), width - outW))
        let y = max(0, min(Int((crop.top * Double(height)).rounded()), height - outH))
        var out = Data(count: outW * outH * 4)
        out.withUnsafeMutableBytes { dst in
            rgba.withUnsafeBytes { src in
                for row in 0 ..< outH {
                    let from = src.baseAddress!.advanced(by: ((y + row) * width + x) * 4)
                    dst.baseAddress!.advanced(by: row * outW * 4).copyMemory(from: from, byteCount: outW * 4)
                }
            }
        }
        return (out, outW, outH)
    }

    private func write(_ picture: Picture, to url: URL, enhanced: Bool) -> Bool {
        // The directory can be gone by now: the pool trims between plays and a session removes
        // its own on stop. Recreating it is a no-op when it is still there.
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard ImageWriter.jpeg(picture.rgba, width: picture.width, height: picture.height,
                               quality: Self.jpegQuality, enhanced: enhanced, to: url) else { return false }
        decodes += 1
        if let pool { ChapterFramePool.scheduleTrim(root: pool) }
        return true
    }

    /// The YUV matrix for the RGB conversion: the frame's own tag, else BT.709 at HD sizes and
    /// BT.601 below, the rule mpv and libplacebo apply to untagged video.
    private static func matrix(of frame: UnsafeMutablePointer<AVFrame>) -> (coefficients: Int32, name: String) {
        switch frame.pointee.colorspace {
        case AVCOL_SPC_BT709: return (SWS_CS_ITU709, "bt709")
        case AVCOL_SPC_FCC: return (SWS_CS_FCC, "fcc")
        case AVCOL_SPC_BT470BG, AVCOL_SPC_SMPTE170M: return (SWS_CS_ITU601, "bt601")
        case AVCOL_SPC_SMPTE240M: return (SWS_CS_SMPTE240M, "smpte240m")
        case AVCOL_SPC_BT2020_NCL, AVCOL_SPC_BT2020_CL: return (SWS_CS_BT2020, "bt2020")
        default:
            let hd = frame.pointee.width >= 1280 || frame.pointee.height > 576
            return hd ? (SWS_CS_ITU709, "bt709 untagged") : (SWS_CS_ITU601, "bt601 untagged")
        }
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

/// The picture inside its black bars, inclusive pixel edges.
struct ContentBox: Equatable {
    var x1: Int, y1: Int, x2: Int, y2: Int
    var width: Int { x2 - x1 + 1 }
    var height: Int { y2 - y1 + 1 }

    func union(_ other: ContentBox) -> ContentBox {
        ContentBox(x1: min(x1, other.x1), y1: min(y1, other.y1), x2: max(x2, other.x2), y2: max(y2, other.y2))
    }
}

/// A crop as shares of the picture's sides, so it applies to the same frame at any scale.
struct CropFraction: CustomStringConvertible {
    let left: Double, top: Double, right: Double, bottom: Double
    var width: Double { right - left }
    var height: Double { bottom - top }

    init(_ box: ContentBox, width: Int, height: Int) {
        left = Double(box.x1) / Double(width)
        top = Double(box.y1) / Double(height)
        right = Double(box.x2 + 1) / Double(width)
        bottom = Double(box.y2 + 1) / Double(height)
    }

    var description: String { String(format: "l%.3f t%.3f r%.3f b%.3f", left, top, right, bottom) }
}

/// What the poster search reads off a scaled frame, from every fourth pixel of every fourth row.
struct FrameScore {
    /// Mean luma, 0 to 255.
    let luma: Double
    /// Luma standard deviation.
    let contrast: Double
    /// Below the band is a black or a fade-out, above it a white or a fade-in; flat is a dissolve.
    static let usableLuma = 40.0 ... 170.0
    static let usableContrast = 25.0
    /// A row or column whose mean luma stays at or under this is a bar (ffmpeg cropdetect's 24/255).
    static let barLuma = 24.0

    var isUsable: Bool { Self.usableLuma.contains(luma) && contrast >= Self.usableContrast }

    /// The content box, scanned inward from each edge to the first row or column over `barLuma`,
    /// columns read within the rows found. Nil when every row is a bar.
    static func contentBox(rgba: Data, width: Int, height: Int, stride: Int = 2) -> ContentBox? {
        guard width > 0, height > 0 else { return nil }
        return rgba.withUnsafeBytes { raw -> ContentBox? in
            let pixels = raw.bindMemory(to: UInt8.self)
            func luma(_ x: Int, _ y: Int) -> Double {
                let i = (y * width + x) * 4
                return 0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1]) + 0.0722 * Double(pixels[i + 2])
            }
            func rowIsBar(_ y: Int) -> Bool {
                var sum = 0.0, count = 0.0
                for x in Swift.stride(from: 0, to: width, by: stride) { sum += luma(x, y); count += 1 }
                return sum / count <= barLuma
            }
            func columnIsBar(_ x: Int, _ y1: Int, _ y2: Int) -> Bool {
                var sum = 0.0, count = 0.0
                for y in Swift.stride(from: y1, through: y2, by: stride) { sum += luma(x, y); count += 1 }
                return sum / count <= barLuma
            }
            var y1 = 0
            while y1 < height, rowIsBar(y1) { y1 += 1 }
            guard y1 < height else { return nil }
            var y2 = height - 1
            while y2 > y1, rowIsBar(y2) { y2 -= 1 }
            var x1 = 0
            while x1 < width, columnIsBar(x1, y1, y2) { x1 += 1 }
            guard x1 < width else { return nil }
            var x2 = width - 1
            while x2 > x1, columnIsBar(x2, y1, y2) { x2 -= 1 }
            return ContentBox(x1: x1, y1: y1, x2: x2, y2: y2)
        }
    }

    init(rgba: Data, width: Int, height: Int, stride: Int = 4) {
        var count = 0.0, sum = 0.0, sumSquares = 0.0
        rgba.withUnsafeBytes { raw in
            let pixels = raw.bindMemory(to: UInt8.self)
            var y = 0
            while y < height {
                var x = 0
                while x < width {
                    let i = (y * width + x) * 4
                    let luma = 0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1]) + 0.0722 * Double(pixels[i + 2])
                    count += 1
                    sum += luma
                    sumSquares += luma * luma
                    x += stride
                }
                y += stride
            }
        }
        luma = count > 0 ? sum / count : 0
        contrast = count > 0 ? (sumSquares / count - luma * luma).squareRoot() : 0
    }

    /// A 768-bin RGB histogram (256 per channel) from the same sampled pixels, the colour
    /// distribution the representative-frame pick compares against the batch average.
    static func histogram(rgba: Data, width: Int, height: Int, stride: Int = 4) -> [Double] {
        var bins = [Double](repeating: 0, count: 768)
        rgba.withUnsafeBytes { raw in
            let pixels = raw.bindMemory(to: UInt8.self)
            var y = 0
            while y < height {
                var x = 0
                while x < width {
                    let i = (y * width + x) * 4
                    bins[Int(pixels[i])] += 1
                    bins[256 + Int(pixels[i + 1])] += 1
                    bins[512 + Int(pixels[i + 2])] += 1
                    x += stride
                }
                y += stride
            }
        }
        return bins
    }
}

/// One trim waits per pool: a write behind it queues no other, one after it started queues its own.
struct TrimGate {
    private var waiting = Set<String>()

    /// True when no trim waits for the pool, which the caller then queues.
    mutating func take(_ pool: String) -> Bool { waiting.insert(pool).inserted }

    mutating func start(_ pool: String) { waiting.remove(pool) }
}

/// Where chapter frames live between plays: `Caches/chapter-frames/<itemId>/<ms>.jpg`,
/// outside the session tree so no session sweep touches it, trimmed to a fixed size with
/// the least recently used frames going first. The OS may purge Caches on top of this.
enum ChapterFramePool {
    static let capBytes: Int64 = 100 * 1024 * 1024
    private static let queue = DispatchQueue(label: "tv.tomo.framepool", qos: .utility)
    private static let lock = NSLock()
    private static var generation = 0
    private static var gate = TrimGate()

    /// Which pool the frames on disk belong to. A grab that finishes after a purge drops its own.
    static var epoch: Int {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    /// Empties the pool. Item ids repeat across servers, so nothing here may outlive a switch.
    static func purge(root: URL = root) {
        lock.lock()
        generation += 1
        lock.unlock()
        try? FileManager.default.removeItem(at: root)
    }

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
        scheduleTrim(root: root)
        return dir
    }

    /// A trim queued behind whatever is being written, so the pool never stays over the cap.
    /// A burst's writes share the one already waiting: it reads the pool when it starts.
    static func scheduleTrim(root: URL = root) {
        lock.lock()
        let fresh = gate.take(root.path)
        lock.unlock()
        guard fresh else { return }
        queue.async {
            lock.lock()
            gate.start(root.path)
            lock.unlock()
            trim(toBytes: capBytes, root: root)
        }
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

    /// The server lanes' I-frame rendition, when the provider was started with one.
    private(set) var iframes: ProviderIFrames?

    init(inputUrl: String, itemId: String, iframes: (transcode: Bool, durationSeconds: Double)? = nil) throws {
        if let pooled = ChapterFramePool.directory(for: itemId) {
            privateDirectory = nil
            grabber = FrameGrabber(inputUrl: inputUrl, directory: pooled, pool: ChapterFramePool.root)
        } else {
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            let dir = caches.appendingPathComponent("localremux", isDirectory: true).appendingPathComponent(token, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            privateDirectory = dir
            grabber = FrameGrabber(inputUrl: inputUrl, directory: dir)
        }
        if let iframes, iframes.durationSeconds > 0 {
            self.iframes = ProviderIFrames(grabber: grabber, transcode: iframes.transcode, durationSeconds: iframes.durationSeconds)
        }
    }

    func stop() {
        iframes?.stop()
        grabber.stop()
        if let privateDirectory { try? FileManager.default.removeItem(at: privateDirectory) }
    }
}
