//
//  TextSubtitleDecoder.swift
//  TomoTV
//
//  A text subtitle stream (SubRip, mov_text/tx3g, ASS, SSA, anything else the
//  build decodes) as timed cues the engine serves as WebVTT segments. Pointing
//  the rendition at Jellyfin's /Subtitles/N/Stream.vtt instead runs ffmpeg over
//  the whole file before AVPlayer reports ready: 5.7 to 11.8s per item.
//
//  Packets come from the read loop, which demuxes and drops these streams
//  anyway, so harvesting costs no extra I/O. Times are ABSOLUTE SOURCE TIME;
//  Remuxer rebases them by the session anchor.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's macros don't survive the Clang importer.
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE_D = 1_000_000.0

/// One subtitle line and the window it is on screen for, in source time.
struct TextSubtitleCue: Hashable {
    let start: Double
    let end: Double
    let text: String
}

/// Ceiling on cues per stream. A dialogue-heavy film runs to about 2,000; ASS
/// karaoke runs higher, which is what the headroom is for.
private let MAX_CUES_PER_STREAM = 20000

/// A cue with no end of its own. Malformed-file guard: nothing we take leaves one open.
private let FALLBACK_CUE_SECONDS = 5.0

final class TextSubtitleDecoder {

    /// Every format that is not a bitmap: a codec must land in exactly one of
    /// the two decoders.
    static func handles(_ codecId: AVCodecID) -> Bool {
        !ImageSubtitleDecoder.handles(codecId)
    }

    let streamIndex: Int32

    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    private let timeBase: AVRational
    private let converter: AssToWebVTT

    private let lock = NSLock()
    private var cues: [TextSubtitleCue] = []
    /// Recorded already, so a re-read appends nothing twice. Keyed on the whole
    /// cue: two speakers can share a start.
    private var recorded: Set<TextSubtitleCue> = []
    private var cappedLogged = false
    private var finished = false

    init?(stream: UnsafeMutablePointer<AVStream>) {
        guard let params = stream.pointee.codecpar, Self.handles(params.pointee.codec_id) else { return nil }

        streamIndex = stream.pointee.index
        timeBase = stream.pointee.time_base

        guard let codec = avcodec_find_decoder(params.pointee.codec_id),
              let ctx = avcodec_alloc_context3(codec) else {
            NSLog("[TextSubtitle] no decoder for codec id %d", params.pointee.codec_id.rawValue)
            return nil
        }
        decoder = ctx
        guard avcodec_parameters_to_context(ctx, params) >= 0 else {
            NSLog("[TextSubtitle] parameters_to_context failed for stream %d", stream.pointee.index)
            return nil
        }
        // Without this, AVSubtitle.pts stays AV_NOPTS_VALUE and every cue lands at zero.
        ctx.pointee.pkt_timebase = timeBase
        guard avcodec_open2(ctx, codec, nil) >= 0 else {
            NSLog("[TextSubtitle] failed to open decoder for stream %d", stream.pointee.index)
            return nil
        }

        // An ASS file brings its own style header; the rest get a synthesized one.
        var header: String? = nil
        if let bytes = ctx.pointee.subtitle_header, ctx.pointee.subtitle_header_size > 0 {
            header = String(data: Data(bytes: bytes, count: Int(ctx.pointee.subtitle_header_size)), encoding: .utf8)
        }
        converter = AssToWebVTT(header: header)
    }

    deinit {
        if decoder != nil { avcodec_free_context(&decoder) }
    }

    // MARK: - Feeding

    /// Called on the pipeline thread for every packet belonging to this stream.
    func handle(packet: UnsafeMutablePointer<AVPacket>) {
        guard let decoder else { return }

        var sub = AVSubtitle()
        var got: Int32 = 0
        let used = avcodec_decode_subtitle2(decoder, &sub, &got, packet)
        guard used >= 0, got != 0 else { return }
        defer { avsubtitle_free(&sub) }

        let base: Double
        if sub.pts != SWIFT_AV_NOPTS_VALUE {
            base = Double(sub.pts) / SWIFT_AV_TIME_BASE_D
        } else if packet.pointee.pts != SWIFT_AV_NOPTS_VALUE {
            base = Double(packet.pointee.pts) * av_q2d(timeBase)
        } else {
            return
        }

        let start = base + Double(sub.start_display_time) / 1000.0
        var end = base + Double(sub.end_display_time) / 1000.0
        if sub.end_display_time == 0 || sub.end_display_time == UInt32.max || end <= start {
            let declared = packet.pointee.duration > 0 ? Double(packet.pointee.duration) * av_q2d(timeBase) : 0
            end = start + (declared > 0 ? declared : FALLBACK_CUE_SECONDS)
        }

        guard sub.num_rects > 0, let rects = sub.rects else { return }
        for i in 0 ..< Int(sub.num_rects) {
            guard let rect = rects[i] else { continue }
            let text: String
            if let ass = rect.pointee.ass {
                text = converter.cueText(String(cString: ass))
            } else if let plain = rect.pointee.text {
                text = AssToWebVTT.escapedText(String(cString: plain))
            } else {
                continue
            }
            guard !text.isEmpty else { continue }
            append(TextSubtitleCue(start: start, end: end, text: text))
        }
    }

    /// A seek restarted the pipeline: drop decoder state so a half-decoded line
    /// cannot merge with packets from the new position. Harvested cues stay.
    func flush() {
        if let decoder { avcodec_flush_buffers(decoder) }
        lock.lock()
        // A resume opens mid-file, so generation 0 can reach EOF having never read
        // the head of the item, where a seek back finds cues for the first time.
        finished = false
        lock.unlock()
    }

    /// End of stream: the cue list is final.
    func finish() {
        lock.lock()
        finished = true
        lock.unlock()
    }

    private func append(_ cue: TextSubtitleCue) {
        lock.lock()
        defer { lock.unlock() }
        guard !recorded.contains(cue) else { return }
        guard cues.count < MAX_CUES_PER_STREAM else {
            if !cappedLogged {
                cappedLogged = true
                NSLog("[TextSubtitle] stream %d hit the %d cue cap; later cues are dropped", streamIndex, MAX_CUES_PER_STREAM)
            }
            return
        }
        recorded.insert(cue)
        // A seek re-reads earlier regions, so cues do not always arrive in order.
        let at = cues.firstIndex { $0.start > cue.start } ?? cues.count
        cues.insert(cue, at: at)
    }

    // MARK: - Serving

    /// Cues overlapping [from, to) in source time. Overlap, not containment: a
    /// cue straddling a boundary belongs to BOTH segments.
    func cues(from: Double, to: Double) -> [TextSubtitleCue] {
        lock.lock()
        defer { lock.unlock() }
        return cues.filter { $0.end > from && $0.start < to }
    }

    var isComplete: Bool {
        lock.lock()
        defer { lock.unlock() }
        return finished
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return cues.count
    }
}
