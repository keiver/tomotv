import Accelerate
import Foundation
import Libavcodec
import Libavformat
import Libavutil
import Libswresample

/// The loudness of every 10 ms of a source's audio, in source time, for the stretches decoded so far.
/// A level is `10 * log10(mean square + 1)` on the 16-bit scale; a frame never decoded is NaN.
final class SpeechLevels {
    static let framesPerSecond = 100
    private static let chunkFrames = 1000
    private let lock = NSLock()
    private var chunks: [Int: [Float]] = [:]

    func record(_ levels: [Float], from index: Int) {
        guard !levels.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        for (offset, level) in levels.enumerated() {
            let frame = index + offset
            guard frame >= 0 else { continue }
            let chunk = frame / Self.chunkFrames
            if chunks[chunk] == nil { chunks[chunk] = [Float](repeating: .nan, count: Self.chunkFrames) }
            chunks[chunk]![frame % Self.chunkFrames] = level
        }
    }

    /// The levels between two source times, NaN where nothing was decoded.
    func levels(from: Double, to: Double) -> [Float] {
        let first = max(0, Int((from * Double(Self.framesPerSecond)).rounded()))
        let count = max(0, Int((to * Double(Self.framesPerSecond)).rounded()) - first)
        lock.lock()
        defer { lock.unlock() }
        return (0..<count).map { offset in
            let frame = first + offset
            return chunks[frame / Self.chunkFrames]?[frame % Self.chunkFrames] ?? .nan
        }
    }

    /// The stretch around `time` decoded without a hole longer than `maxGapSeconds`. Nil when nothing within `maxGapSeconds` of `time` was decoded.
    func span(containing time: Double, maxGapSeconds: Double = 1) -> ClosedRange<Double>? {
        let rate = Double(Self.framesPerSecond)
        let maxGap = Int(maxGapSeconds * rate)
        lock.lock()
        defer { lock.unlock() }
        func known(_ frame: Int) -> Bool {
            guard frame >= 0, let level = chunks[frame / Self.chunkFrames]?[frame % Self.chunkFrames] else { return false }
            return !level.isNaN
        }
        func reach(from start: Int, step: Int) -> Int {
            var last = start
            var frame = start + step
            while abs(frame - last) <= maxGap + 1 {
                if known(frame) { last = frame }
                frame += step
            }
            return last
        }
        let centre = Int((time * rate).rounded())
        guard let seed = (0...maxGap).lazy.flatMap({ [centre - $0, centre + $0] }).first(where: known) else { return nil }
        return Double(reach(from: seed, step: -1)) / rate...Double(reach(from: seed, step: 1) + 1) / rate
    }
}

/// Decodes one audio stream's packets as the session reads them, on a queue of its own, into
/// `SpeechLevels`: the centre channel of a surround mix, every other layout mixed to mono.
final class SpeechLevelReader {
    let streamIndex: Int32
    private let levels: SpeechLevels
    private let queue = DispatchQueue(label: "tomo.speech-levels", qos: .utility)
    private let timeBase: Double
    private var decoder: UnsafeMutablePointer<AVCodecContext>?
    private var resampler: OpaquePointer?
    private var frame: UnsafeMutablePointer<AVFrame>?
    private let keep: Int
    private let outChannels: Int
    private let frameLength: Int
    private let sampleRate: Int
    private var pending: [Float] = []
    private var pendingIndex: Int?
    private let backlogLock = NSLock()
    private var backlog = 0
    private(set) var dropped = 0
    /// Packets waiting past this many are dropped: a hole in the levels, never a stall in the read loop.
    private static let maxBacklog = 400

    init?(stream: UnsafeMutablePointer<AVStream>, index: Int32, into levels: SpeechLevels) {
        guard let params = stream.pointee.codecpar, params.pointee.codec_type == AVMEDIA_TYPE_AUDIO,
              let codec = avcodec_find_decoder(params.pointee.codec_id),
              let context = avcodec_alloc_context3(codec) else { return nil }
        decoder = context
        streamIndex = index
        self.levels = levels
        timeBase = av_q2d(stream.pointee.time_base)
        guard avcodec_parameters_to_context(context, params) >= 0, avcodec_open2(context, codec, nil) >= 0 else { return nil }
        if context.pointee.ch_layout.nb_channels <= 0 { av_channel_layout_default(&context.pointee.ch_layout, 2) }
        if context.pointee.sample_rate <= 0 { context.pointee.sample_rate = 48000 }
        sampleRate = Int(context.pointee.sample_rate)
        frameLength = max(1, sampleRate / SpeechLevels.framesPerSecond)

        let channels = Int(context.pointee.ch_layout.nb_channels)
        let centre = channels >= 3 ? Int(av_channel_layout_index_from_channel(&context.pointee.ch_layout, AV_CHAN_FRONT_CENTER)) : -1
        keep = max(centre, 0)
        var outLayout = AVChannelLayout()
        defer { av_channel_layout_uninit(&outLayout) }
        if centre >= 0 {
            guard av_channel_layout_copy(&outLayout, &context.pointee.ch_layout) >= 0 else { return nil }
        } else {
            av_channel_layout_default(&outLayout, 1)
        }
        outChannels = Int(outLayout.nb_channels)
        guard swr_alloc_set_opts2(&resampler, &outLayout, AV_SAMPLE_FMT_FLTP, Int32(sampleRate),
                                  &context.pointee.ch_layout, context.pointee.sample_fmt, Int32(sampleRate), 0, nil) >= 0,
              let swr = resampler, swr_init(swr) >= 0 else { return nil }
        frame = av_frame_alloc()
        guard frame != nil else { return nil }
    }

    deinit {
        if dropped > 0 { NSLog("[SubtitleAligner] speech levels skipped %ld audio packets the decoder could not keep up with", dropped) }
        av_frame_free(&frame)
        swr_free(&resampler)
        avcodec_free_context(&decoder)
    }

    /// Takes a reference to the packet and decodes it later; the caller keeps its own.
    func feed(_ packet: UnsafeMutablePointer<AVPacket>) {
        backlogLock.lock()
        let full = backlog >= Self.maxBacklog
        if full { dropped += 1 } else { backlog += 1 }
        backlogLock.unlock()
        guard !full, let copy = av_packet_clone(packet) else { return }
        let address = Int(bitPattern: copy)
        queue.async { [self] in
            var owned = UnsafeMutablePointer<AVPacket>(bitPattern: address)
            decode(owned!)
            av_packet_free(&owned)
            backlogLock.lock()
            backlog -= 1
            backlogLock.unlock()
        }
    }

    /// Waits for every packet fed so far to be decoded.
    func drain() {
        queue.sync {}
    }

    private func decode(_ packet: UnsafeMutablePointer<AVPacket>) {
        guard let decoder, let frame, let resampler else { return }
        if avcodec_send_packet(decoder, packet) < 0 {
            avcodec_flush_buffers(decoder)
            pendingIndex = nil
            return
        }
        while avcodec_receive_frame(decoder, frame) >= 0 {
            defer { av_frame_unref(frame) }
            let stamp = frame.pointee.best_effort_timestamp
            guard stamp != Int64(bitPattern: 0x8000_0000_0000_0000) else { continue }
            take(frame, swr: resampler, seconds: Double(stamp) * timeBase)
        }
    }

    private func take(_ frame: UnsafeMutablePointer<AVFrame>, swr: OpaquePointer, seconds: Double) {
        let count = Int(frame.pointee.nb_samples)
        guard count > 0 else { return }
        var out = [Float](repeating: 0, count: count * outChannels)
        let produced: Int32 = out.withUnsafeMutableBufferPointer { buffer in
            var planes: [UnsafeMutablePointer<UInt8>?] = (0..<outChannels).map {
                UnsafeMutableRawPointer(buffer.baseAddress! + $0 * count).assumingMemoryBound(to: UInt8.self)
            }
            return planes.withUnsafeMutableBufferPointer { outPlanes in
                withUnsafePointer(to: &frame.pointee.data.0) { inData in
                    swr_convert(swr, outPlanes.baseAddress, Int32(count), UnsafeRawPointer(inData).assumingMemoryBound(to: UnsafePointer<UInt8>?.self), Int32(count))
                }
            }
        }
        guard produced > 0 else { return }
        var samples = Array(out[(keep * count)..<(keep * count + Int(produced))])

        let rate = Double(sampleRate)
        let expected = pendingIndex.map { Double($0) / Double(SpeechLevels.framesPerSecond) + Double(pending.count) / rate }
        if expected == nil || abs(seconds - expected!) > 0.05 {
            // A seek or a gap: start again on the 10 ms grid at the first whole frame of this one.
            let first = Int((seconds * Double(SpeechLevels.framesPerSecond)).rounded(.up))
            let skip = Int(((Double(first) / Double(SpeechLevels.framesPerSecond) - seconds) * rate).rounded())
            pending = []
            pendingIndex = first
            samples = skip < samples.count ? Array(samples[max(0, skip)...]) : []
        }
        pending.append(contentsOf: samples)
        let whole = pending.count / frameLength
        guard whole > 0, let index = pendingIndex else { return }
        var found = [Float](repeating: 0, count: whole)
        let scale = Float(32768 * 32768)
        pending.withUnsafeBufferPointer { buffer in
            for frameIndex in 0..<whole {
                var meanSquare: Float = 0
                vDSP_measqv(buffer.baseAddress! + frameIndex * frameLength, 1, &meanSquare, vDSP_Length(frameLength))
                found[frameIndex] = 10 * log10(meanSquare * scale + 1)
            }
        }
        levels.record(found, from: index)
        pending.removeFirst(whole * frameLength)
        pendingIndex = index + whole
    }
}
