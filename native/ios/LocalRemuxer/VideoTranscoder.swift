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
//  Interlaced sources are deinterlaced here, BEFORE the conversion, on the
//  decoder's planar output: the converted frame is biplanar and the pass walks
//  separate planes.
//
//  The pass is motion-adaptive and single-rate. An interlaced frame holds two
//  fields captured 1/50s apart. The temporally first field is kept verbatim;
//  each row of the second is woven back in where the pixel has not changed since
//  the previous frame, or replaced by the average of the rows above and below.
//  Still areas keep full vertical detail, only moving ones soften.
//



import CoreVideo
import Foundation
import Libavcodec
import Libavformat
import Libavutil
import Libswscale
import VideoToolbox

private let SWIFT_AVERROR_EAGAIN_VT: Int32 = -35
private let SWIFT_AVERROR_EOF_VT: Int32 = -541_478_725
private let SWIFT_AV_NOPTS_VALUE_VT = Int64(bitPattern: 0x8000_0000_0000_0000)

/// Result of a throughput measurement.
struct VideoTranscodeBenchmark {
    let framesEncoded: Int
    let seconds: Double
    let sourceFrameRate: Double
    let width: Int32
    let height: Int32
    /// Encoded frames per second achieved.
    var fps: Double { seconds > 0 ? Double(framesEncoded) / seconds : 0 }
    /// How much faster than real time. Below 1.0 means playback would stall.
    var realtimeFactor: Double { sourceFrameRate > 0 ? fps / sourceFrameRate : 0 }
}

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

    /// Set when the source is interlaced. Drives the pass below and pins the
    /// encoder to 8-bit planar, which is the only layout that pass handles.
    private let deinterlacing: Bool
    /// True when the temporally first field is the top one, so its rows (even,
    /// 0-based) are the ones kept verbatim.
    private let topFieldFirst: Bool
    /// Output of the deinterlace pass, reused across frames.
    private var deinterlaced: UnsafeMutablePointer<AVFrame>?
    /// The previous frame as it entered the pass, for motion detection. Holds
    /// its own reference, so the scaler reallocating its output cannot pull the
    /// pixels out from under it.
    private var previous: UnsafeMutablePointer<AVFrame>?

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
    /// through VideoToolbox, exactly like VP9.
    ///
    /// Measured: 1080p AV1 decodes at 681 fps, 28.4x realtime, on Apple silicon.
    /// The resolution gate in services/localRemux.ts is what bounds it.
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
    init?(inputStream: UnsafeMutablePointer<AVStream>, keyframeInterval: Double = 6.0, maxBitrate: Int64 = 12_000_000) {
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
        // The deinterlace pass reads 8-bit planes, so an interlaced source stays 8-bit
        // whatever it claims.
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

        frame = av_frame_alloc()

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
        av_frame_free(&deinterlaced)
        av_frame_free(&previous)
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
        // encoder is checked but not bound: encoderInput() re-binds it, and the
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

            // Whatever the decoder produced, in the format the encoder opened
            // with. Only a scaler that cannot be built is fatal.
            guard let source = encoderInput(for: frame) else {
                failed = true
                return
            }

            source.pointee.pts = pts

            // NONE lets the encoder pick; the decoder's own pict_type must not
            // leak through, or every source keyframe would force a spurious
            // IDR here.
            source.pointee.pict_type = keyframeRequested ? AV_PICTURE_TYPE_I : AV_PICTURE_TYPE_NONE
            keyframeRequested = false

            drainEncoder(sending: source, emit: emit)
        }

        if packet == nil {
            drainEncoder(sending: nil, emit: emit)
        }
    }

    /// The decoded frame if the encoder already takes that format, otherwise a
    /// converted copy. Nil means the converter could not be built, which is the
    /// only remaining fatal pixel-format outcome.
    ///
    /// Dimensions come from the encoder, not the source, so a decoder that
    /// settles on a different size than the container declared is rescaled
    /// instead of rejected by avcodec_send_frame.
    private func encoderInput(for decoded: UnsafeMutablePointer<AVFrame>) -> UnsafeMutablePointer<AVFrame>? {
        // Deinterlace first, on the decoder's own planar output: after the
        // conversion the frame is nv12 and the pass walks separate planes.
        let progressive = deinterlacing ? deinterlace(decoded) : decoded
        guard let progressive else { return nil }
        return converted(from: progressive)
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

    /// One row of a reconstructed field: kept where the picture is still,
    /// interpolated vertically where it moved.
    ///
    /// `prev` is the same plane one frame earlier, which is the same field
    /// parity and so a like-for-like comparison. Without it (the first frame of
    /// a session, or the first after a seek) every reconstructed row is
    /// interpolated, which costs one slightly soft frame and never combs.
    private static func deinterlacePlane(
        dst: UnsafeMutablePointer<UInt8>, dstStride: Int,
        src: UnsafePointer<UInt8>, srcStride: Int,
        prev: UnsafePointer<UInt8>?, prevStride: Int,
        width: Int, height: Int, keepEvenRows: Bool
    ) {
        // Above the noise floor of a DVD-era encode, below the smallest motion
        // the eye reads as movement. Too low and film grain alone would force
        // interpolation on a still frame, throwing away the detail this pass
        // exists to keep.
        let motionThreshold = 12

        for y in 0 ..< height {
            let srcRow = src + y * srcStride
            let dstRow = dst + y * dstStride

            if (y % 2 == 0) == keepEvenRows {
                memcpy(dstRow, srcRow, width)
                continue
            }

            // Both neighbours belong to the kept field, so they share one
            // instant in time; averaging them cannot reintroduce combing. At
            // the picture edges there is only one neighbour to use.
            let above = y > 0 ? src + (y - 1) * srcStride : src + (y + 1) * srcStride
            let below = y < height - 1 ? src + (y + 1) * srcStride : src + (y - 1) * srcStride

            guard let prev else {
                for x in 0 ..< width {
                    dstRow[x] = UInt8((Int(above[x]) + Int(below[x])) / 2)
                }
                continue
            }

            let prevRow = prev + y * prevStride
            for x in 0 ..< width {
                let original = Int(srcRow[x])
                let moved = abs(original - Int(prevRow[x])) >= motionThreshold
                dstRow[x] = moved ? UInt8((Int(above[x]) + Int(below[x])) / 2) : UInt8(original)
            }
        }
    }

    /// Runs the pass over Y, U and V and returns the result. Chroma gets the
    /// same treatment as luma: in 4:2:0 its rows are already a vertical average
    /// of a field pair, so the parity split is approximate there, but chroma
    /// error at half resolution is far less visible than the combing it removes.
    private func deinterlace(_ source: UnsafeMutablePointer<AVFrame>) -> UnsafeMutablePointer<AVFrame>? {
        // Matches the SOURCE, not the encoder: the pass runs before the conversion,
        // on whatever planar format the decoder produced.
        if deinterlaced == nil {
            guard let out = av_frame_alloc() else { return nil }
            out.pointee.format = source.pointee.format
            out.pointee.width = source.pointee.width
            out.pointee.height = source.pointee.height
            guard av_frame_get_buffer(out, 0) >= 0 else {
                var freeing: UnsafeMutablePointer<AVFrame>? = out
                av_frame_free(&freeing)
                NSLog("[VideoTranscoder] deinterlace buffer allocation failed")
                return nil
            }
            deinterlaced = out
        }
        guard let dst = deinterlaced else { return nil }

        // The encoder still references the frame it was handed last time, so
        // this reallocates rather than scribbling over a picture in flight.
        guard av_frame_make_writable(dst) >= 0 else {
            NSLog("[VideoTranscoder] deinterlace frame not writable")
            return nil
        }
        av_frame_copy_props(dst, source)

        let width = Int(source.pointee.width)
        let height = Int(source.pointee.height)
        // Chroma geometry comes from the format's own subsampling, not from an
        // assumed 4:2:0. An interlaced 4:2:2 source has full-height chroma, and
        // halving it here would have walked off the end of the plane.
        guard let desc = av_pix_fmt_desc_get(AVPixelFormat(rawValue: source.pointee.format)) else { return nil }
        let cw = (width + (1 << desc.pointee.log2_chroma_w) - 1) >> desc.pointee.log2_chroma_w
        let ch = (height + (1 << desc.pointee.log2_chroma_h) - 1) >> desc.pointee.log2_chroma_h
        let planes: [(dst: UnsafeMutablePointer<UInt8>?, dstStride: Int32, src: UnsafeMutablePointer<UInt8>?, srcStride: Int32, prev: UnsafeMutablePointer<UInt8>?, prevStride: Int32, w: Int, h: Int)] = [
            (dst.pointee.data.0, dst.pointee.linesize.0, source.pointee.data.0, source.pointee.linesize.0, previous?.pointee.data.0, previous?.pointee.linesize.0 ?? 0, width, height),
            (dst.pointee.data.1, dst.pointee.linesize.1, source.pointee.data.1, source.pointee.linesize.1, previous?.pointee.data.1, previous?.pointee.linesize.1 ?? 0, cw, ch),
            (dst.pointee.data.2, dst.pointee.linesize.2, source.pointee.data.2, source.pointee.linesize.2, previous?.pointee.data.2, previous?.pointee.linesize.2 ?? 0, cw, ch),
        ]

        for plane in planes {
            guard let d = plane.dst, let s = plane.src, plane.w > 0, plane.h > 0 else { continue }
            Self.deinterlacePlane(
                dst: d, dstStride: Int(plane.dstStride),
                src: s, srcStride: Int(plane.srcStride),
                prev: plane.prev.map { UnsafePointer($0) }, prevStride: Int(plane.prevStride),
                width: plane.w, height: plane.h,
                keepEvenRows: topFieldFirst
            )
        }

        // Hold this frame for the next one's motion test. Its own reference, so
        // the scaler is free to hand out new buffers immediately.
        if previous == nil { previous = av_frame_alloc() }
        if let prev = previous {
            av_frame_unref(prev)
            av_frame_ref(prev, source)
        }

        return dst
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

    // MARK: - Throughput measurement

    /// Decode + hardware-encode `frameBudget` frames of `inputUrl` and report
    /// the rate achieved. Kept for the macOS harness; the playback pipeline
    /// never calls it.
    static func benchmark(inputUrl: String, frameBudget: Int = 600) -> VideoTranscodeBenchmark? {
        var inputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        guard avformat_open_input(&inputCtx, inputUrl, nil, nil) >= 0, let input = inputCtx else {
            NSLog("[VideoTranscoder] benchmark: cannot open input")
            return nil
        }
        defer {
            var closing: UnsafeMutablePointer<AVFormatContext>? = input
            avformat_close_input(&closing)
        }
        guard avformat_find_stream_info(input, nil) >= 0 else { return nil }

        let videoIn = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
        guard videoIn >= 0, let stream = input.pointee.streams[Int(videoIn)] else { return nil }
        guard let transcoder = VideoTranscoder(inputStream: stream) else { return nil }

        let guessed = av_guess_frame_rate(nil, stream, nil)
        let sourceFps = guessed.den > 0 ? Double(guessed.num) / Double(guessed.den) : 0

        guard let pkt = av_packet_alloc() else { return nil }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = pkt
            av_packet_free(&freeing)
        }

        let started = Date()
        while transcoder.framesEncoded < frameBudget {
            if av_read_frame(input, pkt) < 0 { break }
            defer { av_packet_unref(pkt) }
            guard pkt.pointee.stream_index == videoIn else { continue }
            transcoder.process(packet: pkt) { _ in }
            if transcoder.failed { return nil }
        }
        transcoder.process(packet: nil) { _ in }

        return VideoTranscodeBenchmark(
            framesEncoded: transcoder.framesEncoded,
            seconds: Date().timeIntervalSince(started),
            sourceFrameRate: sourceFps,
            width: stream.pointee.codecpar.pointee.width,
            height: stream.pointee.codecpar.pointee.height
        )
    }
}
