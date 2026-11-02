//
//  LiveLateAudio.swift
//  TomoTV
//
//  An audio stream a bounded live TS probe ended before, described from its own first packets.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)

enum LiveLateAudio {
    /// Video read from the stream's first packet before the undescribed streams are given up; the probe's packets are read again.
    static let readOnVideoSeconds = 6.0
    /// Video read for the other undescribed streams once one is described: a declared track that never carries a packet ends it.
    static let afterFirstDescribedSeconds = 1.0
    static let readOnPacketLimit = 4096
    /// A source whose video carries no timestamps is bounded by the clock instead.
    static let readOnWallSeconds = 8.0

    struct Outcome {
        let packets: Int
        let videoSeconds: Double
        let described: [Int32]
    }

    /// The streams to read on for: every undescribed one when the probe described none, else none.
    static func streamsToReadOn(_ audio: [(index: Int32, described: Bool)]) -> [Int32] {
        audio.contains { $0.described } ? [] : audio.map { $0.index }
    }

    /// Reads packets, each handed to `keep` in order, until every stream in `streams` is described, one is and
    /// `afterFirstDescribedSeconds` of video followed, or the bounds run out.
    static func readOn(_ input: UnsafeMutablePointer<AVFormatContext>, for streams: [Int32], videoIn: Int32,
                       keep: (UnsafeMutablePointer<AVPacket>) -> Void) -> Outcome {
        var describers: [Int32: Describer] = [:]
        for index in streams {
            if let stream = input.pointee.streams[Int(index)], let describer = Describer(stream) { describers[index] = describer }
        }
        var described: [Int32] = []
        var packets = 0
        var firstVideo: Double?
        var videoSeconds = 0.0
        var describedAt: Double?
        let started = Date()
        while !describers.isEmpty, packets < readOnPacketLimit, Date().timeIntervalSince(started) < readOnWallSeconds {
            guard let pkt = av_packet_alloc() else { break }
            guard av_read_frame(input, pkt) >= 0 else {
                var freeing: UnsafeMutablePointer<AVPacket>? = pkt
                av_packet_free(&freeing)
                break
            }
            keep(pkt)
            packets += 1
            let index = pkt.pointee.stream_index
            if index == videoIn, pkt.pointee.dts != SWIFT_AV_NOPTS_VALUE, let stream = input.pointee.streams[Int(index)] {
                let seconds = Double(pkt.pointee.dts) * av_q2d(stream.pointee.time_base)
                if firstVideo == nil { firstVideo = seconds }
                videoSeconds = max(videoSeconds, seconds - (firstVideo ?? seconds))
            }
            if let describer = describers[index], let stream = input.pointee.streams[Int(index)], describer.describe(pkt, into: stream) {
                described.append(index)
                describers[index] = nil
                if describedAt == nil { describedAt = videoSeconds }
            }
            if videoSeconds >= readOnVideoSeconds { break }
            if let at = describedAt, videoSeconds - at >= afterFirstDescribedSeconds { break }
        }
        return Outcome(packets: packets, videoSeconds: videoSeconds, described: described)
    }

    /// The stream's decoder, fed its packets until one decodes to a frame.
    final class Describer {
        private var context: UnsafeMutablePointer<AVCodecContext>?

        init?(_ stream: UnsafeMutablePointer<AVStream>) {
            guard let par = stream.pointee.codecpar, let codec = avcodec_find_decoder(par.pointee.codec_id),
                  let context = avcodec_alloc_context3(codec) else { return nil }
            self.context = context
            guard avcodec_parameters_to_context(context, par) >= 0, avcodec_open2(context, codec, nil) >= 0 else { return nil }
        }

        deinit {
            avcodec_free_context(&context)
        }

        /// Writes the first decoded frame's rate, layout, sample format and frame size to the stream's parameters.
        func describe(_ packet: UnsafeMutablePointer<AVPacket>, into stream: UnsafeMutablePointer<AVStream>) -> Bool {
            guard let context, let par = stream.pointee.codecpar, avcodec_send_packet(context, packet) >= 0,
                  let frame = av_frame_alloc() else { return false }
            defer {
                var freeing: UnsafeMutablePointer<AVFrame>? = frame
                av_frame_free(&freeing)
            }
            guard avcodec_receive_frame(context, frame) >= 0, frame.pointee.sample_rate > 0, frame.pointee.ch_layout.nb_channels > 0 else { return false }
            par.pointee.sample_rate = frame.pointee.sample_rate
            guard av_channel_layout_copy(&par.pointee.ch_layout, &frame.pointee.ch_layout) >= 0 else { return false }
            par.pointee.format = frame.pointee.format
            par.pointee.frame_size = frame.pointee.nb_samples
            if par.pointee.profile < 0, context.pointee.profile >= 0 { par.pointee.profile = context.pointee.profile }
            return true
        }
    }
}
