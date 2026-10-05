//
//  RemuxSession+IFrames.swift
//  TomoTV
//
//  The I-frame rendition AVKit scrubs with (thumbnails on tvOS, the picture itself on iOS): the
//  master line, the playlist, and the routes, fed by the session's frame grabber.
//

import Foundation

extension RemuxSession {
    /// How long the I-frame playlist waits for the first keyframe to fix the timeline.
    static let iframeAnchorWaitSeconds = 10.0
    /// How long a fragment request waits for its own frame before the nearest made one stands in:
    /// on a link that carries the copy it waits, under a server ladder the link belongs to playback.
    static let iframeWaitSeconds = (copyLink: 4.0, ladder: 0.6)

    /// The master's I-frame line, or "" for a session without video to draw from. BANDWIDTH is the
    /// copy's peak: a keyframe over the gap to the next is at most its GOP's rate, and the spec's
    /// 6.5 estimate under-declares a keyframe badly enough that AVFoundation logs -12318 on it.
    func iframeStreamInf(bandwidth: Int) -> String {
        stateLock.lock()
        let planned = iframeTranscodes != nil
        stateLock.unlock()
        let codecs = originalVideoCodecs()
        guard !config.isLive, planned, !codecs.isEmpty, config.durationSeconds > 0 else { return "" }
        var line = "#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=\(max(1, bandwidth))"
        line += ",CODECS=\"\(codecs.joined(separator: ","))\""
        if !config.supplementalCodecs.isEmpty { line += ",SUPPLEMENTAL-CODECS=\"\(config.supplementalCodecs)\"" }
        if config.width > 0 && config.height > 0 { line += ",RESOLUTION=\(config.width)x\(config.height)" }
        if !config.videoRange.isEmpty { line += ",VIDEO-RANGE=\(config.videoRange)" }
        return line + ",URI=\"iframes.m3u8\"\n"
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

    /// Built on the first I-frame request, once the first keyframe has fixed the timeline.
    private func iframeStoreForRequest() -> IFrameStore? {
        _ = waitUntil(deadline: Self.iframeAnchorWaitSeconds) { [weak self] in
            guard let self else { return true }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            return self.sessionAnchorSeconds != nil || self.failed || self.cancelled
        }
        stateLock.lock()
        if let iframeStore {
            stateLock.unlock()
            return iframeStore
        }
        guard !cancelled, !failed, let transcode = iframeTranscodes, let anchor = sessionAnchorSeconds else {
            stateLock.unlock()
            return nil
        }
        let grabber = frameGrabberLocked()
        stateLock.unlock()
        guard let track = grabber.iframeInit(transcode: transcode), let entries = iframeEntries(anchorSeconds: anchor) else { return nil }
        let store = IFrameStore(entries: entries, timescale: Double(track.timescale.den) / Double(max(1, track.timescale.num))) { [weak grabber] k in
            grabber?.iframeFragment(sourceSeconds: entries.sources[k], exact: entries.exact, stampSeconds: entries.stamps[k], transcode: transcode)
        }
        stateLock.lock()
        defer { stateLock.unlock() }
        if let iframeStore { return iframeStore }
        guard !cancelled else { return nil }
        iframeStore = store
        return store
    }

    func iframePlaylistResponse() -> LocalHTTPResponse {
        guard let store = iframeStoreForRequest() else { return .notFound }
        return .data(Data(store.entries.playlist(durationSeconds: config.durationSeconds).utf8), contentType: "application/vnd.apple.mpegurl")
    }

    func iframeInitResponse() -> LocalHTTPResponse {
        guard iframeStoreForRequest() != nil else { return .notFound }
        stateLock.lock()
        let transcode = iframeTranscodes
        let grabber = cancelled ? nil : frameGrabberLocked()
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
