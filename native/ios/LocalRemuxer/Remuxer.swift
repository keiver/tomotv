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

/// One selectable audio track. The first entry is muxed into the primary
/// rendition alongside the video; the rest become audio-only renditions.
struct RemuxAudioTrack {
    /// ffprobe/Jellyfin stream index in the source file.
    let index: Int
    let name: String
    let language: String
    let isDefault: Bool
}

struct RemuxConfig {
    let inputUrl: String
    /// Every audio track to expose, default first. Empty means "pick the best
    /// audio stream in the file".
    let audioTracks: [RemuxAudioTrack]
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
    /// Primary rendition first, then one per alternate audio track. Built on
    /// the pipeline thread before production starts; the serving side reads it
    /// under the lock.
    private var renditions: [Rendition] = []
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

        // Audio renditions. The first track has no URI, which in HLS means
        // "this audio is inside the variant itself" — it is muxed with the
        // video. Alternates point at their own audio-only playlists.
        //
        // LANGUAGE is omitted for "und" on purpose: iOS always prefers
        // LANGUAGE for the label, so leaving it out is what makes the picker
        // show NAME instead. Same rule the server-side multi-audio path uses
        // (see HLSManifestGenerator.swift).
        if config.audioTracks.count > 1 {
            for (position, track) in config.audioTracks.enumerated() {
                let name = track.name.replacingOccurrences(of: "\"", with: "")
                var line = "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"\(name)\""
                if !track.language.isEmpty && track.language != "und" {
                    line += ",LANGUAGE=\"\(track.language)\""
                }
                // RFC 8216: when DEFAULT is YES, AUTOSELECT must also be YES if
                // present. Emitting DEFAULT=YES,AUTOSELECT=NO makes
                // AVFoundation reject the whole master playlist (-12642).
                line += position == 0 ? ",DEFAULT=YES,AUTOSELECT=YES" : ",DEFAULT=NO,AUTOSELECT=NO"
                if position > 0 {
                    line += ",URI=\"\(audioPrefix(position)).m3u8\""
                }
                out += line + "\n"
            }
        }

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
        if config.audioTracks.count > 1 {
            out += ",AUDIO=\"audio\""
        }
        if !config.subtitles.isEmpty {
            out += ",SUBTITLES=\"subs\""
        }
        out += "\nmedia.m3u8\n"
        return out
    }

    /// Rendition prefix for the alternate audio track at `position` (>= 1).
    private func audioPrefix(_ position: Int) -> String { "a\(position)" }

    /// Media playlist for a rendition. `prefix` is "" for the primary
    /// (video + default audio) and "aN" for an alternate audio track; the
    /// segment timeline is identical across all of them, because every
    /// rendition is cut on the same boundaries.
    func mediaPlaylist(prefix: String = "") -> String {
        let segDur = Self.segmentDuration
        let initName = prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4"
        var out = "#EXTM3U\n#EXT-X-VERSION:7\n"
        out += "#EXT-X-TARGETDURATION:\(Int(ceil(segDur)) + 4)\n"
        out += "#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
        out += "#EXT-X-MAP:URI=\"\(initName)\"\n"
        let count = segmentCount
        for n in 0..<count {
            let dur = n == count - 1
                ? max(0.001, config.durationSeconds - Double(n) * segDur)
                : segDur
            out += String(format: "#EXTINF:%.6f,\n", dur)
            out += prefix.isEmpty ? "seg\(n).m4s\n" : "\(prefix)-seg\(n).m4s\n"
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

    func initSegmentURL(prefix: String = "") -> URL? {
        let name = prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4"
        let url = dir.appendingPathComponent(name)
        // Written when the rendition's muxer is built, which happens as the
        // pipeline starts. AVPlayer asks for it before any segment.
        if waitUntil(deadline: 25, { FileManager.default.fileExists(atPath: url.path) }) {
            return url
        }
        return nil
    }

    /// Blocking (bounded) fetch of a segment file, driving seek-restarts when
    /// the player jumps outside the producer's window. `prefix` selects the
    /// rendition ("" = primary, "aN" = alternate audio).
    func segmentURL(_ n: Int, prefix: String = "") -> URL? {
        guard n >= 0 && n < segmentCount else { return nil }
        guard let rendition = rendition(withPrefix: prefix) else { return nil }

        stateLock.lock()
        lastRequestedSegment = n
        let done = rendition.completed.contains(n)
        let producing = producingSegment
        let sessionFailed = failed
        // Past the real end of the stream: nothing will ever produce this, so
        // answer immediately instead of waiting out the segment timeout.
        let pastEnd = reachedEnd && n > lastProducedSegment
        stateLock.unlock()
        if sessionFailed || (pastEnd && !done) { return nil }

        let url = dir.appendingPathComponent(rendition.segmentName(n))
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
            return rendition.completed.contains(n) || self.failed || self.cancelled
        }

        stateLock.lock()
        let ok = rendition.completed.contains(n)
        stateLock.unlock()
        return ok ? url : nil
    }

    private func rendition(withPrefix prefix: String) -> Rendition? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return renditions.first { $0.prefix == prefix }
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

    /// Muxer output goes to the rendition that owns the AVIO context, so the
    /// opaque pointer is the Rendition rather than the session. Touched only
    /// from the pipeline thread (every av_* output call happens there).
    private static let writeCallback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
        guard let opaque, let buf, size > 0 else { return size }
        let rendition = Unmanaged<Rendition>.fromOpaque(opaque).takeUnretainedValue()
        rendition.pending.append(buf, count: Int(size))
        return size
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

    /// One output rendition: its own mp4 muxer, its own byte buffer, its own
    /// segment files. The primary rendition carries video plus the default
    /// audio track; each alternate audio track gets an audio-only rendition so
    /// HLS can offer it for selection.
    ///
    /// The muxer is rebuilt from scratch on every seek-restart because it
    /// requires monotonic DTS across fragments, but the box itself (and its
    /// file naming and completed-segment bookkeeping) outlives that.
    private final class Rendition {
        /// "" for the primary, "a1"/"a2"… for alternate audio. Also the file
        /// prefix, so the primary keeps the plain init.mp4/segN.m4s names.
        let prefix: String
        /// Input stream indices this rendition carries.
        let inputStreams: [Int32]
        /// Present when this rendition's audio needs converting to AAC.
        var transcoder: AudioTranscoder?

        var ctx: UnsafeMutablePointer<AVFormatContext>?
        var avio: UnsafeMutablePointer<AVIOContext>?
        /// input stream index -> output stream index, for the current muxer.
        var streamMap: [Int32: Int32] = [:]
        /// Muxer output accumulates here; the pipeline drains it into files at
        /// fragment boundaries. Per rendition, since each has its own muxer.
        var pending = Data()
        /// Segments this rendition has written. Guarded by the session lock.
        var completed = Set<Int>()

        init(prefix: String, inputStreams: [Int32], transcoder: AudioTranscoder?) {
            self.prefix = prefix
            self.inputStreams = inputStreams
            self.transcoder = transcoder
        }

        var initName: String { prefix.isEmpty ? "init.mp4" : "\(prefix)-init.mp4" }
        func segmentName(_ n: Int) -> String { prefix.isEmpty ? "seg\(n).m4s" : "\(prefix)-seg\(n).m4s" }

        func takePending() -> Data {
            let data = pending
            pending.removeAll(keepingCapacity: true)
            return data
        }

        /// Tear down just the muxer, keeping identity and bookkeeping.
        func freeMuxer() {
            if let avio {
                av_free(avio.pointee.buffer)
                var freeingIO: UnsafeMutablePointer<AVIOContext>? = avio
                avio_context_free(&freeingIO)
            }
            if let ctx { avformat_free_context(ctx) }
            avio = nil
            ctx = nil
            streamMap = [:]
        }
    }

    /// Build (or rebuild) the muxer for one rendition and write its init
    /// segment. Returns false on a fatal error.
    private func buildMuxer(for rendition: Rendition, input: UnsafeMutablePointer<AVFormatContext>) -> Bool {
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        var ret = avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil)
        guard ret >= 0, let output = outputCtx else {
            fail("alloc_output: \(averr(ret))")
            return false
        }

        let ioBufSize = 1 << 16
        guard let ioBuf = av_malloc(ioBufSize) else {
            avformat_free_context(output)
            fail("av_malloc io buffer")
            return false
        }
        let opaque = Unmanaged.passUnretained(rendition).toOpaque()
        guard let avio = avio_alloc_context(
            ioBuf.assumingMemoryBound(to: UInt8.self), Int32(ioBufSize), 1, opaque, nil, Self.writeCallback, nil
        ) else {
            av_free(ioBuf)
            avformat_free_context(output)
            fail("avio_alloc_context")
            return false
        }
        output.pointee.pb = avio

        var streamMap = [Int32: Int32]()
        for inIndex in rendition.inputStreams {
            guard let inStream = input.pointee.streams[Int(inIndex)],
                  let outStream = avformat_new_stream(output, nil) else {
                fail("avformat_new_stream")
                return false
            }

            // A transcoded audio track is described by the encoder, not the
            // source: the output is AAC on the encoder's own clock.
            let isAudio = inStream.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO
            if isAudio, let transcoder = rendition.transcoder, let encParams = transcoder.encoderParameters {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, encParams)
                guard ret >= 0 else {
                    fail("parameters_copy (encoder): \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = transcoder.encoderTimeBase
            } else {
                ret = avcodec_parameters_copy(outStream.pointee.codecpar, inStream.pointee.codecpar)
                guard ret >= 0 else {
                    fail("parameters_copy: \(averr(ret))")
                    return false
                }
                outStream.pointee.time_base = inStream.pointee.time_base
            }
            outStream.pointee.codecpar.pointee.codec_tag = 0
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
            return false
        }

        // Bytes emitted by write_header (ftyp + empty moov) are the init
        // segment. Identical every generation, so overwriting is harmless.
        avio_flush(avio)
        do {
            try rendition.takePending().write(to: dir.appendingPathComponent(rendition.initName))
        } catch {
            fail("write \(rendition.initName): \(error.localizedDescription)")
            return false
        }

        rendition.ctx = output
        rendition.avio = avio
        rendition.streamMap = streamMap
        return true
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

        // Resolve the audio tracks to carry, in the order the playlist will
        // advertise them: the first is muxed with the video, the rest become
        // audio-only renditions.
        let streamCount = Int32(input.pointee.nb_streams)
        var audioIndices: [Int32] = config.audioTracks
            .map { Int32($0.index) }
            .filter { $0 >= 0 && $0 < streamCount && input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO }
        if audioIndices.isEmpty {
            let best = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, videoIn, nil, 0)
            if best >= 0 { audioIndices = [best] }
        }

        // Audio AVPlayer can't decode (AC3, DTS, TrueHD, Opus, Vorbis, FLAC)
        // is converted to AAC on the way through; video is always copied.
        // Transcoders are built before the muxers, which describe the output
        // track from the encoder.
        func makeTranscoder(for streamIndex: Int32, startSeconds: Double = 0) -> AudioTranscoder?? {
            guard let audioStream = input.pointee.streams[Int(streamIndex)] else { return .some(nil) }
            let codecId = audioStream.pointee.codecpar.pointee.codec_id
            guard AudioTranscoder.needsTranscode(codecId: codecId) else { return .some(nil) }
            guard let transcoder = AudioTranscoder(inputStream: audioStream, startSeconds: startSeconds) else {
                return nil // unrecoverable
            }
            return .some(transcoder)
        }

        var builtRenditions: [Rendition] = []
        for (position, audioIndex) in audioIndices.enumerated() {
            guard let transcoder = makeTranscoder(for: audioIndex) else {
                return fail("no AAC transcode path for audio stream \(audioIndex)")
            }
            if transcoder != nil {
                NSLog("[LocalRemuxer] Transcoding audio stream %d to AAC", audioIndex)
            }
            builtRenditions.append(Rendition(
                prefix: position == 0 ? "" : audioPrefix(position),
                inputStreams: position == 0 ? [videoIn, audioIndex] : [audioIndex],
                transcoder: transcoder
            ))
        }
        if builtRenditions.isEmpty {
            // Video with no audio at all.
            builtRenditions = [Rendition(prefix: "", inputStreams: [videoIn], transcoder: nil)]
        }

        stateLock.lock()
        renditions = builtRenditions
        stateLock.unlock()
        defer { builtRenditions.forEach { $0.freeMuxer() } }

        let microTb = AVRational(num: 1, den: SWIFT_AV_TIME_BASE)
        let segDur = Self.segmentDuration

        for rendition in builtRenditions {
            guard buildMuxer(for: rendition, input: input) else { return }
        }

        var packet = av_packet_alloc()
        defer { av_packet_free(&packet) }
        guard let pkt = packet else { return fail("av_packet_alloc") }

        var currentSegment = 0
        // Every generation, including the first, opens on a video keyframe.
        // Starting mid-GOP would feed the muxer leading B-frames whose DTS runs
        // behind the anchor and can arrive out of order, which it rejects.
        var awaitingKeyframe = true

        // Timeline anchor, in AV_TIME_BASE units, established from the first
        // keyframe each generation muxes: `outputPts = inputPts - anchor`.
        // Deliberately not the container's `start_time`, which need not line up
        // with the first packet and produced negative, non-monotonic DTS on
        // files with B-frames.
        var timelineAnchorUs: Int64 = 0

        /// Close segment `n` on every rendition. All renditions are cut on the
        /// same boundary so their timelines stay interchangeable, which is what
        /// lets AVPlayer swap audio renditions mid-playback.
        func finishSegment(_ n: Int) {
            for rendition in builtRenditions {
                guard let ctx = rendition.ctx, let avio = rendition.avio else { continue }
                av_write_frame(ctx, nil) // flush the open fragment
                avio_flush(avio)
                var data = rendition.takePending()
                guard !data.isEmpty else { continue }

                // The header already shipped ftyp+moov as the init segment, so
                // a media segment should start at its moof. Guard anyway: a
                // muxer that ever prefixes header boxes here would bake them
                // into the segment, which AVFoundation rejects with a bare
                // -12889.
                guard let fragmentStart = Self.firstFragmentOffset(in: data) else {
                    return fail("segment \(n) (\(rendition.prefix.isEmpty ? "primary" : rendition.prefix)) contains no moof box")
                }
                if fragmentStart > 0 {
                    data = data.subdata(in: fragmentStart..<data.count)
                }

                do {
                    try (Self.stypBox + data).write(to: dir.appendingPathComponent(rendition.segmentName(n)))
                } catch {
                    return fail("write \(rendition.segmentName(n)): \(error.localizedDescription)")
                }
                stateLock.lock()
                rendition.completed.insert(n)
                stateLock.unlock()
            }

            stateLock.lock()
            let playhead = lastRequestedSegment
            stateLock.unlock()
            pruneSegments(outside: (playhead - Self.keepWindow)...(playhead + Self.keepWindow))
        }

        /// Seek input + rebuild every rendition's muxer. False on fatal error.
        func restart(at segment: Int) -> Bool {
            let containerStartUs = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : input.pointee.start_time
            let targetUs = Int64(Double(segment) * segDur * Double(SWIFT_AV_TIME_BASE)) + containerStartUs
            let seekRet = avformat_seek_file(input, -1, Int64.min, targetUs, targetUs, SWIFT_AVSEEK_FLAG_BACKWARD)
            if seekRet < 0 {
                NSLog("[LocalRemuxer] Seek to segment %d failed: %@", segment, averr(seekRet))
            }

            for rendition in builtRenditions {
                rendition.freeMuxer()
                _ = rendition.takePending() // drop bytes of the abandoned fragment

                // Rebuild the audio transcoder rather than reusing it: AAC
                // encoders cannot be flushed, so a reused one would emit queued
                // frames still carrying pre-seek timestamps and the muxer would
                // reject them as non-monotonic. A fresh one starts its sample
                // clock at the new position, keeping audio aligned with video.
                if rendition.transcoder != nil {
                    guard let audioIndex = rendition.inputStreams.first(where: {
                        input.pointee.streams[Int($0)]?.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_AUDIO
                    }), let rebuilt = makeTranscoder(for: audioIndex, startSeconds: Double(segment) * segDur), rebuilt != nil else {
                        fail("failed to rebuild audio transcoder after seek")
                        return false
                    }
                    rendition.transcoder = rebuilt
                }

                guard buildMuxer(for: rendition, input: input) else { return false }
            }

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
                for rendition in builtRenditions {
                    guard let ctx = rendition.ctx, let avio = rendition.avio else { continue }
                    av_write_trailer(ctx)
                    avio_flush(avio)
                    _ = rendition.takePending() // trailer bytes (mfra) are not a segment
                }

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

            // Route to the rendition carrying this input stream. A stream no
            // rendition wants (an unselected audio track, subtitles) is simply
            // dropped.
            guard let rendition = builtRenditions.first(where: { $0.streamMap[pkt.pointee.stream_index] != nil }),
                  let outIndex = rendition.streamMap[pkt.pointee.stream_index],
                  let ctx = rendition.ctx,
                  let inStream = input.pointee.streams[Int(pkt.pointee.stream_index)],
                  let outStream = ctx.pointee.streams[Int(outIndex)] else { continue }

            let isVideo = pkt.pointee.stream_index == videoIn
            let isKey = pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0

            // Drop everything until the video keyframe that opens this
            // generation, then anchor the timeline on it: that keyframe becomes
            // exactly the current segment's start time, so the fragment's tfdt
            // matches what the playlist promises.
            if awaitingKeyframe {
                if !(isVideo && isKey) { continue }
                let anchorSource = pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE ? pkt.pointee.pts : pkt.pointee.dts
                guard anchorSource != SWIFT_AV_NOPTS_VALUE else { continue }
                let keyframeUs = av_rescale_q(anchorSource, inStream.pointee.time_base, microTb)
                let segmentStartUs = Int64(Double(currentSegment) * segDur * Double(SWIFT_AV_TIME_BASE))
                timelineAnchorUs = keyframeUs - segmentStartUs
                awaitingKeyframe = false
            }

            // Rebase onto the output timeline.
            let offsetInTb = av_rescale_q(timelineAnchorUs, microTb, inStream.pointee.time_base)
            if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.pts -= offsetInTb }
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE { pkt.pointee.dts -= offsetInTb }

            // A leading B-frame can still carry a DTS just behind the anchor.
            // Those frames belong to the previous GOP and would break the
            // muxer's monotonic-DTS requirement, so drop them.
            if isVideo, pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE, pkt.pointee.dts < 0 { continue }

            // Segment boundary: close the fragment on the first video packet
            // at or past the next segment's start time.
            //
            // Deliberately NOT keyframe-gated. Files whose keyframes are
            // sparser than the segment length (a 10s GOP against 6s segments)
            // would otherwise skip whole segment indices, and every skipped
            // index is a hard 404 for a segment the playlist promises. Closing
            // on the boundary and advancing exactly one segment guarantees
            // every declared index gets written. Seeks still land on a
            // keyframe, because a seek-restart re-anchors there.
            if isVideo && pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                let seconds = Double(pkt.pointee.pts) * av_q2d(inStream.pointee.time_base)
                let boundary = Double(currentSegment + 1) * segDur
                if seconds >= boundary && seconds > 0 && currentSegment + 1 < segmentCount {
                    finishSegment(currentSegment)
                    currentSegment += 1
                    stateLock.lock()
                    producingSegment = currentSegment
                    stateLock.unlock()
                }
            }

            // Transcoded audio: the encoder emits its own packets on its own
            // clock, so the input packet is consumed rather than written.
            if !isVideo, let transcoder = rendition.transcoder {
                var writeError: Int32 = 0
                transcoder.process(packet: pkt) { encoded in
                    guard writeError == 0 else { return }
                    av_packet_rescale_ts(encoded, transcoder.encoderTimeBase, outStream.pointee.time_base)
                    encoded.pointee.stream_index = outIndex
                    encoded.pointee.pos = -1
                    let w = av_write_frame(ctx, encoded)
                    if w < 0 { writeError = w }
                }
                if writeError < 0 {
                    fail("write_frame (audio): \(averr(writeError))")
                    break
                }
                continue
            }

            av_packet_rescale_ts(pkt, inStream.pointee.time_base, outStream.pointee.time_base)
            pkt.pointee.stream_index = outIndex
            pkt.pointee.pos = -1

            ret = av_write_frame(ctx, pkt)
            if ret < 0 {
                fail("write_frame: \(averr(ret))")
                break
            }
        }
    }

    /// Drop segments that sit outside the window around the playhead, across
    /// every rendition.
    private func pruneSegments(outside keep: ClosedRange<Int>) {
        stateLock.lock()
        var doomed: [(Rendition, [Int])] = []
        for rendition in renditions {
            let prunable = rendition.completed.filter { !keep.contains($0) }
            guard !prunable.isEmpty else { continue }
            rendition.completed.subtract(prunable)
            doomed.append((rendition, Array(prunable)))
        }
        stateLock.unlock()

        for (rendition, indices) in doomed {
            for n in indices {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(rendition.segmentName(n)))
            }
        }
    }
}
