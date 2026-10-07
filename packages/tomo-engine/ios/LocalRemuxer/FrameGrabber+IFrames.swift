//
//  FrameGrabber+IFrames.swift
//  TomoTV
//
//  The I-frame rendition's fragments, read through the grabber's own context: the keyframe
//  copied for an SDR source of at most 1080p, else decoded and encoded as SDR H.264 inside
//  1920x1080 (authoring spec 6.16 and Apple's own trick play ladders).
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
    /// The encoder's parameter sets the init carries: a fragment from an encoder with others is not used.
    var encoderExtradata: Data?
    /// The first encoded fragment's tone-map report has gone to the log.
    var toneMapLogged = false
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
    /// The encoded rendition's box, and the bit rates it aims at and never exceeds, at one frame a second.
    static let iframeMaxSize: (width: Int32, height: Int32) = (1920, 1080)
    static let iframeTargetBitrate = 1_000_000
    static let iframePeakBitrate = 2_000_000
    /// Codec of the encoded rendition: VideoTranscoder pins H.264 High 4.0 for SDR output.
    static let iframeEncodedCodecs = "avc1.640028"

    /// An encoder for one I-frame of the rendition at `bitrate`.
    static func iframeEncoder(_ stream: UnsafeMutablePointer<AVStream>, bitrate: Int) -> VideoTranscoder? {
        VideoTranscoder(inputStream: stream, keyframeInterval: 1, maxBitrate: Int64(bitrate), maxHeight: iframeMaxSize.height,
                        maxFrameRate: 1, hardwareDecode: DeviceDecode.canDecode(stream: stream), quiet: true,
                        maxWidth: iframeMaxSize.width, sdr: true)
    }

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

    /// The keyframe for entry `sequence - 1` as a styp-led fragment stamped at `stampSeconds` on the
    /// session timeline, lasting `sampleSeconds`. `exact` takes the keyframe at `sourceSeconds`; a grid
    /// entry takes the first the seek lands on, the keyframe at or before its time. An encoded
    /// fragment over `capBytes` is encoded again at lower rates.
    func iframeFragment(sourceSeconds: Double, exact: Bool, stampSeconds: Double, sampleSeconds: Double, sequence: Int,
                        capBytes: Int, transcode: Bool) -> Data? {
        queue.sync {
            guard !isCancelled, let track = iframeTrackOnQueue(transcode: transcode), let input,
                  let stream = input.pointee.streams[Int(videoIndex)] else { return nil }
            let started = Date()
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
            let read = Date().timeIntervalSince(started)
            let made = iframeFragment(packet, stream: stream, track: track, stampSeconds: stampSeconds, sampleSeconds: sampleSeconds,
                                      sequence: sequence, capBytes: capBytes)
            #if DEBUG
            NSLog("[IFrames] kf%ld %@ %ld bytes%@ in %.0f ms, read %.0f ms%@", sequence - 1, track.transcoded ? "encoded" : "copied",
                  made?.data.count ?? 0, track.transcoded ? " (cap \(capBytes))" : "", Date().timeIntervalSince(started) * 1000, read * 1000,
                  made?.note ?? " failed")
            #else
            _ = read
            #endif
            return made?.data
        }
    }

    private func iframeTrackOnQueue(transcode: Bool) -> IFrameTrack? {
        if let iframeTrack { return iframeTrack }
        guard !isCancelled, open(), let input, let stream = input.pointee.streams[Int(videoIndex)], let par = stream.pointee.codecpar else { return nil }
        if transcode {
            guard let transcoder = Self.iframeEncoder(stream, bitrate: Self.iframeTargetBitrate),
                  let params = transcoder.encoderParameters,
                  let built = iframeMux(params: params, timeBase: transcoder.encoderTimeBase, dolbyVision: false, extradata: nil, packet: nil) else { return nil }
            let track = IFrameTrack(initSegment: built.header, transcoded: true, timescale: built.timescale, dolbyVision: nil, liftedExtradata: nil)
            track.encoderExtradata = Self.extradata(params)
            iframeTrack = track
            return track
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

    /// The fragment and a note for the log: the encode's rate, retries and first tone-map report.
    private func iframeFragment(_ packet: UnsafeMutablePointer<AVPacket>, stream: UnsafeMutablePointer<AVStream>, track: IFrameTrack,
                                stampSeconds: Double, sampleSeconds: Double, sequence: Int, capBytes: Int) -> (data: Data, note: String)? {
        guard track.transcoded else {
            if let dolbyVision = track.dolbyVision, !dolbyVision.rewrite(packet: packet) { return nil }
            let built = iframeMux(params: stream.pointee.codecpar, timeBase: stream.pointee.time_base, dolbyVision: track.dolbyVision != nil,
                                  extradata: track.liftedExtradata, packet: packet)
            return finished(built, stampSeconds: stampSeconds, sampleSeconds: sampleSeconds, sequence: sequence).map { ($0, "") }
        }
        // The decoder places nothing before zero; the fragment is restamped after the mux.
        packet.pointee.pts = 0
        packet.pointee.dts = 0
        var note = ""
        var best: Data?
        for bitrate in [Self.iframeTargetBitrate, Self.iframeTargetBitrate / 2, Self.iframeTargetBitrate / 4] {
            guard let transcoder = Self.iframeEncoder(stream, bitrate: bitrate), let params = transcoder.encoderParameters else { break }
            // Slices name the init's parameter sets; an encoder that writes others cannot stand in.
            guard Self.extradata(params) == track.encoderExtradata else {
                note += ", parameter sets differ at \(bitrate) b/s"
                break
            }
            transcoder.forceKeyframeNext()
            var encoded: UnsafeMutablePointer<AVPacket>?
            let keep: (UnsafeMutablePointer<AVPacket>) -> Void = { if encoded == nil { encoded = av_packet_clone($0) } }
            transcoder.process(packet: packet, emit: keep)
            transcoder.process(packet: nil, emit: keep)
            if !track.toneMapLogged, let report = transcoder.toneMapReport {
                track.toneMapLogged = true
                note += ", transfer \(report)"
            }
            guard !transcoder.failed, let encoded else { break }
            var owned: UnsafeMutablePointer<AVPacket>? = encoded
            defer { av_packet_free(&owned) }
            guard let data = finished(iframeMux(params: params, timeBase: transcoder.encoderTimeBase, dolbyVision: false, extradata: nil, packet: encoded),
                                      stampSeconds: stampSeconds, sampleSeconds: sampleSeconds, sequence: sequence) else { break }
            note += ", \(data.count) bytes at \(bitrate) b/s"
            if best.map({ data.count < $0.count }) ?? true { best = data }
            if data.count <= capBytes { break }
        }
        return best.map { ($0, note) }
    }

    /// The muxed fragment from its first moof, stamped at `stampSeconds`, lasting `sampleSeconds`, numbered `sequence`.
    private func finished(_ built: (header: Data, fragment: Data?, timescale: AVRational)?, stampSeconds: Double, sampleSeconds: Double,
                          sequence: Int) -> Data? {
        guard let built, var body = built.fragment, let start = RemuxSession.firstFragmentOffset(in: body) else { return nil }
        if start > 0 { body = body.subdata(in: start..<body.count) }
        let stamp = Int64((stampSeconds / av_q2d(built.timescale)).rounded())
        if stamp != 0 { RemuxSession.patchTfdtToAbsolute(in: &body, offsets: [1: stamp]) }
        let ticks = UInt32(clamping: Int64((sampleSeconds / av_q2d(built.timescale)).rounded()))
        IFrameStore.patchFragment(&body, sequence: UInt32(clamping: sequence), sampleDuration: max(1, ticks))
        return RemuxSession.stypBox + body
    }

    /// The parameter sets an encoder or stream carries.
    static func extradata(_ params: UnsafeMutablePointer<AVCodecParameters>) -> Data? {
        guard let bytes = params.pointee.extradata, params.pointee.extradata_size > 0 else { return nil }
        return Data(bytes: bytes, count: Int(params.pointee.extradata_size))
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
