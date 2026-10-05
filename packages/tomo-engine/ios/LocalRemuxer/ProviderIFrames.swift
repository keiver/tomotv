//
//  ProviderIFrames.swift
//  TomoTV
//
//  The I-frame rendition for the server lanes, served under a frame provider's token and named
//  by an absolute line in the server master (PlaylistShim, the multi-audio loader). Frames come
//  off the original file through the provider's grabber, stamped on the server transcode's
//  timeline: the source's time from its start (measured, fMP4 and TS segments alike).
//

import Foundation
import Libavutil

final class ProviderIFrames {
    /// Set by the caller from the item: whether the frames are re-encoded, and the grid's length.
    let transcode: Bool
    let durationSeconds: Double
    private let grabber: FrameGrabber
    private let lock = NSLock()
    private var store: IFrameStore?
    private var stopped = false

    init(grabber: FrameGrabber, transcode: Bool, durationSeconds: Double) {
        self.grabber = grabber
        self.transcode = transcode
        self.durationSeconds = durationSeconds
    }

    func stop() {
        lock.lock()
        stopped = true
        let current = store
        lock.unlock()
        current?.stop()
    }

    private func storeForRequest() -> IFrameStore? {
        lock.lock()
        if let store {
            lock.unlock()
            return store
        }
        lock.unlock()
        guard let timeline = grabber.iframeTimeline(), let track = grabber.iframeInit(transcode: transcode) else { return nil }
        let entries = timeline.index.flatMap { IFrameEntries.indexed($0, anchorSeconds: timeline.startSeconds, durationSeconds: durationSeconds) }
            ?? IFrameEntries.grid(starts: Array(stride(from: 0, to: durationSeconds, by: RemuxSession.segmentDuration)), anchorSeconds: timeline.startSeconds)
        guard let entries else { return nil }
        let transcode = self.transcode
        let made = IFrameStore(entries: entries, timescale: Double(track.timescale.den) / Double(max(1, track.timescale.num))) { [weak grabber] k in
            grabber?.iframeFragment(sourceSeconds: entries.sources[k], exact: entries.exact, stampSeconds: entries.stamps[k], transcode: transcode)
        }
        lock.lock()
        defer { lock.unlock() }
        if let store { return store }
        guard !stopped else { return nil }
        store = made
        return made
    }

    func route(_ name: String) -> LocalHTTPResponse? {
        switch name {
        case "iframes.m3u8":
            guard let store = storeForRequest() else { return .notFound }
            return .data(Data(store.entries.playlist(durationSeconds: durationSeconds).utf8), contentType: "application/vnd.apple.mpegurl")
        case "if-init.mp4":
            guard storeForRequest() != nil, let track = grabber.iframeInit(transcode: transcode) else { return .notFound }
            return .data(track.initSegment, contentType: "video/mp4")
        default:
            guard name.hasPrefix("kf"), name.hasSuffix(".m4s"), let k = Int(name.dropFirst(2).dropLast(4)) else { return nil }
            // The server lane often answers a slow link: a request that cannot have its own frame
            // quickly takes the nearest made one rather than queueing a read behind playback.
            guard let store = storeForRequest(), let data = store.fragment(k, budget: RemuxSession.iframeWaitSeconds.ladder) else { return .notFound }
            return .data(data, contentType: "video/iso.segment")
        }
    }
}
