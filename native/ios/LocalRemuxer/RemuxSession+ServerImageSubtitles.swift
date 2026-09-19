//
//  RemuxSession+ServerImageSubtitles.swift
//  TomoTV
//
//  PGS and DVD cues when the source is not being read: the server's raw copy of the track,
//  decoded here and drawn by the app like any other image subtitle.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

// FFmpeg's constant macros don't survive the Clang importer.
private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)

extension RemuxSession {
    /// Starts one reader per image track that names a server stream. Once a session, and only when
    /// the demuxer is not feeding them: the source let go, lost, or held under a rung. A session
    /// that reads its source never makes the server extract anything.
    func startServerImageSubtitles() {
        stateLock.lock()
        let first = !serverImageSubtitlesStarted
        serverImageSubtitlesStarted = true
        stateLock.unlock()
        guard first else { return }
        for track in config.subtitles where track.isImage && !track.serverSupUrl.isEmpty {
            let thread = Thread { self.readServerImageSubtitles(track) }
            thread.name = "tv.tomo.localremux.sup"
            thread.qualityOfService = .utility
            thread.start()
        }
    }

    /// Jellyfin extracts with `-c:s copy` and no `-copyts`, so the cues count from the file's
    /// start, as the session does. Its answer waits on the extraction, which reads the whole file.
    private func readServerImageSubtitles(_ track: RemuxSubtitle) {
        var ctx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard ctx != nil else { return }
        ctx!.pointee.interrupt_callback = AVIOInterruptCB(callback: Self.interruptCallback, opaque: Unmanaged.passUnretained(self).toOpaque())
        var opts: OpaquePointer? = nil
        av_dict_set(&opts, "rw_timeout", "600000000", 0)
        av_dict_set(&opts, "tls_verify", "0", 0)
        // A PGS stream is named, not probed: its URL ends in .pgssub, which no demuxer claims. A DVD
        // track arrives in Matroska, which is found by its content.
        let isPgs = URL(string: track.serverSupUrl)?.pathExtension == "pgssub"
        let opened = avformat_open_input(&ctx, track.serverSupUrl, isPgs ? av_find_input_format("sup") : nil, &opts)
        av_dict_free(&opts)
        guard opened >= 0, let input = ctx else {
            NSLog("[LocalRemuxer] server subtitle stream %d did not open", track.index)
            return
        }
        defer { avformat_close_input(&ctx) }
        guard input.pointee.nb_streams > 0, let stream = input.pointee.streams[0],
              let decoder = ImageSubtitleDecoder(stream: stream, fallbackWidth: config.width, fallbackHeight: config.height, dir: dir,
                                                 reportedIndex: Int32(track.index), namePrefix: "pgs\(track.index)s"),
              var packet = Optional(av_packet_alloc()), packet != nil else { return }
        defer { av_packet_free(&packet) }
        stateLock.lock()
        serverImageSubtitles[Int32(track.index)] = decoder
        stateLock.unlock()
        let timeBase = av_q2d(stream.pointee.time_base)
        while av_read_frame(input, packet) >= 0 {
            if isCancelled { return }
            if packet!.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                stateLock.lock()
                serverImageReadUpTo[Int32(track.index)] = Double(packet!.pointee.pts) * timeBase
                stateLock.unlock()
            }
            decoder.handle(packet: packet!)
            av_packet_unref(packet)
        }
        decoder.finish(at: config.durationSeconds)
        NSLog("[LocalRemuxer] server subtitle stream %d read to its end", track.index)
    }
}
