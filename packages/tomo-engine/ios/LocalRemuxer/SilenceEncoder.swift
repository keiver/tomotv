//
//  SilenceEncoder.swift
//  TomoTV
//
//  Silence in a copied AAC track's own format, for a track that ends before the picture: AVPlayer
//  ends an item with its audio, so the span up to the last frame has to carry some.
//

import Foundation
import Libavcodec
import Libavutil

enum SilenceEncoder {
    /// Encodes silence from `from` to `to` (output seconds) for a track copied with these parameters,
    /// handing over each packet with its time base (1/sample rate). AAC only: an AAC-LC frame at the
    /// track's rate and layout, or at the LC `core` an HE-AAC sample entry signals SBR over, decodes
    /// under the sample entry the muxer wrote from the source. The other copied codecs (AC-3, E-AC-3,
    /// ALAC, FLAC) get none: this build carries no AC-3 encoder, and ALAC and FLAC frames have to
    /// match their source's configuration.
    static func encode(like par: UnsafeMutablePointer<AVCodecParameters>, core: (sampleRate: Int32, channels: Int32)? = nil,
                       from: Double, to: Double, emit: (UnsafeMutablePointer<AVPacket>, AVRational) -> Void) {
        guard par.pointee.codec_id == AV_CODEC_ID_AAC, par.pointee.sample_rate > 0, to > from,
              let codec = avcodec_find_encoder(AV_CODEC_ID_AAC), let ctx = avcodec_alloc_context3(codec) else { return }
        var context: UnsafeMutablePointer<AVCodecContext>? = ctx
        defer { avcodec_free_context(&context) }

        let rate = core?.sampleRate ?? par.pointee.sample_rate
        if let core {
            av_channel_layout_default(&ctx.pointee.ch_layout, core.channels)
        } else if par.pointee.ch_layout.nb_channels > 0 {
            av_channel_layout_copy(&ctx.pointee.ch_layout, &par.pointee.ch_layout)
        } else {
            av_channel_layout_default(&ctx.pointee.ch_layout, 2)
        }
        ctx.pointee.sample_rate = rate
        ctx.pointee.sample_fmt = AV_SAMPLE_FMT_FLTP
        ctx.pointee.time_base = AVRational(num: 1, den: rate)
        ctx.pointee.bit_rate = Int64(ctx.pointee.ch_layout.nb_channels) * 32_000
        guard avcodec_open2(ctx, codec, nil) >= 0 else {
            NSLog("[SilenceEncoder] AAC encoder would not open at %d Hz, %d channels", rate, ctx.pointee.ch_layout.nb_channels)
            return
        }

        var frame = av_frame_alloc()
        var packet = av_packet_alloc()
        defer {
            av_frame_free(&frame)
            av_packet_free(&packet)
        }
        guard let frame, let packet else { return }
        let frameSize = ctx.pointee.frame_size > 0 ? ctx.pointee.frame_size : 1024
        frame.pointee.nb_samples = frameSize
        frame.pointee.format = ctx.pointee.sample_fmt.rawValue
        av_channel_layout_copy(&frame.pointee.ch_layout, &ctx.pointee.ch_layout)
        frame.pointee.sample_rate = rate
        guard av_frame_get_buffer(frame, 0) >= 0 else { return }
        av_samples_set_silence(&frame.pointee.extended_data.pointee, 0, frameSize, ctx.pointee.ch_layout.nb_channels, ctx.pointee.sample_fmt)

        let timeBase = ctx.pointee.time_base
        let start = Int64(from * Double(rate))
        let end = Int64(to * Double(rate))
        // The encoder's priming comes out ahead of `start`: behind audio already written, so dropped.
        func drain() {
            while avcodec_receive_packet(ctx, packet) >= 0 {
                if packet.pointee.pts >= start { emit(packet, timeBase) }
                av_packet_unref(packet)
            }
        }
        var pts = start
        while pts < end {
            frame.pointee.nb_samples = Int32(min(Int64(frameSize), end - pts))
            frame.pointee.pts = pts
            guard avcodec_send_frame(ctx, frame) >= 0 else { break }
            drain()
            pts += Int64(frame.pointee.nb_samples)
        }
        if avcodec_send_frame(ctx, nil) >= 0 { drain() }
    }
}
