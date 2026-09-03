//
//  VideoTranscoder.swift
//  TomoTV
//
//  Decodes video AVPlayer cannot play (VP8, VP9, MPEG-2, MPEG-4/DivX, WMV,
//  VC-1, and the rest of the long tail with a decoder in the linked build) and
//  re-encodes it to H.264 with VideoToolbox, so it can ride the same local HLS
//  pipeline and keep AVPlayer's native transport controls.
//
//  Every other client solves exotic codecs by decoding in software and drawing
//  the frames itself, which forfeits the native player. The extra cost here is
//  only the encode, which runs on dedicated silicon; the software decode is
//  identical and is the dominant cost either way.
//
//  Input contract (verified against FFmpeg's videotoolboxenc.c, not assumed):
//  h264_videotoolbox accepts exactly nv12 and yuv420p, both 8-bit. Anything
//  else has to be converted, which is what lets 4:2:2, 10-bit and full-range
//  sources (MJPEG, FFV1, HuffYUV, 10-bit VP9) reach the encoder at all.
//
//  Two conversion paths. yuv420p/yuvj420p/nv12 wrap straight out of the decoder
//  (CVPixelBufferCreateWithPlanarBytes, no copy) and go through a
//  VTPixelTransferSession. Everything else goes through libswscale.
//
//  Interlaced sources go through libavfilter's bwdif (single-rate, one frame
//  out per frame in) BEFORE the conversion. The filter lives in the FFmpeg
//  frameworks, which are compiled -O2 whatever the app builds at — a Swift
//  per-pixel loop here ran ~300x slower at -Onone and starved segment 0 on
//  every Debug build.
//

import CoreVideo
import Foundation
import Libavcodec
import Libavfilter
import Libavformat
import Libavutil
import Libswscale
import VideoToolbox

private let SWIFT_AVERROR_EAGAIN_VT: Int32 = -35
private let SWIFT_AVERROR_EOF_VT: Int32 = -541_478_725
private let SWIFT_AV_NOPTS_VALUE_VT = Int64(bitPattern: 0x8000_0000_0000_0000)

final class VideoTranscoder {
    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    private var encoder: UnsafeMutablePointer<AVCodecContext>?
    private var frame: UnsafeMutablePointer<AVFrame>?

    /// Apple's pixel-format converter, built on the first frame that needs one.
    /// Stays nil when the decoder already hands over what the encoder takes.
    private var transfer: VTPixelTransferSession?
    /// Destination of that conversion, in the encoder's format, reused.
    private var destination: CVPixelBuffer?
    /// The converted frame handed to the encoder, reused.
    private var converted: UnsafeMutablePointer<AVFrame>?
    /// Scratch for the libswscale output when the decoded layout cannot be
    /// wrapped as a CVPixelBuffer directly.
    private var interleave: UnsafeMutableRawPointer?
    private var interleaveSize = 0
    /// Cached across frames: sws_getCachedContext reuses it while the source
    /// geometry and format hold, and rebuilds it when they do not. FFmpeg 8 made
    /// SwsContext a real struct, so this is a typed pointer, not OpaquePointer.
    private var sws: UnsafeMutablePointer<SwsContext>?
    /// Logged once, so a two-hour film does not narrate every frame.
    private var conversionLogged = false
    /// Which path the last frame took to the encoder: direct, videotoolbox or swscale.
    private(set) var conversion = "direct"

    /// Set when the source is interlaced. Routes frames through the bwdif graph.
    private let deinterlacing: Bool
    /// True when the temporally first field is the top one; sets bwdif's parity.
    private let topFieldFirst: Bool
    /// buffer -> bwdif -> buffersink, built on the first decoded frame because
    /// the buffer source needs the frame's real geometry and format.
    private var filterGraph: UnsafeMutablePointer<AVFilterGraph>?
    private var filterSrc: UnsafeMutablePointer<AVFilterContext>?
    private var filterSink: UnsafeMutablePointer<AVFilterContext>?
    /// Output frame of the filter, reused across frames.
    private var filtered: UnsafeMutablePointer<AVFrame>?

    /// Set when the next frame sent to the encoder must be an IDR. The
    /// pipeline uses this to open every segment on a keyframe:
    /// videotoolboxenc honors pict_type == I via
    /// kVTEncodeFrameOptionKey_ForceKeyFrame.
    private var keyframeRequested = false

    /// Unrecoverable processing failure (pixel format mismatch, encoder
    /// rejection). The pipeline checks this after every process() call and
    /// fails the session, which is what triggers the server fallback.
    private(set) var failed = false

    private(set) var encoderParameters: UnsafeMutablePointer<AVCodecParameters>?
    private(set) var framesEncoded = 0
    /// Same clock as the input stream: the encoder passes frame PTS through,
    /// so keeping its time base identical to the input's means the pipeline's
    /// anchor arithmetic applies to encoded packets unchanged.
    private(set) var encoderTimeBase = AVRational(num: 1, den: 90000)

    /// Video codecs AVPlayer decodes itself, which must be stream-copied rather
    /// than sent through here.
    ///
    /// AV1 depends on the device. Where VideoToolbox decodes it in hardware,
    /// AVPlayer can play a copy and this returns false. Where it cannot — Apple
    /// TV, and every Mac tested — AV1 goes through dav1d in software and out
    /// through VideoToolbox, exactly like VP9. The resolution gate in
    /// services/localRemux.ts is what bounds it.
    static func needsTranscode(codecId: AVCodecID) -> Bool {
        switch codecId {
        case AV_CODEC_ID_H264, AV_CODEC_ID_HEVC:
            return false
        case AV_CODEC_ID_AV1:
            return !hardwareDecodesAV1
        default:
            return true
        }
    }

    /// Asked once: the answer cannot change while the process lives.
    private static let hardwareDecodesAV1: Bool = VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1)

    /// What VideoToolbox can decode on THIS device, logged once per process.
    ///
    /// The SDK declares codec types for MPEG-2, MPEG-4 Part 2, H.263, Sorenson,
    /// VP9, AV1 and ProRes, but that enum is shared across Apple platforms and
    /// declaring is not implementing. On macOS, ProRes and JPEG have hardware
    /// decode, MPEG-2/MPEG-1/H.263 create software sessions, and VP9 and AV1
    /// have no decoder at all. tvOS is its own answer and this is how we get it.
    ///
    /// It matters because anything true here could stop needing software decode,
    /// and interlaced content in those codecs could use Apple's own deinterlacer
    /// (kVTDecompressionPropertyKey_FieldMode) instead of the pass below.
    static func logDecodeSupport() {
        guard !decodeSupportLogged else { return }
        decodeSupportLogged = true
        let types: [(String, CMVideoCodecType)] = [
            ("h264", kCMVideoCodecType_H264), ("hevc", kCMVideoCodecType_HEVC),
            ("mpeg2", kCMVideoCodecType_MPEG2Video), ("mpeg1", kCMVideoCodecType_MPEG1Video),
            ("mpeg4", kCMVideoCodecType_MPEG4Video), ("h263", kCMVideoCodecType_H263),
            ("svq1", kCMVideoCodecType_SorensonVideo), ("svq3", kCMVideoCodecType_SorensonVideo3),
            ("jpeg", kCMVideoCodecType_JPEG), ("vp9", kCMVideoCodecType_VP9),
            ("av1", kCMVideoCodecType_AV1), ("prores422", kCMVideoCodecType_AppleProRes422),
            ("prores4444", kCMVideoCodecType_AppleProRes4444),
        ]
        var line = ""
        for (name, type) in types {
            let hw = VTIsHardwareDecodeSupported(type)
            var fmt: CMVideoFormatDescription?
            let made = CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: type,
                                                      width: 720, height: 480, extensions: nil,
                                                      formatDescriptionOut: &fmt) == noErr
            var session: VTDecompressionSession?
            var canDecode = false
            if made, let fmt {
                canDecode = VTDecompressionSessionCreate(allocator: kCFAllocatorDefault,
                                                        formatDescription: fmt,
                                                        decoderSpecification: nil,
                                                        imageBufferAttributes: nil,
                                                        outputCallback: nil,
                                                        decompressionSessionOut: &session) == noErr
                if let session { VTDecompressionSessionInvalidate(session) }
            }
            line += "\(name)=\(hw ? "hw" : canDecode ? "sw" : "-") "
        }
        NSLog("[VideoTranscoder] VideoToolbox decode support: %@", line)
    }

    private static var decodeSupportLogged = false

    /// - Parameter keyframeInterval: seconds between fallback IDRs when the
    ///   pipeline doesn't force one sooner. Segment boundaries always force
    ///   one via forceKeyframeNext(), so this only bounds the GOP between
    ///   boundaries.
    init?(inputStream: UnsafeMutablePointer<AVStream>, keyframeInterval: Double = 6.0, maxBitrate: Int64 = 12_000_000, openEncoder: Bool = true) {
        let params = inputStream.pointee.codecpar!

        // Interlaced sources go through the deinterlace pass below. TT and TB
        // are top-field-first; BB and BT are bottom-first, so their kept rows
        // are the odd ones.
        let fieldOrder = params.pointee.field_order
        deinterlacing = !(fieldOrder == AV_FIELD_PROGRESSIVE || fieldOrder == AV_FIELD_UNKNOWN)
        topFieldFirst = !(fieldOrder == AV_FIELD_BB || fieldOrder == AV_FIELD_BT)
        if deinterlacing {
            NSLog("[VideoTranscoder] Interlaced source (field_order %d), deinterlacing %@ first",
                  fieldOrder.rawValue, topFieldFirst ? "top" : "bottom")
        }

        // Advisory only. A container that declares nv12 gets nv12 through
        // untouched; everything else targets yuv420p and is converted on the
        // way in if the decoder disagrees. -1 means the container does not say,
        // which is common and no longer a reason to refuse anything.
        let declaredFormat = params.pointee.format

        guard let decoderCodec = avcodec_find_decoder(params.pointee.codec_id),
              let decCtx = avcodec_alloc_context3(decoderCodec) else {
            NSLog("[VideoTranscoder] No decoder for codec id %d", params.pointee.codec_id.rawValue)
            return nil
        }
        decoder = decCtx
        guard avcodec_parameters_to_context(decCtx, params) >= 0 else { return nil }
        // Software decode of VP9/MPEG-2 is the expensive half; let it use every
        // core rather than running single-threaded.
        decCtx.pointee.thread_count = 0
        guard avcodec_open2(decCtx, decoderCodec, nil) >= 0 else {
            NSLog("[VideoTranscoder] Failed to open decoder")
            return nil
        }
        frame = av_frame_alloc()

        // Decode-only benchmark: with no encoder, process() has nothing to feed.
        guard openEncoder else { return }

        // Source depth picks the encoder. h264_videotoolbox is 8-bit only, so a
        // 10-bit source through it would be flattened on the way in;
        // hevc_videotoolbox takes p010le and keeps the depth. The container's
        // declared format is the only signal that exists before the first frame
        // decodes — when it says nothing, the 8-bit path is taken and the
        // converter brings the depth down if the decoder turns out to disagree.
        //
        // The mp4 muxer's 'hvc1' sample-entry tag is applied by
        // Remuxer.buildMuxer off the output codec id, so HEVC here needs no
        // extra handling to satisfy AVFoundation.
        let sourceDepth: Int32 = declaredFormat >= 0
            ? (av_pix_fmt_desc_get(AVPixelFormat(rawValue: declaredFormat))?.pointee.comp.0.depth ?? 8)
            : 8
        // Interlaced sources take the 8-bit path; 10-bit interlaced content
        // essentially does not exist.
        let tenBit = sourceDepth > 8 && !deinterlacing
        let encoderName = tenBit ? "hevc_videotoolbox" : "h264_videotoolbox"

        guard let encCodec = avcodec_find_encoder_by_name(encoderName),
              let encCtx = avcodec_alloc_context3(encCodec) else {
            NSLog("[VideoTranscoder] %@ unavailable", encoderName)
            return nil
        }
        encoder = encCtx

        encCtx.pointee.width = params.pointee.width
        encCtx.pointee.height = params.pointee.height
        // nv12 and p010 are what VideoToolbox wants natively and what
        // VTPixelTransferSession produces, so the encoder is pinned to them
        // rather than to yuv420p.
        encCtx.pointee.pix_fmt = tenBit ? AV_PIX_FMT_P010LE : AV_PIX_FMT_NV12
        encCtx.pointee.sample_aspect_ratio = params.pointee.sample_aspect_ratio

        // The encoder runs on the input stream's clock (see encoderTimeBase).
        encCtx.pointee.time_base = inputStream.pointee.time_base
        encoderTimeBase = inputStream.pointee.time_base

        let guessed = av_guess_frame_rate(nil, inputStream, nil)
        let fps = guessed.den > 0 && guessed.num > 0 ? Double(guessed.num) / Double(guessed.den) : 30.0
        encCtx.pointee.framerate = guessed.num > 0 ? guessed : AVRational(num: 30, den: 1)
        encCtx.pointee.gop_size = Int32(max(1, (fps * keyframeInterval).rounded()))
        // B-frames complicate DTS across fragment boundaries for no real gain
        // at these bitrates.
        encCtx.pointee.max_b_frames = 0
        encCtx.pointee.bit_rate = min(params.pointee.bit_rate > 0 ? params.pointee.bit_rate : maxBitrate, maxBitrate)
        encCtx.pointee.flags |= AV_CODEC_FLAG_GLOBAL_HEADER
        // Favour throughput over compression: this races playback.
        av_opt_set(encCtx.pointee.priv_data, "realtime", "1", 0)

        guard avcodec_open2(encCtx, encCodec, nil) >= 0 else {
            NSLog("[VideoTranscoder] Failed to open %@ encoder", encoderName)
            return nil
        }

        // Adopted before it is populated: deinit frees the property, so a failure
        // between alloc and assignment leaked the parameters block.
        guard let outParams = avcodec_parameters_alloc() else { return nil }
        encoderParameters = outParams
        guard avcodec_parameters_from_context(outParams, encCtx) >= 0 else { return nil }
    }

    deinit {
        avcodec_free_context(&decoder)
        avcodec_free_context(&encoder)
        av_frame_free(&frame)
        av_frame_free(&converted)
        // Frees the contained filter contexts too; src/sink are not freed
        // separately.
        avfilter_graph_free(&filterGraph)
        av_frame_free(&filtered)
        if let transfer { VTPixelTransferSessionInvalidate(transfer) }
        transfer = nil
        destination = nil
        interleave?.deallocate()
        interleave = nil
        if let sws { sws_freeContext(sws) }
        sws = nil
        avcodec_parameters_free(&encoderParameters)
    }

    /// The next frame sent to the encoder becomes an IDR. Called by the
    /// pipeline when the input crosses a segment boundary, so every transcoded
    /// segment opens on a keyframe.
    func forceKeyframeNext() {
        keyframeRequested = true
    }

    /// Feed one packet; `emit` receives each encoded H.264 packet. Pass nil to
    /// flush at end of stream. Check `failed` after each call.
    func process(packet: UnsafeMutablePointer<AVPacket>?, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        // encoder is checked but not bound: encode() re-binds it, and the
        // conversion has to happen before anything is sent.
        guard let decoder, encoder != nil, let frame, !failed else { return }
        guard avcodec_send_packet(decoder, packet) >= 0 else { return }

        while avcodec_receive_frame(decoder, frame) >= 0 {
            defer { av_frame_unref(frame) }

            // The encoder runs on the frame's own presentation time (already
            // rebased onto the output timeline by the pipeline). Frames with
            // no timestamp, or from before the anchor (open-GOP leftovers
            // after a seek), can't be placed on the timeline — drop them, the
            // same rule the copy path applies to leading B-frames.
            let pts = frame.pointee.best_effort_timestamp
            guard pts != SWIFT_AV_NOPTS_VALUE_VT, pts >= 0 else { continue }

            if deinterlacing {
                if filterGraph == nil, !buildFilterGraph(matching: frame) {
                    failed = true
                    return
                }
                // bwdif carries pts through, so it has to be on the frame.
                frame.pointee.pts = pts
                guard av_buffersrc_write_frame(filterSrc, frame) >= 0 else {
                    NSLog("[VideoTranscoder] bwdif rejected a frame — failing")
                    failed = true
                    return
                }
                drainFilter(emit: emit)
            } else {
                encode(frame: frame, pts: pts, emit: emit)
            }
            if failed { return }
        }

        if packet == nil {
            // bwdif holds one frame of lookahead; EOF releases it.
            if filterGraph != nil {
                _ = av_buffersrc_add_frame(filterSrc, nil)
                drainFilter(emit: emit)
            }
            drainEncoder(sending: nil, emit: emit)
        }
    }

    /// Convert one progressive frame to the encoder's format, stamp it `pts`,
    /// and encode it. Only a converter that cannot be built is fatal.
    private func encode(frame source: UnsafeMutablePointer<AVFrame>, pts: Int64, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let input = converted(from: source) else {
            failed = true
            return
        }
        input.pointee.pts = pts
        // NONE lets the encoder pick; the source's own pict_type must not
        // leak through, or every source keyframe would force a spurious
        // IDR here.
        input.pointee.pict_type = keyframeRequested ? AV_PICTURE_TYPE_I : AV_PICTURE_TYPE_NONE
        keyframeRequested = false
        drainEncoder(sending: input, emit: emit)
    }

    /// Encode every frame bwdif has ready. In send_frame mode the filter owes
    /// one frame per input, delayed by one (it looks ahead for the temporal
    /// comparison), so EAGAIN here is the steady state, not an error.
    private func drainFilter(emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let filterSink, let filtered else { return }
        while av_buffersink_get_frame(filterSink, filtered) >= 0 {
            defer { av_frame_unref(filtered) }
            encode(frame: filtered, pts: filtered.pointee.pts, emit: emit)
            if failed { return }
        }
    }

    /// buffer -> bwdif -> buffersink, against the first decoded frame's REAL
    /// geometry and format, which can differ from the container's declaration.
    private func buildFilterGraph(matching decoded: UnsafeMutablePointer<AVFrame>) -> Bool {
        guard let graph = avfilter_graph_alloc() else { return false }
        filterGraph = graph

        let tb = encoderTimeBase
        let sar = decoded.pointee.sample_aspect_ratio
        let srcArgs = "video_size=\(decoded.pointee.width)x\(decoded.pointee.height)"
            + ":pix_fmt=\(decoded.pointee.format)"
            + ":time_base=\(tb.num)/\(tb.den)"
            + ":pixel_aspect=\(sar.num)/\(max(sar.den, 1))"
        // send_frame: one frame out per frame in. The DEFAULT is send_field,
        // which doubles the frame rate and would break the pipeline's timing.
        let bwdifArgs = "mode=send_frame:parity=\(topFieldFirst ? "tff" : "bff"):deint=all"

        var src: UnsafeMutablePointer<AVFilterContext>?
        var deint: UnsafeMutablePointer<AVFilterContext>?
        var sink: UnsafeMutablePointer<AVFilterContext>?
        guard avfilter_graph_create_filter(&src, avfilter_get_by_name("buffer"), "in", srcArgs, nil, graph) >= 0,
              avfilter_graph_create_filter(&deint, avfilter_get_by_name("bwdif"), "deint", bwdifArgs, nil, graph) >= 0,
              avfilter_graph_create_filter(&sink, avfilter_get_by_name("buffersink"), "out", nil, nil, graph) >= 0,
              avfilter_link(src, 0, deint, 0) >= 0,
              avfilter_link(deint, 0, sink, 0) >= 0,
              avfilter_graph_config(graph, nil) >= 0 else {
            NSLog("[VideoTranscoder] bwdif graph failed to build")
            return false
        }
        filterSrc = src
        filterSink = sink
        filtered = av_frame_alloc()
        return filtered != nil
    }

    /// The CoreVideo format that can wrap this AVFrame's planes as they stand,
    /// or nil when the layout needs an interleave first.
    private static func directPixelFormat(_ format: Int32) -> OSType? {
        switch AVPixelFormat(rawValue: format) {
        case AV_PIX_FMT_YUV420P: return kCVPixelFormatType_420YpCbCr8Planar
        case AV_PIX_FMT_YUVJ420P: return kCVPixelFormatType_420YpCbCr8PlanarFullRange
        case AV_PIX_FMT_NV12: return kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        default: return nil
        }
    }

    /// `decoded` itself when it is already what the encoder opened with,
    /// otherwise a converted copy produced by VideoToolbox.
    private func converted(from decoded: UnsafeMutablePointer<AVFrame>) -> UnsafeMutablePointer<AVFrame>? {
        guard let encoder else { return nil }
        if decoded.pointee.format == encoder.pointee.pix_fmt.rawValue
            && decoded.pointee.width == encoder.pointee.width
            && decoded.pointee.height == encoder.pointee.height {
            return decoded
        }

        if !conversionLogged {
            conversionLogged = true
            NSLog("[VideoTranscoder] Converting %dx%d fmt %d -> %dx%d fmt %d via VideoToolbox",
                  decoded.pointee.width, decoded.pointee.height, decoded.pointee.format,
                  encoder.pointee.width, encoder.pointee.height, encoder.pointee.pix_fmt.rawValue)
        }

        guard let source = wrapAsPixelBuffer(decoded) else { return nil }
        guard let dst = destinationBuffer() else { return nil }

        if transfer == nil {
            var session: VTPixelTransferSession?
            let status = VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault, pixelTransferSessionOut: &session)
            guard status == noErr, let session else {
                NSLog("[VideoTranscoder] VTPixelTransferSessionCreate failed (%d)", status)
                return nil
            }
            transfer = session
        }
        guard let session = transfer else { return nil }

        let status = VTPixelTransferSessionTransferImage(session, from: source, to: dst)
        guard status == noErr else {
            NSLog("[VideoTranscoder] pixel transfer failed (%d)", status)
            return nil
        }
        return copyOut(dst)
    }

    /// Wraps a decoded frame's planes as a CVPixelBuffer for the transfer
    /// session. Layouts CoreVideo speaks natively are wrapped in place with no
    /// copy; the two it does not are interleaved into scratch first.
    ///
    /// FFmpeg is 3-plane where CoreVideo is 2-plane or packed, which is the only
    /// reason the scratch exists:
    ///   - 10-bit planar: 10 bits sit in the LOW bits, p010 wants them in the
    ///     HIGH bits, so shift left 6 and weave U/V into one plane.
    ///   - 8-bit 4:2:2: pack to '2vuy' (UYVY), since there is no 8-bit planar
    ///     4:2:2 type on this platform.
    private func wrapAsPixelBuffer(_ frame: UnsafeMutablePointer<AVFrame>) -> CVPixelBuffer? {
        let w = Int(frame.pointee.width)
        let h = Int(frame.pointee.height)
        guard w > 0, h > 0 else { return nil }

        if let native = Self.directPixelFormat(frame.pointee.format) {
            conversion = "videotoolbox"
            var bases: [UnsafeMutableRawPointer?] = []
            var widths: [Int] = []
            var heights: [Int] = []
            var strides: [Int] = []
            let planes = native == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange ? 2 : 3
            for i in 0 ..< planes {
                guard let p = plane(frame, i) else { return nil }
                bases.append(UnsafeMutableRawPointer(p))
                let sub = i == 0 ? 1 : 2
                widths.append(w / sub)
                heights.append(i == 0 ? h : h / 2)
                strides.append(Int(linesize(frame, i)))
            }
            var pb: CVPixelBuffer?
            let status = CVPixelBufferCreateWithPlanarBytes(
                kCFAllocatorDefault, w, h, native, nil, 0,
                planes, &bases, &widths, &heights, &strides,
                nil, nil, nil, &pb)
            return status == kCVReturnSuccess ? pb : nil
        }

        return convertWithSws(frame, w, h)
    }

    /// Everything the direct wrap cannot take, into the biplanar layout
    /// VideoToolbox wants: nv12 for 8-bit sources, p010 for deeper ones.
    private func convertWithSws(_ frame: UnsafeMutablePointer<AVFrame>, _ w: Int, _ h: Int) -> CVPixelBuffer? {
        conversion = "swscale"
        let srcFormat = AVPixelFormat(rawValue: frame.pointee.format)
        let deep = (av_pix_fmt_desc_get(srcFormat)?.pointee.comp.0.depth ?? 8) > 8
        let dstFormat = deep ? AV_PIX_FMT_P010LE : AV_PIX_FMT_NV12
        let cvFormat = deep ? kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
                            : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange

        sws = sws_getCachedContext(sws, Int32(w), Int32(h), srcFormat,
                                   Int32(w), Int32(h), dstFormat,
                                   Int32(SWS_BILINEAR.rawValue), nil, nil, nil)
        guard let sws else { return nil }

        // Biplanar 4:2:0: chroma is half height, same width in bytes as luma.
        let bytes = deep ? 2 : 1
        let lumaStride = w * bytes
        let chromaHeight = (h + 1) / 2
        let lumaSize = lumaStride * h
        guard let scratch = scratch(lumaSize + lumaStride * chromaHeight) else { return nil }

        var srcData = (0 ..< 4).map { plane(frame, $0).map { UnsafePointer($0) } }
        var srcStride = (0 ..< 4).map { linesize(frame, $0) }
        var dstData: [UnsafeMutablePointer<UInt8>?] = [
            scratch.assumingMemoryBound(to: UInt8.self),
            (scratch + lumaSize).assumingMemoryBound(to: UInt8.self),
            nil, nil,
        ]
        var dstStride: [Int32] = [Int32(lumaStride), Int32(lumaStride), 0, 0]

        let rows = sws_scale(sws, &srcData, &srcStride, 0, Int32(h), &dstData, &dstStride)
        guard rows > 0 else { return nil }

        var bases: [UnsafeMutableRawPointer?] = [scratch, scratch + lumaSize]
        var widths = [w, w / 2]
        var heights = [h, chromaHeight]
        var strides = [lumaStride, lumaStride]
        var pb: CVPixelBuffer?
        let status = CVPixelBufferCreateWithPlanarBytes(
            kCFAllocatorDefault, w, h, cvFormat,
            nil, 0, 2, &bases, &widths, &heights, &strides, nil, nil, nil, &pb)
        return status == kCVReturnSuccess ? pb : nil
    }

    /// The transfer target, in the encoder's format, allocated once.
    private func destinationBuffer() -> CVPixelBuffer? {
        if let destination { return destination }
        guard let encoder else { return nil }
        let format: OSType = encoder.pointee.pix_fmt == AV_PIX_FMT_P010LE
            ? kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
            : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        var pb: CVPixelBuffer?
        let attrs: [CFString: Any] = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary]
        let status = CVPixelBufferCreate(kCFAllocatorDefault,
                                         Int(encoder.pointee.width), Int(encoder.pointee.height),
                                         format, attrs as CFDictionary, &pb)
        guard status == kCVReturnSuccess else {
            NSLog("[VideoTranscoder] destination CVPixelBuffer failed (%d)", status)
            return nil
        }
        destination = pb
        return pb
    }

    /// Copies the converted pixels into the AVFrame the encoder is fed.
    ///
    /// E2 proved a zero-copy route as well (AV_PIX_FMT_VIDEOTOOLBOX with a
    /// hw_frames_ctx), which is the optimisation to take if profiling ever shows
    /// this copy mattering. Correctness first: this route needs no hardware
    /// frame pool and no change to how encoderParameters are derived.
    private func copyOut(_ pb: CVPixelBuffer) -> UnsafeMutablePointer<AVFrame>? {
        guard let encoder else { return nil }
        if converted == nil {
            guard let out = av_frame_alloc() else { return nil }
            out.pointee.format = encoder.pointee.pix_fmt.rawValue
            out.pointee.width = encoder.pointee.width
            out.pointee.height = encoder.pointee.height
            guard av_frame_get_buffer(out, 0) >= 0 else { return nil }
            converted = out
        }
        guard let dst = converted, av_frame_make_writable(dst) >= 0 else { return nil }

        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        for i in 0 ..< CVPixelBufferGetPlaneCount(pb) {
            guard let src = CVPixelBufferGetBaseAddressOfPlane(pb, i),
                  let out = plane(dst, i) else { return nil }
            let srcStride = CVPixelBufferGetBytesPerRowOfPlane(pb, i)
            let dstStride = Int(linesize(dst, i))
            let rows = CVPixelBufferGetHeightOfPlane(pb, i)
            let bytes = min(srcStride, dstStride)
            for row in 0 ..< rows {
                memcpy(out + row * dstStride, src + row * srcStride, bytes)
            }
        }
        return dst
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

    /// Interleave scratch, grown on demand and reused for the session.
    private func scratch(_ size: Int) -> UnsafeMutableRawPointer? {
        if interleaveSize < size {
            interleave?.deallocate()
            interleave = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 32)
            interleaveSize = size
        }
        return interleave
    }

    private func drainEncoder(sending frame: UnsafeMutablePointer<AVFrame>?, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let encoder else { return }
        guard avcodec_send_frame(encoder, frame) >= 0 else {
            // A frame the open encoder cannot take is a broken contract
            // (format/dimension change mid-stream), not a transient hiccup.
            if frame != nil {
                NSLog("[VideoTranscoder] Encoder rejected a frame — failing")
                failed = true
            }
            return
        }

        guard let out = av_packet_alloc() else { return }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = out
            av_packet_free(&freeing)
        }

        while true {
            let ret = avcodec_receive_packet(encoder, out)
            if ret == SWIFT_AVERROR_EAGAIN_VT || ret == SWIFT_AVERROR_EOF_VT || ret < 0 { break }
            framesEncoded += 1
            emit(out)
            av_packet_unref(out)
        }
    }

    /// Decodes one packet and discards the frames: the benchmark's decode-only mode.
    func decodeOnly(packet: UnsafeMutablePointer<AVPacket>?) -> Int {
        guard let decoder, let frame, avcodec_send_packet(decoder, packet) >= 0 else { return 0 }
        var count = 0
        while avcodec_receive_frame(decoder, frame) >= 0 {
            av_frame_unref(frame)
            count += 1
        }
        return count
    }

    /// Drops decoder state so the input can be read again from the start.
    func flushDecoder() {
        if let decoder { avcodec_flush_buffers(decoder) }
    }

    /// Names of the codecs actually opened, and the layout the decoder settled on.
    var decoderName: String { decoder.flatMap { $0.pointee.codec.map { String(cString: $0.pointee.name) } } ?? "none" }
    var encoderName: String { encoder.flatMap { $0.pointee.codec.map { String(cString: $0.pointee.name) } } ?? "none" }
    var decodedPixelFormat: String { decoder.flatMap { av_get_pix_fmt_name($0.pointee.pix_fmt).map { String(cString: $0) } } ?? "unknown" }

    // MARK: - Throughput measurement

    private static let thermalNames = ["nominal", "fair", "serious", "critical"]

    private static func thermal() -> String {
        let state = ProcessInfo.processInfo.thermalState.rawValue
        return state < thermalNames.count ? thermalNames[state] : "unknown"
    }

    /// Runs `inputUrl` through the decoder, conversion and encoder playback uses for
    /// `wallSeconds` of wall clock, looping the file at EOF; `encode == false` stops at the
    /// decoder. Bridge-ready record; a run that cannot start or breaks carries `failed`.
    static func benchmark(inputUrl: String, wallSeconds: Double, encode: Bool) -> [String: Any] {
        var result: [String: Any] = ["encode": encode, "thermalBefore": thermal()]
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        guard avformat_open_input(&inputCtx, inputUrl, nil, nil) >= 0, let input = inputCtx else {
            result["failed"] = "cannot open input"
            return result
        }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }
        guard avformat_find_stream_info(input, nil) >= 0 else {
            result["failed"] = "no stream info"
            return result
        }
        let videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard videoIn >= 0, let stream = input.pointee.streams[Int(videoIn)], let params = stream.pointee.codecpar else {
            result["failed"] = "no video stream"
            return result
        }
        result["codec"] = String(cString: avcodec_get_name(params.pointee.codec_id))
        result["width"] = Int(params.pointee.width)
        result["height"] = Int(params.pointee.height)
        let guessed = av_guess_frame_rate(nil, stream, nil)
        let sourceFps = guessed.den > 0 && guessed.num > 0 ? Double(guessed.num) / Double(guessed.den) : 0
        result["sourceFps"] = sourceFps

        guard let transcoder = VideoTranscoder(inputStream: stream, openEncoder: encode) else {
            result["failed"] = encode ? "decoder or encoder failed to open" : "decoder failed to open"
            return result
        }
        result["decoder"] = transcoder.decoderName
        result["encoder"] = transcoder.encoderName
        result["deinterlaced"] = transcoder.deinterlacing

        guard let pkt = av_packet_alloc() else {
            result["failed"] = "packet alloc failed"
            return result
        }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = pkt
            av_packet_free(&freeing)
        }

        // The encoder needs presentation times that keep climbing, so each pass over the
        // file is shifted past the last timestamp the previous pass reached.
        var ptsOffset: Int64 = 0
        var maxPts: Int64 = 0
        var lastStep: Int64 = 1
        var previousPts: Int64? = nil
        var loops = 0
        var frames = 0
        var windows: [Double] = []
        var windowFrames = 0
        let started = Date()
        var windowStart = started
        var failed: String? = nil

        while Date().timeIntervalSince(started) < wallSeconds {
            if av_read_frame(input, pkt) < 0 {
                guard av_seek_frame(input, videoIn, 0, AVSEEK_FLAG_BACKWARD) >= 0 else {
                    failed = "seek to start failed"
                    break
                }
                transcoder.flushDecoder()
                ptsOffset = maxPts + lastStep
                previousPts = nil
                loops += 1
                continue
            }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIn else { continue }
            if pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE_VT {
                if let previous = previousPts, pkt.pointee.pts > previous { lastStep = pkt.pointee.pts - previous }
                previousPts = pkt.pointee.pts
                pkt.pointee.pts += ptsOffset
                maxPts = max(maxPts, pkt.pointee.pts)
            }
            if pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE_VT { pkt.pointee.dts += ptsOffset }

            let produced: Int
            if encode {
                let before = transcoder.framesEncoded
                transcoder.process(packet: pkt) { _ in }
                produced = transcoder.framesEncoded - before
            } else {
                produced = transcoder.decodeOnly(packet: pkt)
            }
            if transcoder.failed {
                failed = "pipeline failed"
                break
            }
            frames += produced
            windowFrames += produced
            let now = Date()
            let elapsed = now.timeIntervalSince(windowStart)
            if elapsed >= 10 {
                windows.append(Double(windowFrames) / elapsed)
                windowStart = now
                windowFrames = 0
            }
        }

        let seconds = Date().timeIntervalSince(started)
        let fps = seconds > 0 ? Double(frames) / seconds : 0
        result["pixFmt"] = transcoder.decodedPixelFormat
        result["conversion"] = encode ? transcoder.conversion : "none"
        result["frames"] = frames
        result["seconds"] = seconds
        result["fps"] = fps
        result["realtime"] = sourceFps > 0 ? fps / sourceFps : 0
        result["loops"] = loops
        result["windows"] = windows
        result["thermalAfter"] = thermal()
        if let failed { result["failed"] = failed }
        return result
    }
}
