//
//  LowLatencyPlayerAsset.swift
//  TomoTV
//
//  An LL-HLS session's asset for AVPlayer: its playlists are answered through the asset's resource loader from the
//  loopback server, and its segments and parts are redirected to that server (AVAssetResourceLoadingRequest.redirect
//  takes HTTP URLs only).
//

import AVFoundation
import Foundation

public final class LowLatencyPlayerAsset: NSObject, AVAssetResourceLoaderDelegate {
    static let scheme = "tomo-ll"
    static let shared = LowLatencyPlayerAsset()

    private static let lock = NSLock()
    /// Tokens of the sessions that serve LL-HLS parts.
    private static var tokens = Set<String>()

    private let queue = DispatchQueue(label: "tv.tomo.lowlatency-loader", qos: .userInitiated, attributes: .concurrent)
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpMaximumConnectionsPerHost = 16
        return URLSession(configuration: config)
    }()
    private let tasksLock = NSLock()
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]

    static func register(token: String) {
        lock.lock()
        tokens.insert(token)
        lock.unlock()
    }

    static func unregister(token: String) {
        lock.lock()
        tokens.remove(token)
        lock.unlock()
    }

    /// The asset AVPlayer reads `url` through when it is the master of a session serving parts; nil for any other URL.
    public static func asset(for url: URL) -> AVURLAsset? {
        guard url.scheme == "http", url.host == "127.0.0.1", let token = sessionToken(url) else { return nil }
        lock.lock()
        let serves = tokens.contains(token)
        lock.unlock()
        guard serves, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = scheme
        guard let custom = parts.url else { return nil }
        let asset = AVURLAsset(url: custom)
        asset.resourceLoader.setDelegate(shared, queue: shared.queue)
        return asset
    }

    /// The token of a loopback URL: its first path component.
    static func sessionToken(_ url: URL) -> String? {
        let components = url.path.split(separator: "/")
        return components.count >= 2 ? String(components[0]) : nil
    }

    /// The loopback URL a custom-scheme request names.
    static func loopbackURL(_ url: URL) -> URL? {
        guard url.scheme == scheme, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = "http"
        return parts.url
    }


    public func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        guard let custom = loadingRequest.request.url, let http = Self.loopbackURL(custom) else { return false }
        guard http.path.hasSuffix(".m3u8") else {
            loadingRequest.redirect = URLRequest(url: http)
            loadingRequest.response = HTTPURLResponse(url: http, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": http.absoluteString])
            loadingRequest.finishLoading()
            return true
        }
        fetchPlaylist(http, for: loadingRequest)
        return true
    }

    public func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        tasksLock.lock()
        let task = tasks.removeValue(forKey: ObjectIdentifier(loadingRequest))
        tasksLock.unlock()
        task?.cancel()
    }

    /// A blocking reload the server gives up on (503 after three targets, 400 past the advance limit) is asked again, so the
    /// player's request stays held until the playlist it asked for exists; only the session's end (404) fails it.
    private func fetchPlaylist(_ http: URL, for loadingRequest: AVAssetResourceLoadingRequest) {
        let key = ObjectIdentifier(loadingRequest)
        let task = session.dataTask(with: http) { [weak self] data, response, error in
            guard let self else { return }
            self.tasksLock.lock()
            self.tasks.removeValue(forKey: key)
            self.tasksLock.unlock()
            if loadingRequest.isCancelled || loadingRequest.isFinished { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let data, status == 200 else {
                if status == 503 {
                    self.fetchPlaylist(http, for: loadingRequest)
                    return
                }
                if status == 400 {
                    self.queue.asyncAfter(deadline: .now() + 0.25) { self.fetchPlaylist(http, for: loadingRequest) }
                    return
                }
                loadingRequest.finishLoading(with: error ?? NSError(domain: NSURLErrorDomain, code: NSURLErrorBadServerResponse,
                                                                     userInfo: [NSLocalizedDescriptionKey: "HTTP \(status) \(http.lastPathComponent)"]))
                return
            }
            if let info = loadingRequest.contentInformationRequest {
                info.contentType = "public.m3u-playlist"
                info.contentLength = Int64(data.count)
                info.isByteRangeAccessSupported = false
            }
            if let request = loadingRequest.dataRequest {
                let start = Int(request.requestedOffset)
                let end = request.requestsAllDataToEndOfResource ? data.count : min(data.count, start + request.requestedLength)
                if start < end { request.respond(with: data.subdata(in: start..<end)) }
            }
            loadingRequest.finishLoading()
        }
        tasksLock.lock()
        tasks[key] = task
        tasksLock.unlock()
        task.resume()
    }
}
