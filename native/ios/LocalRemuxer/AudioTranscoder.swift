//
//  AudioTranscoder.swift
//  TomoTV
//
//  Decodes one audio stream and re-encodes it as AAC, so audio AVPlayer cannot
//  play (AC3, EAC3, DTS, TrueHD, Opus, Vorbis, FLAC, PCM) still rides through
//  the local remux pipeline. Video is never touched: it keeps stream-copying,
//  which is the whole point of the engine.
//
//  Encoding is attempted with `aac_at` first — Apple's AudioToolbox encoder,
//  which runs on dedicated silicon — and falls back to FFmpeg's native `aac`.
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

    /// Codecs that go through untouched. Everything else is transcoded.
    ///
    /// MP3 is deliberately NOT copied: Apple's HLS spec allows MP3 only in
    /// MPEG-TS segments, and AVPlayer refuses an fMP4 stream whose audio
    /// sample entry is .mp3 with a bare "Cannot Open" (found by the macOS
    /// harness on an Xvid+MP3 AVI; the same file plays once the audio is AAC).
    static func needsTranscode(codecId: AVCodecID) -> Bool {
        switch codecId {
        case AV_CODEC_ID_AAC, AV_CODEC_ID_ALAC:
            return false
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
    /// - Parameter maxChannels: 6 keeps 5.1 when the encoder supports it; the
    ///   source layout is preserved when it fits, otherwise downmixed.
    init?(inputStream: UnsafeMutablePointer<AVStream>, bitrate: Int64 = 192_000, maxChannels: Int32 = 6) {
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

        // AudioToolbox first, FFmpeg's own AAC as backup.
        let encoderCodec = avcodec_find_encoder_by_name("aac_at") ?? avcodec_find_encoder(AV_CODEC_ID_AAC)
        guard let encCodec = encoderCodec, let encCtx = avcodec_alloc_context3(encCodec) else {
            NSLog("[AudioTranscoder] No AAC encoder available")
            return nil
        }
        encoder = encCtx

        let sourceChannels = decCtx.pointee.ch_layout.nb_channels
        let targetChannels = min(sourceChannels > 0 ? sourceChannels : 2, maxChannels)
        av_channel_layout_default(&encCtx.pointee.ch_layout, targetChannels)
        encCtx.pointee.sample_rate = decCtx.pointee.sample_rate > 0 ? decCtx.pointee.sample_rate : 48000
        encCtx.pointee.sample_fmt = encCodec.pointee.sample_fmts?.pointee ?? AV_SAMPLE_FMT_FLTP
        encCtx.pointee.bit_rate = bitrate
        encCtx.pointee.time_base = AVRational(num: 1, den: encCtx.pointee.sample_rate)
        // The muxer writes a global header (moov) up front, so the encoder must
        // put its config in extradata rather than inline.
        encCtx.pointee.flags |= AV_CODEC_FLAG_GLOBAL_HEADER

        if avcodec_open2(encCtx, encCodec, nil) < 0 {
            NSLog("[AudioTranscoder] Failed to open AAC encoder")
            return nil
        }

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
        guard let queue = av_audio_fifo_alloc(encCtx.pointee.sample_fmt, targetChannels, 1) else {
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
