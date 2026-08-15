//
//  MultiAudioResourceLoader.swift
//  TomoTV
//
//  Created on January 23, 2026.
//  Custom HLS manifest generator for seamless multi-audio track switching
//

import Foundation
import React
import AVFoundation
import react_native_video

/// Main singleton class that implements AVAssetResourceLoaderDelegate
/// to serve combined HLS manifests for multi-audio track switching
class MultiAudioResourceLoaderDelegate: NSObject, AVAssetResourceLoaderDelegate {

    // MARK: - Singleton

    static let shared = MultiAudioResourceLoaderDelegate()

    private override init() {
        let config = URLSessionConfiguration.ephemeral
        // Bounds how many manifest fetches are in flight at once. Every manifest
        // URL carries its own playSessionId by design (see buildManifestUrl), so
        // each one provokes a SEPARATE Jellyfin transcode session — fanning all
        // of them out at once would spike load on the user's server rather than
        // just arriving sooner.
        config.httpMaximumConnectionsPerHost = Self.maxConcurrentFetches
        config.timeoutIntervalForRequest = Self.manifestDeadline
        // A manifest is bound to a transcode session; a cached one is a stale one.
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
        super.init()
    }

    // MARK: - Properties

    /// Total budget for one master-manifest request, however many tracks it
    /// covers. This used to be 30s PER track fetched serially, so a five-track
    /// file could spend 150s — long after AVFoundation abandons the request.
    private static let manifestDeadline: TimeInterval = 30
    private static let maxConcurrentFetches = 3

    /// Config that loading requests read.
    ///
    /// Guarded by `configLock`, not by `queue`. A request block occupies `queue`
    /// for as long as its fetches take, so routing configure() through the same
    /// queue would park configureResourceLoader's promise behind an in-flight
    /// request — and JS awaits that promise before it can start playback at all.
    /// That would trade a race for a visible startup stall.
    private let configLock = NSLock()
    private var jellyfinBaseUrl: String = ""
    private var itemId: String = ""
    private var audioTrackInfo: [[String: Any]] = []

    private let session: URLSession
    /// Concurrent, because a request block now blocks on its own fetch deadline
    /// and this queue guards nothing: config sits behind `configLock`, the
    /// manifest slots behind their own lock, and the job table behind
    /// `jobsLock`. While it was serial, two overlapping players meant the second
    /// one's master manifest waited out the first one's entire deadline.
    private let queue = DispatchQueue(label: "com.tomotv.multiaudio", qos: .userInitiated, attributes: .concurrent)

    /// In-flight work per loading request, so `didCancel` can actually stop it.
    private let jobsLock = NSLock()
    private var jobs: [ObjectIdentifier: RequestJob] = [:]

    /// The network work behind one loading request. AVFoundation cancels
    /// requests routinely (the player tears down, a seek supersedes them), and
    /// without this the fetches ran to completion and then reported into a dead
    /// request.
    private final class RequestJob {
        private let lock = NSLock()
        private var tasks: [URLSessionTask] = []
        private var cancelled = false
        /// Set only when WE gave up on the fetches. AVFoundation cancelling its own
        /// request is a different thing entirely: there the request is already dead
        /// and answering it is wasted work, while here it is still waiting on us.
        private var timedOut = false

        /// Adopt a task, or refuse it because the request is already cancelled.
        func adopt(_ task: URLSessionTask) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard !cancelled else { return false }
            tasks.append(task)
            return true
        }

        func cancel(timedOut: Bool = false) {
            lock.lock()
            cancelled = true
            if timedOut { self.timedOut = true }
            let running = tasks
            tasks.removeAll()
            lock.unlock()
            running.forEach { $0.cancel() }
        }

        var isCancelled: Bool {
            lock.lock()
            defer { lock.unlock() }
            return cancelled
        }

        var didTimeOut: Bool {
            lock.lock()
            defer { lock.unlock() }
            return timedOut
        }
    }

    // MARK: - Configuration

    /// Configure the resource loader with Jellyfin connection details.
    ///
    /// `apiKey` is accepted and ignored: it is already carried in `baseUrl`'s
    /// query, which is where buildManifestUrl reads it from. The parameter stays
    /// so the bridge signature and its JS call site do not have to change.
    func configure(baseUrl: String, apiKey: String, itemId: String, audioTracks: [[String: Any]]) {
        configLock.lock()
        self.jellyfinBaseUrl = baseUrl
        self.itemId = itemId
        self.audioTrackInfo = audioTracks
        configLock.unlock()

        NSLog("[MultiAudioResourceLoader] Configured for item: \(itemId) with \(audioTracks.count) audio tracks")
    }

    /// One coherent read of everything a request needs, taken once so a
    /// configure() midway through cannot split a request across two items.
    private func configSnapshot() -> (baseUrl: String, itemId: String, tracks: [[String: Any]]) {
        configLock.lock()
        defer { configLock.unlock() }
        return (jellyfinBaseUrl, itemId, audioTrackInfo)
    }

    // MARK: - AVAssetResourceLoaderDelegate

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        #if DEBUG
        NSLog("[MultiAudioResourceLoader] Resource requested: \(loadingRequest.request.url?.absoluteString ?? "unknown")")
        #endif

        // Only handle our custom protocol (jellyfin-multi://)
        guard let url = loadingRequest.request.url,
              url.scheme == "jellyfin-multi" else {
            NSLog("[MultiAudioResourceLoader] Not our protocol, rejecting")
            return false
        }

        let job = RequestJob()
        let key = ObjectIdentifier(loadingRequest)
        jobsLock.lock()
        jobs[key] = job
        jobsLock.unlock()

        // Handle request on background queue
        queue.async {
            defer {
                self.jobsLock.lock()
                self.jobs.removeValue(forKey: key)
                self.jobsLock.unlock()
            }
            do {
                // Master manifest request - combine all manifests
                NSLog("[MultiAudioResourceLoader] Master manifest request")

                let config = self.configSnapshot()
                let (manifests, manifestUrls) = try self.fetchAllManifests(
                    baseUrl: config.baseUrl,
                    itemId: config.itemId,
                    tracks: config.tracks,
                    job: job
                )
                // Cancelled while fetching. Which cancel it was decides the answer:
                // AVFoundation's own (didCancel) means the request is dead and
                // finishLoading on it is wasted work, but OUR deadline firing leaves
                // AVFoundation waiting on a request nobody will ever answer — it then
                // hangs on its own opaque timeout instead of failing the load.
                guard !job.isCancelled else {
                    if job.didTimeOut {
                        NSLog("[MultiAudioResourceLoader] Manifest fetches timed out; failing the request")
                        loadingRequest.finishLoading(
                            with: NSError(
                                domain: "MultiAudioResourceLoader",
                                code: 8,
                                userInfo: [NSLocalizedDescriptionKey: "Timed out fetching audio manifests after \(Self.manifestDeadline)s"]
                            )
                        )
                        return
                    }
                    NSLog("[MultiAudioResourceLoader] Request cancelled; dropping")
                    return
                }
                let combinedManifestString = try self.generateMultivariantManifest(
                    from: manifests,
                    audioTrackInfo: config.tracks,
                    fetchUrls: manifestUrls
                )

                // Convert string to data
                guard let combinedManifest = combinedManifestString.data(using: .utf8) else {
                    throw NSError(
                        domain: "MultiAudioResourceLoader",
                        code: 7,
                        userInfo: [NSLocalizedDescriptionKey: "Failed to encode manifest to UTF-8"]
                    )
                }

                NSLog("[MultiAudioResourceLoader] Generated combined manifest (\(combinedManifest.count) bytes)")

                // Provide manifest data to AVPlayer
                if let dataRequest = loadingRequest.dataRequest {
                    dataRequest.respond(with: combinedManifest)
                }

                // Set content type
                if let contentInfoRequest = loadingRequest.contentInformationRequest {
                    contentInfoRequest.contentType = "application/vnd.apple.mpegurl" // HLS MIME type
                    contentInfoRequest.contentLength = Int64(combinedManifest.count)
                    contentInfoRequest.isByteRangeAccessSupported = false
                }

                // Mark request as finished
                loadingRequest.finishLoading()

                NSLog("[MultiAudioResourceLoader] Request completed successfully")

            } catch {
                NSLog("[MultiAudioResourceLoader] Error serving manifest: \(error.localizedDescription)")
                loadingRequest.finishLoading(with: error)
            }
        }

        return true // We'll handle this request
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        jobsLock.lock()
        let job = jobs.removeValue(forKey: ObjectIdentifier(loadingRequest))
        jobsLock.unlock()
        job?.cancel()
    }

    // MARK: - Private Methods

    /// Fetch every track's manifest, returning ONE SLOT PER TRACK — nil where the
    /// track had no stream index or its fetch failed or was cancelled.
    ///
    /// The slots are the whole point. This used to append to two dense arrays
    /// while `continue`ing past unusable tracks, but HLSManifestGenerator indexes
    /// the results by audioTrackInfo POSITION, so a single skipped track shifted
    /// every later track onto another track's manifest URL: the viewer chose one
    /// language and heard a different one.
    ///
    /// Fetches run concurrently, bounded by the session's per-host connection
    /// limit, under ONE deadline for the whole set rather than one per request.
    private func fetchAllManifests(
        baseUrl: String,
        itemId: String,
        tracks: [[String: Any]],
        job: RequestJob
    ) throws -> ([String?], [String?]) {
        var manifests = [String?](repeating: nil, count: tracks.count)
        var manifestUrls = [String?](repeating: nil, count: tracks.count)
        let slotsLock = NSLock()
        let group = DispatchGroup()

        for (position, trackInfo) in tracks.enumerated() {
            // Get actual Jellyfin stream index from track metadata
            guard let streamIndex = trackInfo["Index"] as? Int else {
                NSLog("[MultiAudioResourceLoader] ⚠️ Missing Index for track \(position + 1), leaving its slot empty")
                continue
            }

            let manifestUrl = buildManifestUrl(baseUrl: baseUrl, itemId: itemId, audioStreamIndex: streamIndex)
            guard let url = URL(string: manifestUrl) else {
                NSLog("[MultiAudioResourceLoader] ⚠️ Unusable manifest URL for stream \(streamIndex)")
                continue
            }

            NSLog("[MultiAudioResourceLoader] Fetching manifest for stream \(streamIndex) (\(position + 1)/\(tracks.count))")
            #if DEBUG
            NSLog("[MultiAudioResourceLoader] Manifest URL: \(manifestUrl)")
            #endif

            group.enter()
            let task = session.dataTask(with: url) { data, _, error in
                defer { group.leave() }
                guard let data, error == nil, let text = String(data: data, encoding: .utf8) else {
                    NSLog("[MultiAudioResourceLoader] Manifest fetch failed for stream \(streamIndex): \(error?.localizedDescription ?? "no data")")
                    return
                }
                slotsLock.lock()
                manifests[position] = text
                manifestUrls[position] = manifestUrl
                slotsLock.unlock()
            }
            guard job.adopt(task) else {
                group.leave()
                break // cancelled while we were queueing work
            }
            task.resume()
        }

        if group.wait(timeout: .now() + Self.manifestDeadline) == .timedOut {
            // Stop the stragglers rather than letting them outlive the request
            // they were fetched for. Whatever landed in time still gets used.
            NSLog("[MultiAudioResourceLoader] Manifest fetches exceeded \(Self.manifestDeadline)s; cancelling the rest")
            job.cancel(timedOut: true)
        }

        // Under the lock: a late completion from a cancelled task can still be
        // writing its slot as this reads them.
        slotsLock.lock()
        defer { slotsLock.unlock() }
        return (manifests, manifestUrls)
    }

    private func buildManifestUrl(baseUrl: String, itemId: String, audioStreamIndex: Int) -> String {
        // Parse base URL
        guard var components = URLComponents(string: baseUrl) else {
            return baseUrl
        }

        var queryItems = components.queryItems ?? []

        // Add audioStreamIndex to select which audio track to encode
        queryItems.append(URLQueryItem(name: "audioStreamIndex", value: "\(audioStreamIndex)"))

        // Add UNIQUE playSessionId to force separate transcode session
        // This is critical: Jellyfin reuses transcode sessions without unique IDs,
        // resulting in all audio tracks playing the same audio
        let sessionId = "multi-audio-\(itemId)-track-\(audioStreamIndex)"
        queryItems.append(URLQueryItem(name: "playSessionId", value: sessionId))

        components.queryItems = queryItems

        return components.url?.absoluteString ?? baseUrl
    }

    /// `audioTrackInfo` is passed in rather than read off the instance: it has to
    /// be the same snapshot the manifests were fetched against, or the slots and
    /// the track list could describe two different items.
    func generateMultivariantManifest(
        from manifests: [String?],
        audioTrackInfo: [[String: Any]],
        fetchUrls: [String?]
    ) throws -> String {
        let generator = HLSManifestGenerator()

        let combinedManifestString = try generator.combine(
            manifests: manifests,
            audioTrackInfo: audioTrackInfo,
            fetchUrls: fetchUrls
        )

        return combinedManifestString
    }
}

// MARK: - React Native Bridge

/// React Native bridge module that exposes MultiAudioResourceLoaderDelegate to JavaScript
@objc(MultiAudioResourceLoader)
class MultiAudioResourceLoader: NSObject {

    private static var pluginRegistered = false

    // Store plugin instance to keep it alive
    private static var pluginInstance: MultiAudioVideoPlugin?

    @objc
    func registerVideoPlugin(
        _ resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        // Only register once
        guard !MultiAudioResourceLoader.pluginRegistered else {
            NSLog("[MultiAudioResourceLoader] Plugin already registered")
            resolve(true)
            return
        }

        NSLog("[MultiAudioResourceLoader] Registering video plugin...")

        // Create plugin instance and keep it alive
        let plugin = MultiAudioVideoPlugin()
        MultiAudioResourceLoader.pluginInstance = plugin

        // Register plugin with react-native-video's manager
        DispatchQueue.main.async {
            ReactNativeVideoManager.shared.registerPlugin(plugin: plugin)
            NSLog("[MultiAudioResourceLoader] ✅ Plugin registered with ReactNativeVideoManager")
            MultiAudioResourceLoader.pluginRegistered = true
            resolve(true)
        }
    }

    @objc
    func configureResourceLoader(
        _ baseUrl: String,
        apiKey key: String,
        itemId id: String,
        audioTracks tracks: [[String: Any]],
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        // Straight through: configure() now just takes a lock and assigns, so
        // the hop onto a background queue bought nothing and only made the
        // ordering harder to read. The promise resolves after the assignment,
        // which is the guarantee the JS caller depends on before it asks for a
        // URL and starts playback.
        MultiAudioResourceLoaderDelegate.shared.configure(
            baseUrl: baseUrl,
            apiKey: key,
            itemId: id,
            audioTracks: tracks
        )
        resolve(true)
    }

    @objc
    func generateCustomUrl(
        _ itemId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        NSLog("[MultiAudioResourceLoader] generateCustomUrl called for item: \(itemId)")

        // Return custom protocol URL immediately
        // The react-native-video patch recognizes this as a network URL
        // The resource loader will fetch manifests lazily when AVPlayer requests them
        let customUrl = "jellyfin-multi://server/Videos/\(itemId)/master.m3u8"

        NSLog("[MultiAudioResourceLoader] ✅ Generated custom URL: \(customUrl)")

        DispatchQueue.main.async {
            resolve(customUrl)
        }
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
}
