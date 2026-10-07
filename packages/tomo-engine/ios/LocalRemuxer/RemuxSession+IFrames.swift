//
//  RemuxSession+IFrames.swift
//  TomoTV
//
//  The I-frame rendition AVKit scrubs with (thumbnails on tvOS, the picture itself on iOS): the
//  master line, the playlist, and the routes, fed by a frame grabber of its own.
//

import Foundation
import Libavcodec
import Libavutil

extension RemuxSession {
    /// How long the I-frame playlist waits for the first keyframe to fix the timeline.
    static let iframeAnchorWaitSeconds = 10.0
    /// How long a fragment request waits for its own frame before the nearest made one stands in:
    /// on a link that carries the copy it waits, under a server ladder the link belongs to playback.
    static let iframeWaitSeconds = (copyLink: 4.0, ladder: 0.6)
    /// Entries made once startup is over to measure the rendition's mean, and how long the sample may take.
    static let iframeSampleCount = 8
    static let iframeSampleSeconds = 120.0
    /// The measured mean per item and rendition kind, declared by the item's next master (AVPlayer reads one
    /// per session), kept across launches: item ids are the same on every server.
    private func iframeMeanKey(encodes: Bool) -> String { "tomo.iframeMean.\(config.itemId).\(encodes ? "encoded" : "copied")" }

    func rememberedIFrameMean(encodes: Bool) -> Int? {
        let mean = UserDefaults.standard.integer(forKey: iframeMeanKey(encodes: encodes))
        return mean > 0 ? mean : nil
    }

    /// Whether the I-frame rendition encodes SDR frames (true) or copies the source's keyframes (false):
    /// a copy only for an SDR picture inside 1920x1080 that playback copies (authoring spec 6.16, Apple's
    /// trick play tops out at 1080p). Nil for Dolby Vision with no HDR10 base layer (profile 5).
    static func iframeEncodes(par: UnsafeMutablePointer<AVCodecParameters>, playbackTranscodes: Bool) -> Bool? {
        let dolbyVision = DolbyVisionConverter.configuration(par)
        if let dolbyVision, dolbyVision.dv_bl_signal_compatibility_id == 0 { return nil }
        let hdr = dolbyVision != nil || par.pointee.color_trc == AVCOL_TRC_SMPTE2084 || par.pointee.color_trc == AVCOL_TRC_ARIB_STD_B67
        let box = FrameGrabber.iframeMaxSize
        return playbackTranscodes || hdr || par.pointee.width > box.width || par.pointee.height > box.height
    }

    /// The master's I-frame line, or "" for a session without video to draw from. Always SDR. BANDWIDTH
    /// is RFC 8216's peak and AVERAGE-BANDWIDTH the mean: measured from index sizes where the container
    /// keeps them, else a bound the frames cannot exceed and the mean of the sampled entries.
    func iframeStreamInf(copyPeak: Int) -> String {
        stateLock.lock()
        let encodes = iframeTranscodes
        let size = iframeSize
        stateLock.unlock()
        guard !config.isLive, let encodes, config.durationSeconds > 0, let entries = iframeTimeline() else { return "" }
        let codecs = encodes ? [FrameGrabber.iframeEncodedCodecs] : originalVideoCodecs()
        guard !codecs.isEmpty else { return "" }
        let rates = iframeBandwidth(entries: entries, encodes: encodes, copyPeak: copyPeak)
        var line = "#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=\(rates.peak),AVERAGE-BANDWIDTH=\(rates.average)"
        line += ",CODECS=\"\(codecs.joined(separator: ","))\""
        if let size, size.width > 0, size.height > 0 { line += ",RESOLUTION=\(size.width)x\(size.height)" }
        return line + ",VIDEO-RANGE=SDR,URI=\"iframes.m3u8\"\n"
    }

    private func iframeBandwidth(entries: IFrameEntries, encodes: Bool, copyPeak: Int) -> IFrameBandwidth {
        let durations = entries.durations(totalSeconds: config.durationSeconds)
        let target = Double(entries.targetDuration(durationSeconds: config.durationSeconds, floor: sessionTargetDuration()))
        if !encodes, let sizes = entries.sizes, sizes.allSatisfy({ $0 > 0 }),
           let measured = IFrameBandwidth.measured(bytes: sizes.map { $0 + IFrameBandwidth.fragmentOverhead }, durations: durations, targetDuration: target) {
            NSLog("[IFrames] master: copied, BANDWIDTH %d and AVERAGE-BANDWIDTH %d from %d index sizes", measured.peak, measured.average, sizes.count)
            return measured
        }
        stateLock.lock()
        let fileSize = iframeFileSize
        stateLock.unlock()
        let peak: Int
        let bound: String
        if encodes {
            (peak, bound) = (FrameGrabber.iframePeakBitrate, "the encoder's cap")
        } else if let positions = entries.positions,
                  let byPosition = IFrameBandwidth.positionBound(positions: positions, fileSize: fileSize, durations: durations, targetDuration: target) {
            (peak, bound) = (byPosition, "cluster positions")
        } else {
            (peak, bound) = (max(1, copyPeak), "the copy's peak")
        }
        let remembered = rememberedIFrameMean(encodes: encodes)
        let average = min(peak, remembered ?? peak)
        NSLog("[IFrames] master: %@, BANDWIDTH %ld from %@, AVERAGE-BANDWIDTH %ld from %@", encodes ? "encoded" : "copied", peak, bound,
              average, remembered == nil ? "the same bound (no sample of this item yet)" : "this item's sampled mean")
        return IFrameBandwidth(peak: peak, average: average)
    }

    /// Once startup is over, makes entries spread over the item and remembers their mean for its next
    /// master; Matroska and the encoded rendition have no sizes before a frame is made.
    func startIFrameSampling() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self, let store = self.iframeStoreForRequest() else { return }
            let started = Date()
            let count = store.entries.stamps.count
            let picks = Array(Set((1...Self.iframeSampleCount).map { count * $0 / (Self.iframeSampleCount + 1) }))
            store.prefetch(picks)
            _ = self.waitUntil(deadline: Self.iframeSampleSeconds) { [weak self] in
                guard let self else { return true }
                self.stateLock.lock()
                defer { self.stateLock.unlock() }
                return self.failed || self.cancelled || picks.allSatisfy { store.madeSizes()[$0] != nil }
            }
            self.stateLock.lock()
            let encodes = self.iframeTranscodes
            self.stateLock.unlock()
            let made = store.madeSizes().filter { picks.contains($0.key) }
            guard let encodes, !self.config.itemId.isEmpty,
                  let mean = IFrameBandwidth.sampledAverage(made, durations: store.entries.durations(totalSeconds: self.config.durationSeconds))
            else { return }
            UserDefaults.standard.set(mean, forKey: self.iframeMeanKey(encodes: encodes))
            NSLog("[IFrames] sampled mean %ld b/s from %ld of %ld entries in %.0f ms", mean, made.count, picks.count, Date().timeIntervalSince(started) * 1000)
        }
    }

    /// The source's own keyframes when its demuxer indexed them, else one entry per segment.
    func iframeEntries(anchorSeconds: Double) -> IFrameEntries? {
        stateLock.lock()
        let index = keyframeIndex
        stateLock.unlock()
        if let index, let entries = IFrameEntries.indexed(index, anchorSeconds: anchorSeconds, durationSeconds: config.durationSeconds) {
            return entries
        }
        return IFrameEntries.grid(starts: (0..<segmentCount).map(segmentStartSeconds), anchorSeconds: anchorSeconds)
    }

    /// The I-frame timeline, fixed once from the first keyframe's anchor: the playlist goes out from it
    /// without a grab, and the store's fragments are numbered by it.
    private func iframeTimeline() -> IFrameEntries? {
        _ = waitUntil(deadline: Self.iframeAnchorWaitSeconds) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.sessionAnchorSeconds != nil || self.failed || self.cancelled
        }
        stateLock.lock()
        if let iframeTimelineEntries {
            stateLock.unlock()
            return iframeTimelineEntries
        }
        guard !cancelled, !failed, iframeTranscodes != nil, let anchor = sessionAnchorSeconds else {
            stateLock.unlock()
            return nil
        }
        stateLock.unlock()
        guard let entries = iframeEntries(anchorSeconds: anchor) else { return nil }
        stateLock.lock()
        defer { stateLock.unlock() }
        if let iframeTimelineEntries { return iframeTimelineEntries }
        iframeTimelineEntries = entries
        return entries
    }

    /// Built by the sampling at session start, or the first init or fragment request.
    private func iframeStoreForRequest() -> IFrameStore? {
        guard let entries = iframeTimeline() else { return nil }
        stateLock.lock()
        if let iframeStore {
            stateLock.unlock()
            return iframeStore
        }
        guard !cancelled, !failed, let transcode = iframeTranscodes else {
            stateLock.unlock()
            return nil
        }
        let grabber = iframeGrabberLocked()
        stateLock.unlock()
        guard let track = grabber.iframeInit(transcode: transcode) else { return nil }
        let samples = entries.sampleDurations(totalSeconds: config.durationSeconds)
        let extinfs = entries.durations(totalSeconds: config.durationSeconds)
        let store = IFrameStore(entries: entries, timescale: Double(track.timescale.den) / Double(max(1, track.timescale.num)),
                                sampleDurations: samples) { [weak grabber] k in
            // An encoded entry stays under the declared peak over its own EXTINF, so no run exceeds it.
            let cap = transcode ? Int(Double(FrameGrabber.iframePeakBitrate) * extinfs[k] / 8) : Int.max
            return grabber?.iframeFragment(sourceSeconds: entries.sources[k], exact: entries.exact, stampSeconds: entries.stamps[k],
                                           sampleSeconds: samples[k], sequence: k + 1, capBytes: cap, transcode: transcode)
        }
        stateLock.lock()
        defer { stateLock.unlock() }
        if let iframeStore { return iframeStore }
        guard !cancelled else { return nil }
        iframeStore = store
        return store
    }

    func iframePlaylistResponse() -> LocalHTTPResponse {
        guard let entries = iframeTimeline() else { return .notFound }
        let playlist = entries.playlist(durationSeconds: config.durationSeconds, targetDuration: sessionTargetDuration())
        return .data(Data(playlist.utf8), contentType: "application/vnd.apple.mpegurl")
    }

    func iframeInitResponse() -> LocalHTTPResponse {
        guard iframeStoreForRequest() != nil else { return .notFound }
        stateLock.lock()
        let transcode = iframeTranscodes
        let grabber = cancelled ? nil : iframeGrabberLocked()
        stateLock.unlock()
        guard let transcode, let track = grabber?.iframeInit(transcode: transcode) else { return .notFound }
        return .data(track.initSegment, contentType: "video/mp4")
    }

    func iframeFragmentResponse(_ k: Int) -> LocalHTTPResponse {
        guard let store = iframeStoreForRequest() else { return .notFound }
        stateLock.lock()
        let wait = ladderListed ? Self.iframeWaitSeconds.ladder : Self.iframeWaitSeconds.copyLink
        stateLock.unlock()
        guard let data = store.fragment(k, budget: wait) else { return .notFound }
        return .data(data, contentType: "video/iso.segment")
    }
}
