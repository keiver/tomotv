//
//  AudioTranscoder.swift
//  TomoTV
//
//  Decodes one audio stream and re-encodes it, so audio AVPlayer cannot play
//  (AC3, EAC3, DTS, TrueHD, Opus, Vorbis, PCM) still rides through the local
//  remux pipeline. Video is never touched: it keeps stream-copying, which is the
//  whole point of the engine.
//
//  FLAC is the encode target, with AAC as the fallback. FLAC is lossless, Apple
//  permits it for multichannel HLS in fMP4, and its channel layouts are
//  UNRESTRICTED, so a 5.1(side) or 6.1 or 7.1 source keeps the exact layout it
//  arrived with. ALAC was the obvious alternative and is wrong for this: its
//  registered layout list carries one entry per channel count, so its only
//  6-channel entry is 5.1(back) and its only 8-channel entry is 7.1(wide).
//  Feeding it a real 7.1 source fails to open outright, and feeding it AC-3's
//  5.1(side) would relabel side channels as back ones. ALAC stays in the copy
//  set, where no relabeling can happen.
//
//  `aac_at` used to be preferred here on the belief that it ran on dedicated
//  silicon. It is not in the build at all — the FFmpeg configure line is
//  `--disable-encoders` plus an allowlist of aac, alac, flac, pcm*, movtext,
//  mpeg4 and the videotoolbox encoders — so that branch never once executed and
//  software `aac` has always done the work. `npm run probe:codecs` prints this.
//
//  The tricky part is timestamps. The encoder consumes fixed-size frames and
//  emits packets on its own clock with its own priming delay, so output PTS
//  comes from the encoder's time base and is rescaled on the way out. Copying
//  the input packet's PTS here would drift audio out of sync.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil
import Libswresample

private let SWIFT_AVERROR_EAGAIN: Int32 = -35 // EAGAIN on Darwin
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)

/// Size of a FLAC STREAMINFO metadata block. `mov_write_dfla_tag` accepts
/// extradata of exactly this length and nothing else.
private let FLAC_STREAMINFO_SIZE: Int32 = 34

/// Channel layouts an encoder accepts, or nil when it declares no restriction.
private func supportedLayouts(_ codec: UnsafePointer<AVCodec>) -> [AVChannelLayout]? {
    var raw: UnsafeRawPointer? = nil
    var count: Int32 = 0
    guard avcodec_get_supported_config(nil, codec, AV_CODEC_CONFIG_CHANNEL_LAYOUT, 0, &raw, &count) >= 0,
          let base = raw?.assumingMemoryBound(to: AVChannelLayout.self), count > 0 else { return nil }
    return (0 ..< Int(count)).map { base[$0] }
}

/// Sample formats an encoder accepts, in the codec's own order of preference.
private func supportedSampleFormats(_ codec: UnsafePointer<AVCodec>) -> [AVSampleFormat] {
    var raw: UnsafeRawPointer? = nil
    var count: Int32 = 0
    guard avcodec_get_supported_config(nil, codec, AV_CODEC_CONFIG_SAMPLE_FORMAT, 0, &raw, &count) >= 0,
          let base = raw?.assumingMemoryBound(to: AVSampleFormat.self), count > 0 else { return [] }
    return (0 ..< Int(count)).map { base[$0] }
}

/// The layout to encode with: the source's own if the encoder allows it, else an
/// allowed layout with the same channel count, else the widest allowed layout
/// that fits under `cap`.
///
/// Preserving the source layout matters. `av_channel_layout_default(6)` returns
/// 5.1(back), but AC-3 and DTS decode to 5.1(side); taking the default would
/// relabel every surround channel on the way out.
private func chooseLayout(codec: UnsafePointer<AVCodec>, source: AVChannelLayout, cap: Int32) -> AVChannelLayout? {
    var src = source
    guard let allowed = supportedLayouts(codec) else {
        // Unrestricted (FLAC, native AAC): keep the source exactly, downmixing
        // only if it exceeds the cap.
        if src.nb_channels <= cap { return src }
        var fallback = AVChannelLayout()
        av_channel_layout_default(&fallback, cap)
        return fallback
    }

    let fits = allowed.filter { $0.nb_channels <= cap }
    if let exact = fits.first(where: { var a = $0; return av_channel_layout_compare(&a, &src) == 0 }) { return exact }
    if let sameCount = fits.first(where: { $0.nb_channels == src.nb_channels }) { return sameCount }
    return fits.max(by: { $0.nb_channels < $1.nb_channels })
}

/// The narrowest supported format that still holds the decoder's samples, so a
/// 24-bit source is not quietly truncated. FLAC lists s16 first, so taking
/// `sample_fmts[0]` would do exactly that.
private func chooseSampleFormat(codec: UnsafePointer<AVCodec>, source: AVSampleFormat) -> AVSampleFormat {
    let formats = supportedSampleFormats(codec)
    guard !formats.isEmpty else { return AV_SAMPLE_FMT_FLTP }
    if formats.contains(where: { $0 == source }) { return source }
    let needed = av_get_bytes_per_sample(source)
    let wide = formats.filter { av_get_bytes_per_sample($0) >= needed }
    if let best = wide.min(by: { av_get_bytes_per_sample($0) < av_get_bytes_per_sample($1) }) { return best }
    return formats.max(by: { av_get_bytes_per_sample($0) < av_get_bytes_per_sample($1) }) ?? formats[0]
}

/// Wraps decoder + resampler + encoder for a single audio stream.
final class AudioTranscoder {
    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    private var encoder: UnsafeMutablePointer<AVCodecContext>?
    private var swr: OpaquePointer?
    private var fifo: OpaquePointer?

    private var decodedFrame: UnsafeMutablePointer<AVFrame>?
    private var encodeFrame: UnsafeMutablePointer<AVFrame>?

    /// Running sample count, the encoder's own clock. Output PTS derives from
    /// this rather than from individual input packets, but it is SEEDED from
    /// the first packet fed in, so the encoded audio lands at the position the
    /// stream actually carries. Seeding it from a nominal segment boundary
    /// instead splits audio from video on every seek-restart that opens on a
    /// keyframe sitting before that boundary.
    private var samplesEncoded: Int64 = 0
    private var clockSeeded = false

    /// Time base of the packets `process` is fed, needed to seed the clock.
    private let inputTimeBase: AVRational

    /// Parameters the muxer needs for the output stream; valid after `init`.
    private(set) var encoderParameters: UnsafeMutablePointer<AVCodecParameters>?
    var encoderTimeBase: AVRational { AVRational(num: 1, den: encoder?.pointee.sample_rate ?? 48000) }

    /// Streams that go through untouched. Everything else is transcoded.
    ///
    /// MP3 is deliberately NOT copied: Apple's HLS spec allows MP3 only in
    /// MPEG-TS segments, and AVPlayer refuses an fMP4 stream whose audio
    /// sample entry is .mp3 with a bare "Cannot Open" (found by the macOS
    /// harness on an Xvid+MP3 AVI; the same file plays once the audio is AAC).
    ///
    /// FLAC copies only when its extradata is exactly a STREAMINFO block:
    /// `mov_write_dfla_tag` returns AVERROR_INVALIDDATA for anything else, which
    /// would fail the whole session at write_header. Matroska and native .flac
    /// both hand over exactly 34 bytes, so the common case copies; anything
    /// unusual falls through to the encoder rather than breaking playback.
    ///
    /// AC-3 and E-AC-3 copy because Apple TV can bitstream them to a receiver
    /// and nothing else can: they are the only formats on Apple's permitted list
    /// that leave the device compressed, and Dolby Atmos rides inside E-AC-3 as
    /// JOC side data, so a byte copy is what preserves it. Decoding them would
    /// throw the Atmos away and hand the receiver PCM. Their sample-entry boxes
    /// force the muxer into delay_moov; see buildMuxer in Remuxer.swift.
    static func needsTranscode(stream: UnsafeMutablePointer<AVStream>) -> Bool {
        let params = stream.pointee.codecpar!
        switch params.pointee.codec_id {
        case AV_CODEC_ID_AAC, AV_CODEC_ID_ALAC, AV_CODEC_ID_AC3, AV_CODEC_ID_EAC3:
            return false
        case AV_CODEC_ID_FLAC:
            return params.pointee.extradata_size != FLAC_STREAMINFO_SIZE
        default:
            return true
        }
    }

    /// After a seek the pipeline builds a fresh transcoder rather than reusing
    /// this one, because AAC encoders cannot be flushed ("Ignoring attempt to
    /// flush encoder that doesn't support it") and would otherwise emit queued
    /// frames carrying pre-seek timestamps, which the muxer rejects as
    /// non-monotonic. The new instance picks its clock up from the first packet
    /// it is handed, so it needs no position argument.
    ///
    /// - Parameter preferLossless: try FLAC before AAC. Off falls straight to
    ///   AAC, which is the escape hatch if a device turns out not to accept
    ///   multichannel FLAC in our hand-written fMP4.
    /// - Parameter maxChannels: 8, so 7.1 and 6.1 sources keep every channel.
    ///   The layout itself is preserved rather than replaced with a default.
    init?(inputStream: UnsafeMutablePointer<AVStream>, preferLossless: Bool = true, maxChannels: Int32 = 8) {
        inputTimeBase = inputStream.pointee.time_base
        let params = inputStream.pointee.codecpar!

        guard let decoderCodec = avcodec_find_decoder(params.pointee.codec_id),
              let decCtx = avcodec_alloc_context3(decoderCodec) else {
            NSLog("[AudioTranscoder] No decoder for codec id %d", params.pointee.codec_id.rawValue)
            return nil
        }
        decoder = decCtx
        guard avcodec_parameters_to_context(decCtx, params) >= 0,
              avcodec_open2(decCtx, decoderCodec, nil) >= 0 else {
            NSLog("[AudioTranscoder] Failed to open decoder")
            return nil
        }

        let sourceRate = decCtx.pointee.sample_rate > 0 ? decCtx.pointee.sample_rate : 48000
        var sourceLayout = decCtx.pointee.ch_layout
        if sourceLayout.nb_channels <= 0 { av_channel_layout_default(&sourceLayout, 2) }

        // Lossless first, lossy as the fallback. Each candidate is fully
        // configured and opened; the first that opens wins. An encoder that
        // refuses this source therefore costs a failed open, not the session.
        var candidates: [AVCodecID] = []
        if preferLossless { candidates.append(AV_CODEC_ID_FLAC) }
        candidates.append(AV_CODEC_ID_AAC)

        var opened: (codec: UnsafePointer<AVCodec>, ctx: UnsafeMutablePointer<AVCodecContext>)? = nil
        for id in candidates {
            guard let codec = avcodec_find_encoder(id), let ctx = avcodec_alloc_context3(codec) else { continue }
            var unusable: UnsafeMutablePointer<AVCodecContext>? = ctx
            guard var layout = chooseLayout(codec: codec, source: sourceLayout, cap: maxChannels) else {
                avcodec_free_context(&unusable)
                continue
            }
            av_channel_layout_copy(&ctx.pointee.ch_layout, &layout)
            ctx.pointee.sample_rate = sourceRate
            ctx.pointee.sample_fmt = chooseSampleFormat(codec: codec, source: decCtx.pointee.sample_fmt)
            ctx.pointee.time_base = AVRational(num: 1, den: sourceRate)
            // Only lossy encoders take a bitrate, and it has to scale with the
            // channel count: a flat 192k across 6 channels is 32k per channel,
            // where Apple's own target for 5.1 AAC-LC is 384k.
            if id == AV_CODEC_ID_AAC {
                ctx.pointee.bit_rate = max(192_000, Int64(ctx.pointee.ch_layout.nb_channels) * 64_000)
            }
            // Carried into the sample entry for FLAC and ALAC, so it has to
            // describe the real depth or the box lies about the stream.
            ctx.pointee.bits_per_raw_sample = decCtx.pointee.bits_per_raw_sample
            // The muxer writes a global header (moov) up front, so the encoder
            // must put its config in extradata rather than inline.
            ctx.pointee.flags |= AV_CODEC_FLAG_GLOBAL_HEADER

            if avcodec_open2(ctx, codec, nil) >= 0 {
                opened = (codec, ctx)
                break
            }
            var failed: UnsafeMutablePointer<AVCodecContext>? = ctx
            avcodec_free_context(&failed)
            NSLog("[AudioTranscoder] %s rejected this source, trying the next encoder", codec.pointee.name)
        }

        guard let (encCodec, encCtx) = opened else {
            NSLog("[AudioTranscoder] No usable audio encoder for this source")
            return nil
        }
        encoder = encCtx

        var chosenLayout = encCtx.pointee.ch_layout
        var layoutName = [CChar](repeating: 0, count: 64)
        av_channel_layout_describe(&chosenLayout, &layoutName, layoutName.count)
        NSLog("[AudioTranscoder] %s %s %dHz %s", encCodec.pointee.name, layoutName, encCtx.pointee.sample_rate,
              av_get_sample_fmt_name(encCtx.pointee.sample_fmt))

        var resampler: OpaquePointer? = nil
        guard swr_alloc_set_opts2(
            &resampler,
            &encCtx.pointee.ch_layout, encCtx.pointee.sample_fmt, encCtx.pointee.sample_rate,
            &decCtx.pointee.ch_layout, decCtx.pointee.sample_fmt, decCtx.pointee.sample_rate,
            0, nil
        ) >= 0, let swrCtx = resampler, swr_init(swrCtx) >= 0 else {
            NSLog("[AudioTranscoder] Failed to init resampler")
            return nil
        }
        swr = swrCtx

        // The encoder wants fixed-size frames; the decoder rarely produces
        // them, so resampled samples queue here until a full frame is ready.
        guard let queue = av_audio_fifo_alloc(encCtx.pointee.sample_fmt, encCtx.pointee.ch_layout.nb_channels, 1) else {
            return nil
        }
        fifo = queue

        decodedFrame = av_frame_alloc()
        encodeFrame = av_frame_alloc()
        guard let encFrame = encodeFrame else { return nil }
        encFrame.pointee.nb_samples = encCtx.pointee.frame_size > 0 ? encCtx.pointee.frame_size : 1024
        encFrame.pointee.format = encCtx.pointee.sample_fmt.rawValue
        av_channel_layout_copy(&encFrame.pointee.ch_layout, &encCtx.pointee.ch_layout)
        encFrame.pointee.sample_rate = encCtx.pointee.sample_rate
        guard av_frame_get_buffer(encFrame, 0) >= 0 else { return nil }

        let outParams = avcodec_parameters_alloc()
        guard let outParams, avcodec_parameters_from_context(outParams, encCtx) >= 0 else { return nil }
        encoderParameters = outParams
    }

    deinit {
        // These free functions take a pointer-to-optional and nil it out, so
        // the properties are passed directly rather than unwrapped into
        // non-optional locals first.
        avcodec_free_context(&decoder)
        avcodec_free_context(&encoder)
        swr_free(&swr)
        if let fifo { av_audio_fifo_free(fifo) }
        av_frame_free(&decodedFrame)
        av_frame_free(&encodeFrame)
        avcodec_parameters_free(&encoderParameters)
    }

    /// Feed one input packet; `emit` receives each encoded AAC packet. Passing
    /// nil flushes the decoder and encoder at end of stream.
    func process(packet: UnsafeMutablePointer<AVPacket>?, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let decoder, let swr, let fifo, let decodedFrame else { return }

        // Seed the encoder clock from the first packet. The pipeline has
        // already rebased that timestamp onto the output timeline, so the
        // encoded audio lands exactly where the source audio sits, whatever
        // segment the generation happened to open on.
        if !clockSeeded, let packet, packet.pointee.pts != SWIFT_AV_NOPTS_VALUE {
            samplesEncoded = max(0, av_rescale_q(packet.pointee.pts, inputTimeBase, encoderTimeBase))
            clockSeeded = true
        }

        if avcodec_send_packet(decoder, packet) < 0 { return }

        while avcodec_receive_frame(decoder, decodedFrame) >= 0 {
            defer { av_frame_unref(decodedFrame) }

            // Convert to the encoder's format and park the samples in the FIFO.
            let maxOut = swr_get_out_samples(swr, decodedFrame.pointee.nb_samples)
            guard maxOut > 0 else { continue }

            var converted: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>? = nil
            guard av_samples_alloc_array_and_samples(
                &converted, nil,
                encoder!.pointee.ch_layout.nb_channels, maxOut, encoder!.pointee.sample_fmt, 0
            ) >= 0, let outBuf = converted else { continue }
            defer {
                av_freep(&outBuf[0])
                var freeing: UnsafeMutableRawPointer? = UnsafeMutableRawPointer(outBuf)
                av_freep(&freeing)
            }

            let produced = withUnsafePointer(to: &decodedFrame.pointee.data.0) { inData in
                swr_convert(swr, outBuf, maxOut, UnsafeRawPointer(inData).assumingMemoryBound(to: UnsafePointer<UInt8>?.self), decodedFrame.pointee.nb_samples)
            }
            guard produced > 0 else { continue }
            _ = av_audio_fifo_write(fifo, UnsafeMutableRawPointer(outBuf).assumingMemoryBound(to: UnsafeMutableRawPointer?.self), produced)

            drainFIFO(flush: false, emit: emit)
        }

        if packet == nil {
            // Flush: pad the tail out of the FIFO, then flush the encoder.
            drainFIFO(flush: true, emit: emit)
            encodeFrame(nil, emit: emit)
        }
    }

    /// Pull full-size frames out of the FIFO and encode them. `flush` also
    /// takes a final short frame.
    private func drainFIFO(flush: Bool, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let fifo, let encoder, let encFrame = encodeFrame else { return }
        let frameSize = encoder.pointee.frame_size > 0 ? encoder.pointee.frame_size : 1024

        while av_audio_fifo_size(fifo) >= (flush ? 1 : frameSize) {
            let take = min(frameSize, av_audio_fifo_size(fifo))
            guard av_frame_make_writable(encFrame) >= 0 else { return }
            encFrame.pointee.nb_samples = take
            _ = withUnsafeMutablePointer(to: &encFrame.pointee.data.0) { data in
                av_audio_fifo_read(fifo, UnsafeMutableRawPointer(data).assumingMemoryBound(to: UnsafeMutableRawPointer?.self), take)
            }

            // PTS from the encoder's own sample clock, never the input packet's.
            encFrame.pointee.pts = samplesEncoded
            samplesEncoded += Int64(take)

            encodeFrame(encFrame, emit: emit)
            if flush && av_audio_fifo_size(fifo) == 0 { break }
        }
    }

    private func encodeFrame(_ frame: UnsafeMutablePointer<AVFrame>?, emit: (UnsafeMutablePointer<AVPacket>) -> Void) {
        guard let encoder else { return }
        guard avcodec_send_frame(encoder, frame) >= 0 else { return }

        guard let out = av_packet_alloc() else { return }
        defer {
            var freeing: UnsafeMutablePointer<AVPacket>? = out
            av_packet_free(&freeing)
        }

        while true {
            let ret = avcodec_receive_packet(encoder, out)
            if ret == SWIFT_AVERROR_EAGAIN || ret == SWIFT_AVERROR_EOF { break }
            if ret < 0 { break }
            emit(out)
            av_packet_unref(out)
        }
    }
}
