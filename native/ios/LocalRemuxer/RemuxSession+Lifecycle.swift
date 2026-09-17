//
//  RemuxSession+Lifecycle.swift
//  TomoTV
//
//  Session lifecycle: start, stop, cancellation, and directory cleanup.
//

import Foundation

extension RemuxSession {
    // MARK: - Lifecycle

    func start() {
        prefetchServerCues()
        let thread = Thread { [weak self] in
            self?.runPipeline()
        }
        thread.name = "tv.tomo.localremux"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    func stop() {
        stateLock.lock()
        cancelled = true
        let frames = frameGrabber
        stateLock.unlock()
        frames?.stop()
        killTierTranscode()
        // The pipeline thread notices `cancelled` between packets (or through
        // the AVIO interrupt callback during a blocking read) and exits; the
        // directory is removed on the next session's init as well.
        try? FileManager.default.removeItem(at: dir)
    }

    /// Fire-and-forget kill of the server transcodes this session started —
    /// the video tier and every audio-lo rendition. Jellyfin keys each job by
    /// PlaySessionId, which rides the playlist URL along with the ApiKey —
    /// DELETE /Videos/ActiveEncodings is the public route (M1: 204).
    func killTierTranscode() {
        var urls = config.tiers.map(\.playlistUrl)
        urls += config.audioTracks.map(\.serverAudioUrl).filter { !$0.isEmpty }
        for urlString in urls {
            guard let components = URLComponents(string: urlString),
                  let apiKey = components.queryItems?.first(where: { $0.name == "ApiKey" })?.value,
                  let playSessionId = components.queryItems?.first(where: { $0.name == "PlaySessionId" })?.value,
                  let scheme = components.scheme, let host = components.host
            else { continue }
            let port = components.port.map { ":\($0)" } ?? ""
            guard let url = URL(string: "\(scheme)://\(host)\(port)/Videos/ActiveEncodings?deviceId=tomo-slipstream&playSessionId=\(playSessionId)&ApiKey=\(apiKey)") else { continue }
            var request = URLRequest(url: url, timeoutInterval: 5)
            request.httpMethod = "DELETE"
            URLSession.shared.dataTask(with: request).resume()
        }
    }

    var isCancelled: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cancelled
    }

    /// A failure from any thread also ends a blocking open or read.
    var hasFailed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return failed
    }

    /// The keyframe at or before `ms` of source time, as a JPEG in the frame pool (the session directory without an item id).
    func chapterFrame(atMilliseconds ms: Int64) -> URL? {
        stateLock.lock()
        if cancelled {
            stateLock.unlock()
            return nil
        }
        let pooled = ChapterFramePool.directory(for: config.itemId)
        let grabber = frameGrabber ?? FrameGrabber(inputUrl: config.inputUrl, directory: pooled ?? dir, pool: pooled == nil ? nil : ChapterFramePool.root, epoch: poolEpoch)
        frameGrabber = grabber
        stateLock.unlock()
        return grabber.chapterFrame(atMilliseconds: ms)
    }

}
