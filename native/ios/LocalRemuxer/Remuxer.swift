//
//  Remuxer.swift
//  TomoTV
//
//  On-device remux engine: reads the original file from Jellyfin over HTTP
//  (byte-range capable /stream?Static=true), stream-copies the video and the
//  selected audio track into fragmented-MP4 HLS segments on disk, and models
//  the session AVPlayer sees through LocalHTTPServer (hand-written VOD
//  playlists + numbered .m4s segments).
//
//  Why this shape: AVPlayer cannot ingest decoded frames, but it plays fMP4
//  HLS natively with its own transport UI. Rewrapping the container costs
//  roughly a file copy (no decode, no encode), so an Apple TV does it in
//  stride and the server never spawns a transcode session.
//
//  Seeking follows Jellyfin's own strategy: the media playlist claims the
//  whole duration upfront in uniform segments, and a request for a segment
//  far from the producer's position restarts the pipeline at that segment's
//  timestamp. The mov muxer enforces monotonic DTS across fragments, so every
//  seek-restart tears down and rebuilds the OUTPUT context (input stays open
//  and just seeks); fragment timestamps (tfdt) carry absolute position, so
//  the native seek bar stays truthful even though real fragment boundaries
//  sit on keyframes rather than exact 6-second marks.
//
//  The FFmpeg build ships no hls/segment muxer (it comes from MPVKit, built
//  for mpv, which never muxes), so segmentation is done here: the mp4 muxer
//  runs with frag_custom into a custom write callback, and every explicit
//  fragment flush closes one .m4s file.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's error/constant macros don't survive the Clang importer.
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')
private let SWIFT_AVERROR_EXIT: Int32 = -1_414_092_869 // FFERRTAG('E','X','I','T')
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE: Int32 = 1_000_000
private let SWIFT_AV_PKT_FLAG_KEY: Int32 = 0x0001
private let SWIFT_AVSEEK_FLAG_BACKWARD: Int32 = 1

private func averr(_ code: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 128)
    av_strerror(code, &buf, buf.count)
    return String(cString: buf)
}

/// One subtitle rendition surfaced in the master playlist. `vttUrl` points at
/// Jellyfin's WebVTT endpoint; the local "playlist" for it is a single
/// full-duration segment, which AVPlayer accepts.
struct RemuxSubtitle {
    let index: Int
    let name: String
    let language: String
    let vttUrl: String
    let isDefault: Bool
}

struct RemuxConfig {
    let inputUrl: String
    /// ffprobe/Jellyfin stream index of the audio track to carry. -1 = best.
    let audioStreamIndex: Int
    let durationSeconds: Double
    let subtitles: [RemuxSubtitle]
}

/// A single remux session: FFmpeg pipeline + segment store + playlist model.
/// One session exists at a time (mirrors MultiAudioResourceLoader's model).
final class RemuxSession {
    static let segmentDuration = 6.0
    /// Keep producing this many segments past the one AVPlayer last asked for,
    /// then idle. Prevents eagerly downloading a whole 20GB file.
    private static let aheadWindow = 5
    /// Half-width of the on-disk window kept around the playhead. Segments
    /// outside it are deleted; the producer can always regenerate them with a
    /// seek-restart, so this only bounds disk use.
    private static let keepWindow = 20

    let token = UUID().uuidString
    private let config: RemuxConfig
    private let dir: URL

    private let stateLock = NSLock()
    private var completedSegments = Set<Int>()
    private var producingSegment = 0
    /// The segment AVPlayer asked for most recently — the playhead. Note this
    /// is NOT a high-water mark: after seeking backwards it must move back, or
    /// the producer would stay throttled and freshly written segments would be
    /// pruned the instant they landed.
    private var lastRequestedSegment = 0
    /// Set once the input hits EOF. `lastProducedSegment` is then the highest
    /// segment the real stream actually yielded, which can be below the last
    /// index the playlist declares when the container runs slightly shorter
    /// than the runtime Jellyfin reported.
    private var reachedEnd = false
    private var lastProducedSegment = 0
    private var pendingSeekSegment: Int? = nil
    private var cancelled = false
    private var failed = false

    var segmentCount: Int {
        max(1, Int(ceil(config.durationSeconds / Self.segmentDuration)))
    }

    init(config: RemuxConfig) throws {
        self.config = config
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let root = caches.appendingPathComponent("localremux", isDirectory: true)
        // One session at a time: previous sessions' segments are dead weight.
        try? FileManager.default.removeItem(at: root)
        dir = root.appendingPathComponent(token, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    // MARK: - Lifecycle

    func start() {
        let thread = Thread { [weak self] in
            self?.runPipeline()
        }
        thread.name = "tv.tomo.localremux"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    func stop() {
        stateLock.lock()
        cancelled = true
        stateLock.unlock()
        // The pipeline thread notices `cancelled` between packets (or through
        // the AVIO interrupt callback during a blocking read) and exits; the
        // directory is removed on the next session's init as well.
        try? FileManager.default.removeItem(at: dir)
    }

    private var isCancelled: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cancelled
    }

    // MARK: - Playlists

    func masterPlaylist() -> String {
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        for sub in config.subtitles {
            let name = sub.name.replacingOccurrences(of: "\"", with: "")
            let def = sub.isDefault ? "YES" : "NO"
            var line = "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"\(name)\""
            if !sub.language.isEmpty && sub.language != "und" {
                line += ",LANGUAGE=\"\(sub.language)\""
            }
            line += ",DEFAULT=\(def),AUTOSELECT=NO,FORCED=NO,URI=\"sub\(sub.index).m3u8\"\n"
            out += line
        }
        out += "#EXT-X-STREAM-INF:BANDWIDTH=20000000"
        if !config.subtitles.isEmpty {
            out += ",SUBTITLES=\"subs\""
        }
        out += "\nmedia.m3u8\n"
        return out
    }

    func mediaPlaylist() -> String {
        let segDur = Self.segmentDuration
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        out += "#EXT-X-TARGETDURATION:\(Int(ceil(segDur)) + 4)\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"init.mp4\"\n"
        let count = segmentCount
        for n in 0..<count {
            let dur = n == count - 1
                ? max(0.001, config.durationSeconds - Double(n) * segDur)
                : segDur
            out += String(format: "#EXTINF:%.6f,\n", dur)
            out += "seg\(n).m4s\n"
        }
        out += "#EXT-X-ENDLIST\n"
        return out
    }

    /// Subtitle "playlist": one full-length WebVTT segment fetched straight
    /// from Jellyfin. Valid HLS, and it keeps subtitle bytes off this server.
    func subtitlePlaylist(streamIndex: Int) -> String? {
        guard let sub = config.subtitles.first(where: { $0.index == streamIndex }) else { return nil }
        let dur = max(1, Int(ceil(config.durationSeconds)))
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        out += "#EXT-X-TARGETDURATION:\(dur)\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += String(format: "#EXTINF:%.3f,\n", config.durationSeconds)
        out += "\(sub.vttUrl)\n#EXT-X-ENDLIST\n"
        return out
    }

    // MARK: - Segment serving

    func initSegmentURL() -> URL? {
        let url = dir.appendingPathComponent("init.mp4")
        // Only exists once the first fragment has been split (delay_moov), so
        // this waits roughly as long as a segment request does. AVPlayer asks
        // for it before any segment, while the pipeline is still producing.
        if waitUntil(deadline: 25, { FileManager.default.fileExists(atPath: url.path) }) {
            return url
        }
        return nil
    }

    /// Blocking (bounded) fetch of a segment file, driving seek-restarts when
    /// the player jumps outside the producer's window.
    func segmentURL(_ n: Int) -> URL? {
        guard n >= 0 && n < segmentCount else { return nil }

        stateLock.lock()
        lastRequestedSegment = n
        let done = completedSegments.contains(n)
        let producing = producingSegment
        let sessionFailed = failed
        // Past the real end of the stream: nothing will ever produce this, so
        // answer immediately instead of waiting out the segment timeout.
        let pastEnd = reachedEnd && n > lastProducedSegment
        stateLock.unlock()
        if sessionFailed || (pastEnd && !done) { return nil }

        let url = dir.appendingPathComponent("seg\(n).m4s")
        if done { return url }

        // Outside the imminent window: restart the pipeline at this segment.
        if n < producing || n > producing + Self.aheadWindow {
            stateLock.lock()
            pendingSeekSegment = n
            stateLock.unlock()
        }

        _ = waitUntil(deadline: 20) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.completedSegments.contains(n) || self.failed || self.cancelled
        }

        stateLock.lock()
        let ok = completedSegments.contains(n)
        stateLock.unlock()
        return ok ? url : nil
    }

    private func waitUntil(deadline seconds: Double, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            usleep(100_000)
        }
        return condition()
    }

    // MARK: - FFmpeg pipeline

    /// Interrupt callback: aborts blocking network I/O when the session dies.
    private static let interruptCallback: @convention(c) (UnsafeMutableRawPointer?) -> Int32 = { opaque in
        guard let opaque else { return 0 }
        let session = Unmanaged<RemuxSession>.fromOpaque(opaque).takeUnretainedValue()
        return session.isCancelled ? 1 : 0
    }

    /// Output byte sink: accumulates muxer output; the pipeline moves the
    /// buffer into files at fragment boundaries. Touched only from the
    /// pipeline thread (every av_* output call happens there).
    private var pendingBytes = Data()

    private static let writeCallback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
        guard let opaque, let buf, size > 0 else { return size }
        let session = Unmanaged<RemuxSession>.fromOpaque(opaque).takeUnretainedValue()
        session.pendingBytes.append(buf, count: Int(size))
        return size
    }

    private func takePendingBytes() -> Data {
        let data = pendingBytes
        pendingBytes.removeAll(keepingCapacity: true)
        return data
    }

    /// Byte offset of the first `moof` box, walking the ISO-BMFF box chain
    /// rather than scanning for the literal, so payload bytes can never be
    /// mistaken for a box header. Returns 0 when the data already starts with
    /// a fragment, nil when no `moof` is present.
    private static func firstFragmentOffset(in data: Data) -> Int? {
        var offset = 0
        while offset + 8 <= data.count {
            let size = data.withUnsafeBytes { raw -> UInt64 in
                let b = raw.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self)
                return (UInt64(b[0]) << 24) | (UInt64(b[1]) << 16) | (UInt64(b[2]) << 8) | UInt64(b[3])
            }
            let type = String(decoding: data[(offset + 4)..<(offset + 8)], as: UTF8.self)
            if type == "moof" { return offset }

            var boxSize = size
            if boxSize == 1 {
                // 64-bit largesize follows the header
                guard offset + 16 <= data.count else { return nil }
                boxSize = data.withUnsafeBytes { raw -> UInt64 in
                    let b = raw.baseAddress!.advanced(by: offset + 8).assumingMemoryBound(to: UInt8.self)
                    return (0..<8).reduce(UInt64(0)) { ($0 << 8) | UInt64(b[$1]) }
                }
            }
            guard boxSize >= 8 else { return nil }
            offset += Int(boxSize)
        }
        return nil
    }

    /// Segment type box every HLS fMP4 media segment must start with
    /// (major brand "msdh", compatible with "msdh"/"msix"). AVFoundation
    /// refuses to decode segments that lack it, even though the fragments
    /// themselves are valid.
    private static let stypBox: Data = {
        var box = Data()
        box.append(contentsOf: [0, 0, 0, 24])
        box.append(contentsOf: Array("styp".utf8))
        box.append(contentsOf: Array("msdh".utf8))
        box.append(contentsOf: [0, 0, 0, 0])
        box.append(contentsOf: Array("msdh".utf8))
        box.append(contentsOf: Array("msix".utf8))
        return box
    }()

    private func fail(_ message: String) {
        NSLog("[LocalRemuxer] Pipeline failed: %@", message)
        stateLock.lock()
        failed = true
        stateLock.unlock()
    }

    /// One generation of the mp4 muxer. Rebuilt from scratch on every
    /// seek-restart because the muxer requires monotonic DTS across fragments.
    private final class OutputBox {
        let ctx: UnsafeMutablePointer<AVFormatContext>
        let avio: UnsafeMutablePointer<AVIOContext>
        /// input stream index -> output stream index
        let streamMap: [Int32: Int32]

        init(ctx: UnsafeMutablePointer<AVFormatContext>, avio: UnsafeMutablePointer<AVIOContext>, streamMap: [Int32: Int32]) {
            self.ctx = ctx
            self.avio = avio
            self.streamMap = streamMap
        }

        func free() {
            av_free(avio.pointee.buffer)
            var freeingIO: UnsafeMutablePointer<AVIOContext>? = avio
            avio_context_free(&freeingIO)
            avformat_free_context(ctx)
        }
    }

    private func buildOutput(
        input: UnsafeMutablePointer<AVFormatContext>,
        carrying inputStreams: [Int32],
        opaque: UnsafeMutableRawPointer
    ) -> OutputBox? {
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        var ret = avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil)
        guard ret >= 0, let output = outputCtx else {
            fail("alloc_output: \(averr(ret))")
            return nil
        }

        let ioBufSize = 1 << 16
        guard let ioBuf = av_malloc(ioBufSize) else {
            avformat_free_context(output)
            fail("av_malloc io buffer")
            return nil
        }
        guard let avio = avio_alloc_context(
            ioBuf.assumingMemoryBound(to: UInt8.self), Int32(ioBufSize), 1, opaque, nil, Self.writeCallback, nil
        ) else {
            av_free(ioBuf)
            avformat_free_context(output)
            fail("avio_alloc_context")
            return nil
        }
        output.pointee.pb = avio

        var streamMap = [Int32: Int32]()
        for inIndex in inputStreams {
            guard let inStream = input.pointee.streams[Int(inIndex)],
                  let outStream = avformat_new_stream(output, nil) else {
                fail("avformat_new_stream")
                return nil
            }
            ret = avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar)
            guard ret >= 0 else {
                fail("parameters_copy: \(averr(ret))")
                return nil
            }
            outStream.pointee.codecpar.pointee.codec_tag = 0
            outStream.pointee.time_base = inStream.pointee.time_base
            streamMap[inIndex] = Int32(output.pointee.nb_streams - 1)
        }

        var muxOpts: OpaquePointer? = nil
        // One moof per segment holding a traf per track. Deliberately without
        // separate_moof (splits video and audio into two moof/mdat pairs) and
        // without dash (prepends per-track sidx boxes); both make AVFoundation
        // reject the segment in an HLS context. The styp box Apple requires is
        // prepended in finishSegment(), since the plain mp4 muxer never emits
        // one.
        //
        // delay_moov is deliberately NOT set. It is what FFmpeg suggests for
        // AC3 (whose dac3 box needs bitstream info the muxer only has after a
        // packet), but it makes the muxer fold the first fragment into the
        // moov as a bare mdat with no moof, which is not a valid HLS media
        // segment. AC3/EAC3 are excluded from this path in
        // services/localRemux.ts instead, so the header can be written up
        // front and every segment is a clean moof+mdat.
        av_dict_set(&muxOpts, "movflags", "empty_moov+default_base_moof+frag_custom", 0)
        ret = avformat_write_header(output, &muxOpts)
        av_dict_free(&muxOpts)
        guard ret >= 0 else {
            fail("write_header: \(averr(ret))")
            return nil
        }

        // Bytes emitted by write_header (ftyp + empty moov) are the init
        // segment. Identical every generation, so overwriting is harmless.
        avio_flush(avio)
        do {
            try takePendingBytes().write(to: dir.appendingPathComponent("init.mp4"))
        } catch {
            fail("write init.mp4: \(error.localizedDescription)")
            return nil
        }

        return OutputBox(ctx: output, avio: avio, streamMap: streamMap)
    }

    private func runPipeline() {
        let opaque = Unmanaged.passUnretained(self).toOpaque()

        // ---- Input: opened once; seeks reuse the same context ----
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard inputCtx != nil else { return fail("avformat_alloc_context") }
        inputCtx!.pointee.interrupt_callback = AVIOInterruptCB(callback: Self.interruptCallback, opaque: opaque)

        var openOpts: OpaquePointer? = nil
        av_dict_set(&openOpts, "reconnect", "1", 0)
        av_dict_set(&openOpts, "reconnect_streamed", "1", 0)
        av_dict_set(&openOpts, "reconnect_delay_max", "5", 0)
        var ret = avformat_open_input(&inputCtx, config.inputUrl, nil, &openOpts)
        av_dict_free(&openOpts)
        guard ret >= 0, let input = inputCtx else { return fail("open_input: \(averr(ret))") }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }

        ret = avformat_find_stream_info(input, nil)
        guard ret >= 0 else { return fail("find_stream_info: \(averr(ret))") }

        let videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard videoIn >= 0 else { return fail("no video stream") }

        var audioIn = Int32(config.audioStreamIndex)
        let streamCount = Int32(input.pointee.nb_streams)
        if audioIn < 0 || audioIn >= streamCount
            || input.pointee.streams[Int(audioIn)]?.pointee.codecpar.pointee.codec_type != AVMEDIA_TYPE_AUDIO {
            audioIn = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, videoIn, nil, 0)
        }
        let carried: [Int32] = audioIn >= 0 ? [videoIn, audioIn] : [videoIn]

        // Rebases input timestamps to a zero-based timeline so tfdt matches
        // the playlist's idea of position.
        let startOffsetUs = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : input.pointee.start_time
        let microTb = AVRational(num: 1, den: SWIFT_AV_TIME_BASE)
        let segDur = Self.segmentDuration

        guard var output = buildOutput(input: input, carrying: carried, opaque: opaque) else { return }
        defer { output.free() }

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        guard let pkt = packet else { return fail("av_packet_alloc") }

        var currentSegment = 0
        var awaitingKeyframe = false

        func finishSegment(_ n: Int) {
            av_write_frame(output.ctx, nil) // flush the open fragment
            avio_flush(output.avio)
            var data = takePendingBytes()
            guard !data.isEmpty else { return }

            // The header already shipped ftyp+moov as init.mp4, so a segment
            // should start at its moof. Guard anyway: a muxer that ever
            // prefixes header boxes here would otherwise bake them into a
            // media segment, which AVFoundation rejects with a bare -12889.
            guard let fragmentStart = Self.firstFragmentOffset(in: data) else {
                return fail("segment \(n) contains no moof box")
            }
            if fragmentStart > 0 {
                data = data.subdata(in: fragmentStart..<data.count)
            }

            do {
                try (Self.stypBox + data).write(to: dir.appendingPathComponent("seg\(n).m4s"))
            } catch {
                return fail("write seg\(n): \(error.localizedDescription)")
            }
            stateLock.lock()
            completedSegments.insert(n)
            let playhead = lastRequestedSegment
            stateLock.unlock()
            pruneSegments(outside: (playhead - Self.keepWindow)...(playhead + Self.keepWindow))
        }

        /// Seek input + rebuild output. Returns false on a fatal error.
        func restart(at segment: Int) -> Bool {
            let targetUs = Int64(Double(segment) * segDur * Double(SWIFT_AV_TIME_BASE)) + startOffsetUs
            let seekRet = avformat_seek_file(input, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
            if seekRet < 0 {
                NSLog("[LocalRemuxer] Seek to segment %d failed: %@", segment, averr(seekRet))
            }
            output.free()
            _ = takePendingBytes() // drop bytes of the abandoned fragment
            guard let fresh = buildOutput(input: input, carrying: carried, opaque: opaque) else { return false }
            output = fresh
            currentSegment = segment
            awaitingKeyframe = true
            stateLock.lock()
            producingSegment = segment
            reachedEnd = false
            stateLock.unlock()
            return true
        }

        readLoop: while true {
            // Session control between packets: cancellation, seeks, throttle.
            while true {
                stateLock.lock()
                let stop = cancelled || failed
                let seekTo = pendingSeekSegment
                pendingSeekSegment = nil
                let throttled = producingSegment > lastRequestedSegment + Self.aheadWindow && seekTo == nil && !stop
                stateLock.unlock()

                if stop { break readLoop }
                if let seekTo {
                    guard restart(at: seekTo) else { break readLoop }
                    break
                }
                if !throttled { break }
                usleep(100_000)
            }

            ret = av_read_frame(input, pkt)
            if ret == SWIFT_AVERROR_EOF {
                finishSegment(currentSegment)
                av_write_trailer(output.ctx)
                avio_flush(output.avio)
                _ = takePendingBytes() // trailer bytes (mfra) are not a segment

                // Reaching the end must NOT end the session: the viewer can
                // still seek backwards, and this thread is the only producer.
                // Park until a seek arrives (or the session is torn down)
                // instead of returning, and record how far the real stream
                // actually got so requests past it fail fast rather than
                // waiting out the full segment timeout.
                stateLock.lock()
                reachedEnd = true
                lastProducedSegment = currentSegment
                stateLock.unlock()

                var resume = false
                while !resume {
                    stateLock.lock()
                    let stop = cancelled || failed
                    let pending = pendingSeekSegment
                    stateLock.unlock()
                    if stop { break readLoop }
                    if pending != nil {
                        // Leave it queued; the control block at the top of the
                        // loop performs the restart.
                        resume = true
                        break
                    }
                    usleep(200_000)
                }
                continue
            }
            if ret == SWIFT_AVERROR_EXIT { break }
            if ret < 0 {
                fail("read_frame: \(averr(ret))")
                break
            }
            defer { av_packet_unref(pkt) }

            guard let outIndex = output.streamMap[pkt.pointee.stream_index],
                  let inStream = input.pointee.streams[Int(pkt.pointee.stream_index)],
                  let outStream = output.ctx.pointee.streams[Int(outIndex)] else { continue }

            let isVideo = pkt.pointee.stream_index == videoIn
            let isKey = pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0

            // After a restart: drop everything until the video keyframe that
            // anchors the new segment, so fragments always open on a keyframe.
            if awaitingKeyframe {
                if !(isVideo && isKey) { continue }
                awaitingKeyframe = false
            }

            // Rebase to the zero-based timeline.
            let offsetInTb = av_rescale_q(startOffsetUs, microTb, inStream.pointee.time_base)
            if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.pts -= offsetInTb }
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.dts -= offsetInTb }

            // Segment boundary: a video keyframe at/after the next segment's
            // start time closes the current fragment first.
            if isVideo && isKey && pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let seconds = Double(pkt.pointee.pts) * av_q2d(inStream.pointee.time_base)
                let boundary = Double(currentSegment + 1) * segDur
                if seconds >= boundary && seconds > 0 {
                    finishSegment(currentSegment)
                    currentSegment = min(Int(seconds / segDur), segmentCount - 1)
                    stateLock.lock()
                    producingSegment = currentSegment
                    stateLock.unlock()
                }
            }

            av_packet_rescale_ts(pkt, inStream.pointee.time_base, outStream.pointee.time_base)
            pkt.pointee.stream_index = outIndex
            pkt.pointee.pos = -1

            ret = av_write_frame(output.ctx, pkt)
            if ret < 0 {
                fail("write_frame: \(averr(ret))")
                break
            }
        }
    }

    /// Drop segments that sit outside the window around the playhead.
    private func pruneSegments(outside keep: ClosedRange<Int>) {
        stateLock.lock()
        let prunable = completedSegments.filter { !keep.contains($0) }
        completedSegments.subtract(prunable)
        stateLock.unlock()
        for n in prunable {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("seg\(n).m4s"))
        }
    }
}
