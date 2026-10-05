//
//  FrameGrabber+IFrames.swift
//  TomoTV
//
//  The I-frame rendition's fragments, read through the grabber's own context: the keyframe
//  copied when playback copies the video, else decoded and re-encoded the way the transcode
//  lane encodes it, so the rendition and the playing track share codec and size.
//

import Foundation
import Libavcodec
import Libavformat
import Libavutil

private let SWIFT_AV_NOPTS_VALUE = Int64(bitPattern: 0x8000_0000_0000_0000)
private let SWIFT_AVSEEK_FLAG_BACKWARD: Int32 = 1
private let SWIFT_AVSEEK_FLAG_BYTE: Int32 = 2

/// What every I-frame fragment of a session decodes against.
final class IFrameTrack {
    let initSegment: Data
    let transcoded: Bool
    /// The track timescale movenc picked, which tfdt is counted in.
    let timescale: AVRational
    /// Profile 7 packets are restated as 8.1, as the copy restates them.
    let dolbyVision: DolbyVisionConverter?
    /// Parameter sets lifted from a keyframe when the demuxer gave none (Annex-B TS).
    let liftedExtradata: Data?

    init(initSegment: Data, transcoded: Bool, timescale: AVRational, dolbyVision: DolbyVisionConverter?, liftedExtradata: Data?) {
        self.initSegment = initSegment
        self.transcoded = transcoded
        self.timescale = timescale
        self.dolbyVision = dolbyVision
        self.liftedExtradata = liftedExtradata
    }
}

extension FrameGrabber {
    /// Packets read past a seek before a fragment gives up: an index can land a GOP early.
    static let iframePacketBudget = 4000
    static let iframeDeadline: TimeInterval = 10
    /// A grid entry's keyframe may sit this far past its time and still stand for it.
    static let gridTolerance = 0.5

    /// The rendition's init segment, built on the first request.
    func iframeInit(transcode: Bool) -> IFrameTrack? {
        queue.sync { iframeTrackOnQueue(transcode: transcode) }
    }

    /// The source's own timeline, for a rendition no remux session anchors: where it starts, its
    /// keyframe index where the container keeps one, and a byte map where it is an unindexed TS.
    func iframeTimeline() -> (startSeconds: Double, index: KeyframeIndex?)? {
        queue.sync {
            guard !isCancelled, open(), let input else { return nil }
            if byteMap == nil { byteMap = ByteTimeMap.forInput(input) }
            let start = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : Double(input.pointee.start_time) / 1_000_000
            return (start, KeyframeIndex.read(input: input, streamIndex: videoIndex))
        }
    }

    /// The keyframe for an entry as a styp-led fragment stamped at `stampSeconds` on the session
    /// timeline. `exact` takes the keyframe at `sourceSeconds`; a grid entry takes the first the
    /// seek lands on, the keyframe at or before its time.
    func iframeFragment(sourceSeconds: Double, exact: Bool, stampSeconds: Double, transcode: Bool) -> Data? {
        queue.sync {
            guard !isCancelled, let track = iframeTrackOnQueue(transcode: transcode), let input,
                  let stream = input.pointee.streams[Int(videoIndex)] else { return nil }
            let target = Int64((sourceSeconds / av_q2d(stream.pointee.time_base)).rounded())
            let found: UnsafeMutablePointer<AVPacket>?
            if !exact, let byteMap {
                found = readByEstimate(input: input, stream: stream, sourceSeconds: sourceSeconds, map: byteMap)
            } else if avformat_seek_file(input, videoIndex, Int64.min, target, target, SWIFT_AVSEEK_FLAG_BACKWARD) >= 0 {
                found = readIFrameKeyframe(input: input, stream: stream, atOrAfter: exact ? target : nil)
            } else {
                found = nil
            }
            guard let packet = found else { return nil }
            var owned: UnsafeMutablePointer<AVPacket>? = packet
            defer { av_packet_free(&owned) }
            return iframeFragment(packet, stream: stream, track: track, stampSeconds: stampSeconds)
        }
    }

    private func iframeTrackOnQueue(transcode: Bool) -> IFrameTrack? {
        if let iframeTrack { return iframeTrack }
        guard !isCancelled, open(), let input, let stream = input.pointee.streams[Int(videoIndex)], let par = stream.pointee.codecpar else { return nil }
        if transcode {
            guard let transcoder = VideoTranscoder(inputStream: stream, keyframeInterval: 1, quiet: true),
                  let params = transcoder.encoderParameters,
                  let built = iframeMux(params: params, timeBase: transcoder.encoderTimeBase, dolbyVision: false, extradata: nil, packet: nil) else { return nil }
            iframeTrack = IFrameTrack(initSegment: built.header, transcoded: true, timescale: built.timescale, dolbyVision: nil, liftedExtradata: nil)
            return iframeTrack
        }
        // An Annex-B source (TS) carries its parameter sets on keyframes, not in the stream header.
        var lifted: Data?
        let codec = par.pointee.codec_id
        if par.pointee.extradata_size == 0, codec == AV_CODEC_ID_H264 || codec == AV_CODEC_ID_HEVC {
            // To the first byte: a timestamp seek on an unindexed TS is a search over the wire.
            let start = input.pointee.start_time == SWIFT_AV_NOPTS_VALUE ? 0 : input.pointee.start_time
            guard avformat_seek_file(input, -1, Int64.min, 0, 0, SWIFT_AVSEEK_FLAG_BYTE) >= 0
                || avformat_seek_file(input, -1, Int64.min, start, start, SWIFT_AVSEEK_FLAG_BACKWARD) >= 0 else { return nil }
            guard let key = readIFrameKeyframe(input: input, stream: stream, atOrAfter: nil) else { return nil }
            var owned: UnsafeMutablePointer<AVPacket>? = key
            defer { av_packet_free(&owned) }
            lifted = TierRewrapper.annexBParameterSets(key, hevc: codec == AV_CODEC_ID_HEVC)
            guard lifted != nil else { return nil }
        }
        var dolbyVision: DolbyVisionConverter?
        if let record = DolbyVisionConverter.configuration(par), record.dv_profile == 7, record.rpu_present_flag == 1 {
            guard let converter = DolbyVisionConverter(inputStream: stream) else { return nil }
            dolbyVision = converter
        }
        guard let built = iframeMux(params: par, timeBase: stream.pointee.time_base, dolbyVision: dolbyVision != nil, extradata: lifted, packet: nil) else { return nil }
        iframeTrack = IFrameTrack(initSegment: built.header, transcoded: false, timescale: built.timescale, dolbyVision: dolbyVision, liftedExtradata: lifted)
        return iframeTrack
    }

    /// A grid entry's keyframe off an MPEG-TS input with no index: a byte seek on the shared map, again
    /// on the sharpened map while it lands past the entry or a grid step before it. Every landing is
    /// a point the pipeline's next seek uses too.
    private func readByEstimate(input: UnsafeMutablePointer<AVFormatContext>, stream: UnsafeMutablePointer<AVStream>,
                                sourceSeconds: Double, map: ByteTimeMap) -> UnsafeMutablePointer<AVPacket>? {
        let timeBase = av_q2d(stream.pointee.time_base)
        var best: UnsafeMutablePointer<AVPacket>?
        for tries in 1...RemuxSession.byteSeekTries {
            guard let pos = map.position(forSeconds: sourceSeconds - RemuxSession.byteSeekLead * Double(tries)),
                  avformat_seek_file(input, -1, Int64.min, pos, pos, SWIFT_AVSEEK_FLAG_BYTE) >= 0,
                  let key = readIFrameKeyframe(input: input, stream: stream, atOrAfter: nil) else { break }
            let time = key.pointee.pts != SWIFT_AV_NOPTS_VALUE ? key.pointee.pts : key.pointee.dts
            let seconds = Double(time) * timeBase
            map.record(pos: key.pointee.pos, seconds: seconds)
            av_packet_free(&best)
            best = key
            if seconds <= sourceSeconds + Self.gridTolerance, seconds >= sourceSeconds - RemuxSession.segmentDuration { break }
        }
        return best
    }

    /// The first video keyframe read, at or after `atOrAfter` when given, within the budgets.
    private func readIFrameKeyframe(input: UnsafeMutablePointer<AVFormatContext>, stream: UnsafeMutablePointer<AVStream>,
                                    atOrAfter target: Int64?) -> UnsafeMutablePointer<AVPacket>? {
        guard let pkt = av_packet_alloc() else { return nil }
        let started = Date()
        var packets = 0
        while packets < Self.iframePacketBudget, Date().timeIntervalSince(started) < Self.iframeDeadline, !isCancelled {
            guard readPacket(input, pkt) >= 0 else { break }
            packets += 1
            let time = pkt.pointee.pts != SWIFT_AV_NOPTS_VALUE ? pkt.pointee.pts : pkt.pointee.dts
            if pkt.pointee.stream_index == videoIndex, pkt.pointee.flags & SWIFT_AV_PKT_FLAG_KEY != 0, time != SWIFT_AV_NOPTS_VALUE,
               target.map({ time >= $0 }) ?? true {
                return pkt
            }
            av_packet_unref(pkt)
        }
        var freeing: UnsafeMutablePointer<AVPacket>? = pkt
        av_packet_free(&freeing)
        return nil
    }

    private func iframeFragment(_ packet: UnsafeMutablePointer<AVPacket>, stream: UnsafeMutablePointer<AVStream>,
                                track: IFrameTrack, stampSeconds: Double) -> Data? {
        let built: (header: Data, fragment: Data?, timescale: AVRational)?
        if track.transcoded {
            guard let transcoder = VideoTranscoder(inputStream: stream, keyframeInterval: 1, quiet: true),
                  let params = transcoder.encoderParameters else { return nil }
            // The decoder places nothing before zero; the fragment is restamped after the mux.
            packet.pointee.pts = 0
            packet.pointee.dts = 0
            transcoder.forceKeyframeNext()
            var encoded: UnsafeMutablePointer<AVPacket>?
            let keep: (UnsafeMutablePointer<AVPacket>) -> Void = { if encoded == nil { encoded = av_packet_clone($0) } }
            transcoder.process(packet: packet, emit: keep)
            transcoder.process(packet: nil, emit: keep)
            guard !transcoder.failed, let encoded else { return nil }
            var owned: UnsafeMutablePointer<AVPacket>? = encoded
            defer { av_packet_free(&owned) }
            built = iframeMux(params: params, timeBase: transcoder.encoderTimeBase, dolbyVision: false, extradata: nil, packet: encoded)
        } else {
            if let dolbyVision = track.dolbyVision, !dolbyVision.rewrite(packet: packet) { return nil }
            built = iframeMux(params: stream.pointee.codecpar, timeBase: stream.pointee.time_base, dolbyVision: track.dolbyVision != nil,
                              extradata: track.liftedExtradata, packet: packet)
        }
        guard let built, var body = built.fragment, let start = RemuxSession.firstFragmentOffset(in: body) else { return nil }
        if start > 0 { body = body.subdata(in: start..<body.count) }
        let stamp = Int64((stampSeconds / av_q2d(built.timescale)).rounded())
        if stamp != 0 { RemuxSession.patchTfdtToAbsolute(in: &body, offsets: [1: stamp]) }
        return RemuxSession.stypBox + body
    }

    private final class Sink {
        var data = Data()
    }

    private static let iframeWrite: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int32) -> Int32 = { opaque, buf, size in
        guard let opaque, let buf, size > 0 else { return size }
        Unmanaged<Sink>.fromOpaque(opaque).takeUnretainedValue().data.append(buf, count: Int(size))
        return size
    }

    /// One video track through movenc the way the pipeline builds its own: the header alone, or the
    /// header then `packet` alone at decode time zero, its fragment cut by an explicit flush.
    private func iframeMux(params: UnsafeMutablePointer<AVCodecParameters>, timeBase: AVRational, dolbyVision: Bool, extradata: Data?,
                           packet: UnsafeMutablePointer<AVPacket>?) -> (header: Data, fragment: Data?, timescale: AVRational)? {
        var outputCtx: UnsafeMutablePointer<AVFormatContext>? = nil
        guard avformat_alloc_output_context2(&outputCtx, nil, "mp4", nil) >= 0, let output = outputCtx else { return nil }
        defer { avformat_free_context(output) }
        // The Dolby Vision record rides the copied track, which movenc writes only at this level.
        output.pointee.strict_std_compliance = FF_COMPLIANCE_UNOFFICIAL
        let sink = Sink()
        let ioBufSize = 1 << 16
        guard let ioBuf = av_malloc(ioBufSize) else { return nil }
        guard let avio = avio_alloc_context(ioBuf.assumingMemoryBound(to: UInt8.self), Int32(ioBufSize), 1,
                                            Unmanaged.passUnretained(sink).toOpaque(), nil, Self.iframeWrite, nil) else {
            av_free(ioBuf)
            return nil
        }
        defer {
            av_free(avio.pointee.buffer)
            var freeing: UnsafeMutablePointer<AVIOContext>? = avio
            avio_context_free(&freeing)
        }
        output.pointee.pb = avio
        guard let outStream = avformat_new_stream(output, nil), let outPar = outStream.pointee.codecpar,
              avcodec_parameters_copy(outPar, params) >= 0 else { return nil }
        if let extradata, let buf = av_mallocz(extradata.count + SWIFT_AV_INPUT_BUFFER_PADDING_SIZE) {
            extradata.withUnsafeBytes { raw in buf.copyMemory(from: raw.baseAddress!, byteCount: extradata.count) }
            av_freep(&outPar.pointee.extradata)
            outPar.pointee.extradata = buf.assumingMemoryBound(to: UInt8.self)
            outPar.pointee.extradata_size = Int32(extradata.count)
        }
        outStream.pointee.time_base = timeBase
        outPar.pointee.codec_tag = RemuxSession.mp4VideoTag(outPar.pointee.codec_id)
        if dolbyVision { DolbyVisionConverter.rewriteConfiguration(outPar) }
        var muxOpts: OpaquePointer? = nil
        av_dict_set(&muxOpts, "movflags", "empty_moov+default_base_moof+frag_custom", 0)
        let written = avformat_write_header(output, &muxOpts)
        av_dict_free(&muxOpts)
        guard written >= 0 else { return nil }
        avio_flush(avio)
        let header = sink.data
        let timescale = outStream.pointee.time_base
        guard let packet else { return (header, nil, timescale) }
        sink.data = Data()
        guard let copy = av_packet_clone(packet) else { return nil }
        var owned: UnsafeMutablePointer<AVPacket>? = copy
        defer { av_packet_free(&owned) }
        copy.pointee.duration = max(1, av_rescale_q(1, AVRational(num: 1, den: 1), timescale))
        copy.pointee.pts = 0
        copy.pointee.dts = 0
        copy.pointee.stream_index = 0
        copy.pointee.pos = -1
        guard av_write_frame(output, copy) >= 0, av_write_frame(output, nil) >= 0 else { return nil }
        avio_flush(avio)
        return (header, sink.data, timescale)
    }
}
