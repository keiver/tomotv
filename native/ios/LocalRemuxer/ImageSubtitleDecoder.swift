//
//  ImageSubtitleDecoder.swift
//  TomoTV
//
//  Turns an image-based subtitle stream (PGS, DVD/VobSub, DVB, XSUB) into timed
//  PNGs plus a manifest, so the app can draw them itself. AVPlayer has no bitmap
//  subtitle renderer, which is why these files used to be handed to the server
//  to be re-encoded with the subtitles burned in.
//
//  Packets come from the pipeline's existing read loop, which already demuxes
//  these streams and drops them, so harvesting costs no extra I/O.
//
//  THE MODEL IS EVENTS, NOT RANGES. Each display set supersedes the previous
//  one, and a set with no composition objects is an erase (T06: 44854 bytes at
//  6.256s, 30-byte erase at 10.927s). Storing {start, end} instead forced the
//  end to be back-filled from the NEXT set, which made a seek need an invented
//  duration to close whatever was still open.
//
//  Times are ABSOLUTE SOURCE TIME from the packet PTS. The engine relabels its
//  OUTPUT timeline on a seek-restart, which displaced WebVTT subtitles once
//  already (memories/CLAUDE-lessons-learned.md); source time is not relabelled.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's macros don't survive the Clang importer.
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AV_TIME_BASE_D = 1_000_000.0

/// Hard ceiling on images kept per stream. A feature-length film runs to roughly
/// 1,500 display sets; this is well clear of that while still bounding a
/// pathological track. Hitting it is logged rather than swallowed.
private let MAX_IMAGES_PER_STREAM = 4000

/// One drawable bitmap, positioned in the subtitle canvas's coordinate space
/// (which is NOT always the video's — see `canvasWidth`).
struct ImageSubtitleImage {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    /// File name inside the session directory, also its path on the loopback
    /// server.
    let file: String
}

/// One display set: everything on screen from `time` until the next event.
/// An empty `images` array is an erase — the format's own way of saying
/// "nothing from here".
struct ImageSubtitleEvent {
    let time: Double
    let images: [ImageSubtitleImage]
}

final class ImageSubtitleDecoder {

    /// Formats with a bitmap payload, which is exactly the set the app's
    /// `isImageBasedSubtitleCodec` treats as needing burn-in. All four decoders
    /// are compiled into the linked FFmpeg (verified against the built
    /// Libavcodec's symbol table, not the configure line).
    static func handles(_ codecId: AVCodecID) -> Bool {
        switch codecId {
        case AV_CODEC_ID_HDMV_PGS_SUBTITLE, AV_CODEC_ID_DVD_SUBTITLE,
             AV_CODEC_ID_DVB_SUBTITLE, AV_CODEC_ID_XSUB:
            return true
        default:
            return false
        }
    }

    let streamIndex: Int32

    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    /// PGS display sets can span several packets in Matroska. ffmpeg's CLI
    /// inserts `pgs_frame_merge` automatically for exactly this reason; without
    /// it the decoder reports "Failed to parse PGS segments" and yields nothing.
    private var bsf: UnsafeMutablePointer<AVBSFContext>?
    private var bsfPacket: UnsafeMutablePointer<AVPacket>?

    private let timeBase: AVRational
    private let dir: URL
    private let namePrefix: String

    private let lock = NSLock()
    /// Display sets in source-time order.
    private var events: [ImageSubtitleEvent] = []
    /// Event times already recorded, in milliseconds, so a seek that re-reads a
    /// region appends nothing a second time.
    private var recordedTimes: Set<Int> = []
    private var imageCount = 0
    private var cappedLogged = false
    /// The read loop reached the end of this stream, so the event list is final.
    /// The app stops polling the manifest once it sees this.
    private var finished = false

    /// Subtitle canvas size. PGS carries its own, and it is NOT the video size:
    /// T43's PGS stream declares 1280x720 over a 720x480 video. `codecpar`
    /// often leaves it at zero (T06, T85 and T86 all do), in which case it is
    /// only known once the decoder has seen a presentation composition, so this
    /// is re-read after every successful decode and falls back to the video's
    /// dimensions.
    ///
    /// Guarded by `lock`, like everything else the HTTP queue can see: the
    /// pipeline thread rewrites both after a decode while `manifestJSON` reads
    /// them. `private` rather than `private(set)` so that stays true — the only
    /// reader is inside this class, holding the lock.
    private var canvasWidth: Int
    private var canvasHeight: Int

    init?(stream: UnsafeMutablePointer<AVStream>, fallbackWidth: Int, fallbackHeight: Int, dir: URL) {
        guard let params = stream.pointee.codecpar, Self.handles(params.pointee.codec_id) else { return nil }

        streamIndex = stream.pointee.index
        timeBase = stream.pointee.time_base
        self.dir = dir
        namePrefix = "pgs\(stream.pointee.index)"
        canvasWidth = params.pointee.width > 0 ? Int(params.pointee.width) : fallbackWidth
        canvasHeight = params.pointee.height > 0 ? Int(params.pointee.height) : fallbackHeight

        guard let codec = avcodec_find_decoder(params.pointee.codec_id),
              let ctx = avcodec_alloc_context3(codec) else {
            NSLog("[ImageSubtitle] no decoder for codec id %d", params.pointee.codec_id.rawValue)
            return nil
        }
        decoder = ctx
        guard avcodec_parameters_to_context(ctx, params) >= 0 else {
            NSLog("[ImageSubtitle] parameters_to_context failed for stream %d", stream.pointee.index)
            return nil
        }
        // Without this, avcodec_decode_subtitle2 leaves AVSubtitle.pts at
        // AV_NOPTS_VALUE and every event would land at zero.
        ctx.pointee.pkt_timebase = timeBase
        guard avcodec_open2(ctx, codec, nil) >= 0 else {
            NSLog("[ImageSubtitle] failed to open decoder for stream %d", stream.pointee.index)
            return nil
        }

        if params.pointee.codec_id == AV_CODEC_ID_HDMV_PGS_SUBTITLE {
            setUpFrameMergeFilter(params: params)
        }
    }

    deinit {
        if decoder != nil { avcodec_free_context(&decoder) }
        if bsf != nil { av_bsf_free(&bsf) }
        if bsfPacket != nil { av_packet_free(&bsfPacket) }
    }

    private func setUpFrameMergeFilter(params: UnsafeMutablePointer<AVCodecParameters>) {
        guard let filter = av_bsf_get_by_name("pgs_frame_merge") else {
            NSLog("[ImageSubtitle] pgs_frame_merge unavailable; decoding packets as they arrive")
            return
        }
        var ctx: UnsafeMutablePointer<AVBSFContext>? = nil
        guard av_bsf_alloc(filter, &ctx) >= 0, let ctx else { return }
        // par_in and time_base_in are caller-filled before av_bsf_init, per
        // bsf.h. Leaving the time base unset makes the filter's output PTS
        // meaningless, and PTS is the whole point here.
        guard avcodec_parameters_copy(ctx.pointee.par_in, params) >= 0 else {
            var dead: UnsafeMutablePointer<AVBSFContext>? = ctx
            av_bsf_free(&dead)
            return
        }
        ctx.pointee.time_base_in = timeBase
        guard av_bsf_init(ctx) >= 0 else {
            var dead: UnsafeMutablePointer<AVBSFContext>? = ctx
            av_bsf_free(&dead)
            return
        }
        bsf = ctx
        bsfPacket = av_packet_alloc()
    }

    // MARK: - Feeding

    /// Called on the pipeline thread for every packet belonging to this stream.
    func handle(packet: UnsafeMutablePointer<AVPacket>) {
        guard let bsf, let bsfPacket else {
            decode(packet)
            return
        }
        guard av_bsf_send_packet(bsf, packet) >= 0 else { return }
        while av_bsf_receive_packet(bsf, bsfPacket) >= 0 {
            decode(bsfPacket)
            av_packet_unref(bsfPacket)
        }
    }

    /// A seek restarted the pipeline: drop decoder state so a half-received
    /// display set cannot merge with packets from the new position.
    ///
    /// `demuxedUpTo` is the last source time the read loop reached. If a display
    /// set is still showing there, an erase is recorded at that point: past it
    /// lies a region we never read, and "the last set wins" would otherwise
    /// paint a subtitle from 15s over the picture at 40s.
    func flush(demuxedUpTo: Double) {
        if let decoder { avcodec_flush_buffers(decoder) }
        if let bsf { av_bsf_flush(bsf) }

        lock.lock()
        if let newest = events.last, !newest.images.isEmpty, demuxedUpTo > newest.time {
            appendLocked(ImageSubtitleEvent(time: demuxedUpTo, images: []))
        }
        // No longer at the end of anything, and the previous EOF may never have
        // covered the whole source: a resume starts the pipeline mid-file, so
        // generation 0 can reach EOF having never read the head of the item.
        // A seek back over that region decodes display sets for the first time,
        // and a decoder still claiming completeness would have told the app to
        // stop asking for them.
        finished = false
        lock.unlock()
    }

    /// End of stream: nothing is on screen past the end of the item.
    func finish(at endTime: Double) {
        lock.lock()
        if let newest = events.last, !newest.images.isEmpty, endTime > newest.time {
            appendLocked(ImageSubtitleEvent(time: endTime, images: []))
        }
        finished = true
        lock.unlock()
    }

    private func decode(_ packet: UnsafeMutablePointer<AVPacket>) {
        guard let decoder else { return }

        var sub = AVSubtitle()
        var got: Int32 = 0
        let used = avcodec_decode_subtitle2(decoder, &sub, &got, packet)
        guard used >= 0, got != 0 else { return }
        defer { avsubtitle_free(&sub) }

        // The decoder learns the canvas from the presentation composition, so
        // this is only meaningful after a decode has succeeded.
        //
        // Under the lock: manifestJSON reads both on the HTTP queue while this
        // runs on the pipeline thread. Nothing here holds the lock yet (the
        // first acquisition is the recordedTimes check below), so the
        // non-recursive NSLock is safe to take.
        if decoder.pointee.width > 0, decoder.pointee.height > 0 {
            let width = Int(decoder.pointee.width)
            let height = Int(decoder.pointee.height)
            lock.lock()
            canvasWidth = width
            canvasHeight = height
            lock.unlock()
        }

        let base: Double
        if sub.pts != SWIFT_AV_NOPTS_VALUE {
            base = Double(sub.pts) / SWIFT_AV_TIME_BASE_D
        } else if packet.pointee.pts != SWIFT_AV_NOPTS_VALUE {
            base = Double(packet.pointee.pts) * av_q2d(timeBase)
        } else {
            return
        }
        let time = base + Double(sub.start_display_time) / 1000.0

        lock.lock()
        let alreadyRecorded = recordedTimes.contains(Int(time * 1000))
        lock.unlock()
        if alreadyRecorded { return }

        // Rects are rendered outside the lock: encoding a PNG is the slow part
        // and the HTTP queue reads the manifest while this runs.
        var images: [ImageSubtitleImage] = []
        if sub.num_rects > 0, let rects = sub.rects {
            for i in 0 ..< Int(sub.num_rects) {
                guard let rect = rects[i] else { continue }
                guard rect.pointee.type == SUBTITLE_BITMAP, rect.pointee.w > 0, rect.pointee.h > 0 else { continue }
                if let image = render(rect: rect.pointee) { images.append(image) }
            }
        }

        lock.lock()
        appendLocked(ImageSubtitleEvent(time: time, images: images))
        lock.unlock()

        // Formats that carry a real duration (DVD/VobSub, DVB) say when the set
        // ends rather than waiting for an erase. PGS leaves this at zero and is
        // ended by the next display set instead. Emitting the erase here keeps
        // one model for all four.
        if !images.isEmpty, sub.end_display_time > 0, sub.end_display_time != UInt32.max {
            let end = base + Double(sub.end_display_time) / 1000.0
            if end > time {
                lock.lock()
                appendLocked(ImageSubtitleEvent(time: end, images: []))
                lock.unlock()
            }
        }
    }

    /// Insert in source-time order and remember the time. Caller holds the lock.
    private func appendLocked(_ event: ImageSubtitleEvent) {
        let key = Int(event.time * 1000)
        guard !recordedTimes.contains(key) else { return }
        recordedTimes.insert(key)
        // A seek can re-read an earlier region, so events do not always arrive
        // in order; keep the array sorted rather than sorting on every serve.
        let at = events.firstIndex { $0.time > event.time } ?? events.count
        events.insert(event, at: at)
    }

    // MARK: - Pixels

    private func render(rect: AVSubtitleRect) -> ImageSubtitleImage? {
        lock.lock()
        if imageCount >= MAX_IMAGES_PER_STREAM {
            if !cappedLogged {
                cappedLogged = true
                NSLog("[ImageSubtitle] stream %d hit the %d image cap; later sets are dropped", streamIndex, MAX_IMAGES_PER_STREAM)
            }
            lock.unlock()
            return nil
        }
        let ordinal = imageCount
        imageCount += 1
        lock.unlock()

        guard let rgba = rgbaBytes(from: rect) else { return nil }
        let file = "\(namePrefix)-\(ordinal).png"
        guard PNGWriter.write(rgba, width: Int(rect.w), height: Int(rect.h), to: dir.appendingPathComponent(file)) else { return nil }

        return ImageSubtitleImage(x: Int(rect.x), y: Int(rect.y), width: Int(rect.w), height: Int(rect.h), file: file)
    }

    /// PAL8 indices through the rect's own palette into straight (NOT
    /// premultiplied) RGBA.
    ///
    /// Straight alpha is deliberate. PNG stores straight alpha and every
    /// consumer premultiplies on decode, so premultiplying here would apply the
    /// alpha twice and darken the antialiased edge of every glyph.
    private func rgbaBytes(from rect: AVSubtitleRect) -> Data? {
        guard let indices = rect.data.0, let palette = rect.data.1 else { return nil }
        let width = Int(rect.w)
        let height = Int(rect.h)
        let stride = Int(rect.linesize.0)
        guard stride >= width else { return nil }

        var out = Data(count: width * height * 4)
        var opaquePixels = 0
        out.withUnsafeMutableBytes { raw in
            guard let dst = raw.bindMemory(to: UInt8.self).baseAddress else { return }
            for y in 0 ..< height {
                let row = indices + y * stride
                for x in 0 ..< width {
                    // Palette entries are 4-byte AV_PIX_FMT_RGB32, i.e. ARGB in
                    // native endianness, so the bytes read B, G, R, A.
                    let entry = palette + Int(row[x]) * 4
                    let out0 = dst + (y * width + x) * 4
                    out0[0] = entry[2]
                    out0[1] = entry[1]
                    out0[2] = entry[0]
                    out0[3] = entry[3]
                    if entry[3] != 0 { opaquePixels += 1 }
                }
            }
        }
        // A fully transparent rect draws nothing; skip the file entirely.
        return opaquePixels > 0 ? out : nil
    }

    // MARK: - Serving

    /// Display-set manifest for the loopback server. Read from the HTTP queue
    /// while the pipeline thread is still appending, hence the lock.
    ///
    /// `demuxedUpTo` is how far the read loop has actually reached, and
    /// `complete` says the list is final. Together they let the app stop asking:
    /// it used to refetch every three seconds until it held events far enough
    /// past the playhead, which never came true across a stretch of film with no
    /// dialogue in it, because the last CUE lags the read head arbitrarily.
    func manifestJSON(demuxedUpTo: Double) -> Data? {
        lock.lock()
        let snapshot = events
        let width = canvasWidth
        let height = canvasHeight
        let complete = finished
        lock.unlock()

        let payload: [String: Any] = [
            "streamIndex": Int(streamIndex),
            "canvasWidth": width,
            "canvasHeight": height,
            "demuxedUpTo": demuxedUpTo,
            "complete": complete,
            "events": snapshot.map { event in
                [
                    "time": event.time,
                    "images": event.images.map { image in
                        ["x": image.x, "y": image.y, "width": image.width, "height": image.height, "file": image.file]
                    },
                ] as [String: Any]
            },
        ]
        return try? JSONSerialization.data(withJSONObject: payload)
    }
}
