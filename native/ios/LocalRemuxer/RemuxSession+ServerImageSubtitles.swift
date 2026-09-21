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
private let SWIFT_AVERROR_EOF: Int32 = -541_478_725 // FFERRTAG('E','O','F',' ')

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

    static func serverImageRetryDelay(attempt: Int) -> Double {
        Double(min(15, max(1, attempt))) * 2
    }

    func reportUnavailableServerImageSubtitle(_ track: RemuxSubtitle, reason: String) {
        stateLock.lock()
        guard !failed, !cancelled else { return stateLock.unlock() }
        failed = true
        stateLock.unlock()
        let message = "server image subtitle \(track.index) unavailable: \(reason)"
        NSLog("[LocalRemuxer] %@", message)
        onFailed?(["token": token, "message": message, "streamIndex": track.index])
    }

    /// A stream that did not open or broke off is read again from its start: nothing else will
    /// ever serve these cues. The wait grows with each try and ends with the session.
    private func readServerImageSubtitles(_ track: RemuxSubtitle) {
        var attempt = 1
        while !isCancelled, !hasFailed {
            if readServerImageSubtitlesOnce(track) { return }
            let over = waitUntil(deadline: Self.serverImageRetryDelay(attempt: attempt)) { [weak self] in self.map { $0.isCancelled || $0.hasFailed } ?? true }
            if over { return }
            attempt = min(15, attempt + 1)
        }
    }

    /// Jellyfin extracts with `-c:s copy` and no `-copyts`, so the cues count from the file's
    /// start, as the session does. Its answer waits on the extraction, which reads the whole file.
    /// True when there is nothing left to try: read to its end, the session over, or a stream no try will decode.
    private func readServerImageSubtitlesOnce(_ track: RemuxSubtitle) -> Bool {
        var ctx: UnsafeMutablePointer<AVFormatContext>? = avformat_alloc_context()
        guard ctx != nil else { return false }
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
            return isCancelled || hasFailed
        }
        defer { avformat_close_input(&ctx) }
        func subtitleStream() -> UnsafeMutablePointer<AVStream>? {
            (0..<Int(input.pointee.nb_streams)).compactMap { input.pointee.streams[$0] }.first {
                $0.pointee.codecpar.pointee.codec_type == AVMEDIA_TYPE_SUBTITLE
            }
        }
        if subtitleStream() == nil || subtitleStream()?.pointee.codecpar.pointee.codec_id == AV_CODEC_ID_NONE {
            guard avformat_find_stream_info(input, nil) >= 0 else {
                NSLog("[LocalRemuxer] server subtitle stream %d could not be probed, will retry", track.index)
                return isCancelled || hasFailed
            }
        }
        guard let stream = subtitleStream() else {
            reportUnavailableServerImageSubtitle(track, reason: "the response contains no subtitle stream")
            return true
        }
        let codec = stream.pointee.codecpar.pointee.codec_id
        guard codec != AV_CODEC_ID_NONE else { return false }
        guard ImageSubtitleDecoder.handles(codec), avcodec_find_decoder(codec) != nil else {
            reportUnavailableServerImageSubtitle(track, reason: "unsupported codec \(codec.rawValue)")
            return true
        }
        stateLock.lock()
        let previous = serverImageSubtitles[Int32(track.index)]
        let previousReadUpTo = serverImageReadUpTo[Int32(track.index)] ?? 0
        stateLock.unlock()
        let namePrefix = previous == nil ? "pgs\(track.index)s" : "pgs\(track.index)s-\(UUID().uuidString)"
        guard let decoder = ImageSubtitleDecoder(stream: stream, fallbackWidth: config.width, fallbackHeight: config.height, dir: dir,
                                                 reportedIndex: Int32(track.index), namePrefix: namePrefix) else {
            NSLog("[LocalRemuxer] server subtitle stream %d decoder initialization failed, will retry", track.index)
            return isCancelled || hasFailed
        }
        var packet = av_packet_alloc()
        guard packet != nil else { return false }
        defer { av_packet_free(&packet) }
        if previous == nil {
            stateLock.lock()
            serverImageSubtitles[Int32(track.index)] = decoder
            serverImageReadUpTo[Int32(track.index)] = 0
            stateLock.unlock()
        }
        let timeBase = av_q2d(stream.pointee.time_base)
        var readUpTo = 0.0
        var read = av_read_frame(input, packet)
        while read >= 0 {
            if isCancelled { return true }
            if packet!.pointee.stream_index != stream.pointee.index {
                av_packet_unref(packet)
                read = av_read_frame(input, packet)
                continue
            }
            if packet!.pointee.pts != SWIFT_AV_NOPTS_VALUE {
                readUpTo = max(readUpTo, Double(packet!.pointee.pts) * timeBase)
            }
            decoder.handle(packet: packet!)
            if readUpTo >= previousReadUpTo {
                stateLock.lock()
                serverImageSubtitles[Int32(track.index)] = decoder
                serverImageReadUpTo[Int32(track.index)] = readUpTo
                stateLock.unlock()
            }
            av_packet_unref(packet)
            read = av_read_frame(input, packet)
        }
        // Only the end of the stream completes the track: a read that broke off holds some of the cues.
        guard read == SWIFT_AVERROR_EOF else {
            NSLog("[LocalRemuxer] server subtitle stream %d broke off mid-read", track.index)
            return isCancelled || hasFailed
        }
        decoder.finish(at: config.durationSeconds)
        stateLock.lock()
        serverImageSubtitles[Int32(track.index)] = decoder
        serverImageReadUpTo[Int32(track.index)] = config.durationSeconds
        stateLock.unlock()
        NSLog("[LocalRemuxer] server subtitle stream %d read to its end", track.index)
        return true
    }
}
