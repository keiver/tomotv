//
//  LocalRemuxer.swift
//  TomoTV
//
//  React Native module for the local remux engine. Owns the single active
//  RemuxSession and the loopback HTTP server, and routes the server's request
//  paths (/{token}/master.m3u8, media.m3u8, init.mp4, segN.m4s, subN.m3u8)
//  into the session.
//

import Foundation
// Required with react-native-tvos's prebuilt React core (React.framework + VFS
// overlay): the bridging header's <React/RCTEventEmitter.h> resolves as
// framework-module content there, so the class only becomes visible to Swift
// through an explicit module import. Same trap AudioQueuePlayer.swift documents.
import React
import UIKit
import VideoToolbox

@objc(LocalRemuxer)
class LocalRemuxer: RCTEventEmitter {

    private static let lock = NSLock()

    /// Live sessions by token, newest last.
    ///
    /// This was a single `RemuxSession?`, and starting a new one stopped the old
    /// one outright — which deleted its segment directory. When two player
    /// screens overlap (React mounts the incoming screen before the outgoing one
    /// unmounts) the still-visible player lost its segments mid-playback: the
    /// picture froze on the last decoded frame while already-buffered audio
    /// played on. Every request already carries its session's token, so serving
    /// both costs one extra pipeline thread and one ±20-segment window on disk
    /// for the moment they overlap, and each player tears down the session it
    /// actually owns.
    private static var sessions: [String: RemuxSession] = [:]
    /// Start order, so the oldest is evicted first when the cap is hit.
    private static var sessionOrder: [String] = []
    /// Two covers a screen transition. A third means something is leaking, and
    /// evicting the oldest is better than unbounded threads and disk.
    private static let maxSessions = 2

    /// Playlist shims by token (PlaylistShim.swift — server-lane resume).
    /// Cheap (two cached strings each), same overlap-and-evict story as
    /// sessions.
    private static var shims: [String: PlaylistShim] = [:]
    private static var shimOrder: [String] = []
    private static let maxShims = 2

    /// Frame providers by token (FrameGrabber.swift): chapter keyframes for the lanes
    /// that run no remux session. Same overlap-and-evict story as shims.
    private static var frameProviders: [String: FrameProvider] = [:]
    private static var frameOrder: [String] = []
    private static let maxFrameProviders = 2

    /// Keyframe posters for cards without artwork (PosterQueue.swift), one job at a time.
    private static let posters = PosterQueue()

    private static var server: LocalHTTPServer?

    /// The most recent session's plan, held so a listener that subscribes after
    /// the pipeline thread has already decided still receives it. The plan is
    /// produced within milliseconds of startRemux resolving, so a JS subscriber
    /// set up in response to that promise would otherwise race it.
    private static var lastPlan: [String: Any]?
    private static var hasListeners = false

    @objc override static func requiresMainQueueSetup() -> Bool { false }

    // RCTEventEmitter.h carries no nullability audit, so the imported Swift
    // signature is the implicitly-unwrapped [String]!.
    override func supportedEvents() -> [String]! { ["onEnginePlan", "onEngineThroughput"] }

    override func startObserving() {
        Self.lock.lock()
        Self.hasListeners = true
        let pending = Self.lastPlan
        Self.lock.unlock()
        if let pending { sendEvent(withName: "onEnginePlan", body: pending) }
    }

    override func stopObserving() {
        Self.lock.lock()
        Self.hasListeners = false
        Self.lock.unlock()
    }

    /// Called on the pipeline thread. Emitting with no listeners registered
    /// makes RCTEventEmitter warn, so the plan is only sent when someone is
    /// listening; it is retained either way for a later subscriber.
    private func publish(plan: [String: Any]) {
        Self.lock.lock()
        Self.lastPlan = plan
        let listening = Self.hasListeners
        Self.lock.unlock()
        if listening { sendEvent(withName: "onEnginePlan", body: plan) }
    }

    /// Pipeline-thread samples, sent only while JS listens; nothing is retained.
    private func publish(throughput sample: [String: Any]) {
        Self.lock.lock()
        let listening = Self.hasListeners
        Self.lock.unlock()
        if listening { sendEvent(withName: "onEngineThroughput", body: sample) }
    }

    // MARK: - Routing

    private static func route(_ path: String) -> LocalHTTPResponse {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 2 else { return .notFound }

        // The token in the path selects the session, so a player that is being
        // superseded keeps being served until it tears itself down.
        lock.lock()
        let shim = shims[parts[0]]
        let provider = frameProviders[parts[0]]
        let current = sessions[parts[0]]
        lock.unlock()
        if let shim {
            if parts[1] == "master.m3u8" { return shim.masterResponse() }
            if parts[1].hasPrefix("p"), parts[1].hasSuffix(".m3u8"),
               let n = Int(parts[1].dropFirst(1).dropLast(5)) {
                return shim.mediaResponse(n)
            }
            return .notFound
        }
        if let provider {
            if let ms = frameMilliseconds(parts[1]), let url = provider.grabber.frame(atMilliseconds: ms) {
                return .file(url, contentType: "image/jpeg")
            }
            return .notFound
        }
        guard let current else { return .notFound }

        let m3u8 = "application/vnd.apple.mpegurl"

        let name = parts[1]
        switch name {
        case "master.m3u8":
            return .data(Data(current.masterPlaylist().utf8), contentType: m3u8)
        case "media.m3u8":
            return .data(Data(current.mediaPlaylist().utf8), contentType: m3u8)
        case "t1.m3u8":
            // Slipstream tier media playlist (emitted only when adopted).
            guard let playlist = current.tierPlaylist() else { return .notFound }
            return .data(Data(playlist.utf8), contentType: m3u8)
        case "t1-init.mp4":
            return current.tierInitResponse()
        case "init.mp4":
            return current.initResponse()
        default:
            if name.hasPrefix("sub"), name.hasSuffix(".m3u8"),
               let index = Int(name.dropFirst(3).dropLast(5)),
               let playlist = current.subtitlePlaylist(streamIndex: index) {
                return .data(Data(playlist.utf8), contentType: m3u8)
            }
            // The cue-less body an image subtitle rendition resolves to. AVKit
            // lists and selects the track and draws none of it; the app draws
            // the bitmaps over the video instead.
            if name.hasPrefix("sub"), name.hasSuffix(".vtt") {
                // A track saved with a download serves its own bytes; an image track, and any
                // local file that has since gone, fall back to the cue-less body.
                if let index = Int(name.dropFirst(3).dropLast(4)),
                   let body = current.localSubtitleBody(streamIndex: index) {
                    return .data(body, contentType: "text/vtt")
                }
                return .data(Data(current.emptySubtitleBody().utf8), contentType: "text/vtt")
            }
            // Cue manifest for an image subtitle track, and the cue images
            // themselves. Both are read by the app, never by AVPlayer.
            if name.hasPrefix("pgs"), name.hasSuffix(".json"),
               let index = Int(name.dropFirst(3).dropLast(5)),
               let manifest = current.subtitleCueManifest(streamIndex: index) {
                return .data(manifest, contentType: "application/json")
            }
            if name.hasPrefix("pgs"), name.hasSuffix(".png"),
               let url = current.subtitleImageURL(name) {
                return .file(url, contentType: "image/png")
            }
            // A chapter keyframe, made on the first request. Read by AVKit's info panel.
            if let ms = frameMilliseconds(name), let url = current.chapterFrame(atMilliseconds: ms) {
                return .file(url, contentType: "image/jpeg")
            }
            if name.hasPrefix("t1-seg"), name.hasSuffix(".m4s"),
               let n = Int(name.dropFirst(6).dropLast(4)) {
                return current.tierSegmentResponse(n)
            }
            if name.hasPrefix("seg"), name.hasSuffix(".m4s"),
               let n = Int(name.dropFirst(3).dropLast(4)) {
                return current.segmentResponse(n)
            }

            // Slipstream audio-lo renditions: "aNs.m3u8", "aNs-init.mp4",
            // "aNs-seg{index}.m4s" — must match before the engine "aN" block,
            // whose digits-only guard would 404 the "s" suffix.
            if name.hasPrefix("a"), let sIndex = name.firstIndex(of: "s"),
               name.index(after: name.startIndex) < sIndex,
               name[name.index(after: name.startIndex)..<sIndex].allSatisfy(\.isNumber),
               let position = Int(name[name.index(after: name.startIndex)..<sIndex]) {
                let rest = String(name[name.index(after: sIndex)...])
                if rest == ".m3u8" {
                    guard let playlist = current.audioLoPlaylist(position: position) else { return .notFound }
                    return .data(Data(playlist.utf8), contentType: m3u8)
                }
                if rest == "-init.mp4" {
                    return current.audioLoInitResponse(position: position)
                }
                if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"),
                   let n = Int(rest.dropFirst(4).dropLast(4)) {
                    return current.audioLoSegmentResponse(position: position, n: n)
                }
            }

            // Alternate audio renditions: "aN.m3u8", "aN-init.mp4",
            // "aN-seg{index}.m4s".
            if name.hasPrefix("a"), let split = name.firstIndex(where: { $0 == "-" || $0 == "." }) {
                let prefix = String(name[name.startIndex..<split])
                guard prefix.count > 1, prefix.dropFirst().allSatisfy(\.isNumber) else { return .notFound }
                let rest = String(name[split...])
                if rest == ".m3u8" {
                    return .data(Data(current.mediaPlaylist(prefix: prefix).utf8), contentType: m3u8)
                }
                if rest == "-init.mp4" {
                    return current.initResponse(prefix: prefix)
                }
                if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"),
                   let n = Int(rest.dropFirst(4).dropLast(4)) {
                    return current.segmentResponse(n, prefix: prefix)
                }
            }
            return .notFound
        }
    }

    /// The time in "frame-{ms}.jpg"; the path carries it because the server strips queries.
    private static func frameMilliseconds(_ name: String) -> Int64? {
        guard name.hasPrefix("frame-"), name.hasSuffix(".jpg") else { return nil }
        return Int64(name.dropFirst(6).dropLast(4))
    }

    // MARK: - Bridge API

    /// Start a remux session. Config keys:
    ///   inputUrl: String           — Jellyfin /stream?Static=true URL
    ///   audioTracks: [{index, name, language}] — preferred track first (the
    ///                                JS caller sorts: user selection, else
    ///                                Jellyfin default; position 0 becomes
    ///                                DEFAULT=YES); empty means "pick the best
    ///                                audio stream"
    ///   durationSeconds: Double    — item runtime from Jellyfin metadata
    ///   subtitles: [{index, name, language, vttUrl, isDefault, isForced}]
    ///   videoRange: String?        — HLS VIDEO-RANGE ("SDR"/"PQ"/"HLG");
    ///                                required for HDR content or AVFoundation
    ///                                rejects the variant (-12927)
    ///   codecs: String?            — RFC 6381 CODECS; empty omits the attribute
    ///   supplementalCodecs: String?: Dolby Vision SUPPLEMENTAL-CODECS, empty omits
    ///   width/height: Int?         — source video size, for RESOLUTION
    ///   frameRate: Double?         — source frame rate, for FRAME-RATE
    ///   bandwidth: Int?            — video plus served audio bit rate, for
    ///                                BANDWIDTH and AVERAGE-BANDWIDTH
    ///
    /// Everything after durationSeconds comes from Jellyfin's metadata rather
    /// than from the file, because the master playlist is written before FFmpeg
    /// has opened the input.
    /// Resolves with the local master playlist URL for AVPlayer.
    @objc func startRemux(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let inputUrl = config["inputUrl"] as? String,
              let duration = config["durationSeconds"] as? Double, duration > 0 else {
            reject("invalid_config", "startRemux needs inputUrl and a positive durationSeconds", nil)
            return
        }

        let audioTracks: [RemuxAudioTrack] = ((config["audioTracks"] as? [[String: Any]]) ?? []).compactMap { raw in
            guard let index = raw["index"] as? Int else { return nil }
            return RemuxAudioTrack(
                index: index,
                name: raw["name"] as? String ?? "Audio \(index)",
                language: raw["language"] as? String ?? "",
                serverAudioUrl: raw["serverAudioUrl"] as? String ?? ""
            )
        }
        let subtitles: [RemuxSubtitle] = ((config["subtitles"] as? [[String: Any]]) ?? []).compactMap { raw in
            guard let index = raw["index"] as? Int else { return nil }
            let isImage = raw["isImage"] as? Bool ?? false
            // A text track without a Jellyfin URL has nothing to serve. An image
            // track never has one — its bitmaps come out of the source file.
            let localVtt = raw["localVtt"] as? String ?? ""
            guard let vttUrl = raw["vttUrl"] as? String, isImage || !vttUrl.isEmpty || !localVtt.isEmpty else { return nil }
            return RemuxSubtitle(
                index: index,
                name: raw["name"] as? String ?? "Subtitle \(index)",
                language: raw["language"] as? String ?? "",
                vttUrl: vttUrl,
                localVtt: localVtt,
                isDefault: raw["isDefault"] as? Bool ?? false,
                isForced: raw["isForced"] as? Bool ?? false,
                isImage: isImage
            )
        }

        Self.lock.lock()
        defer { Self.lock.unlock() }

        // Evict only past the cap, and oldest first. A new start no longer
        // stops the session a still-mounted player is reading from.
        while Self.sessionOrder.count >= Self.maxSessions, let oldest = Self.sessionOrder.first {
            Self.sessionOrder.removeFirst()
            Self.sessions.removeValue(forKey: oldest)?.stop()
            NSLog("[LocalRemuxer] evicted session %@ (cap %d)", oldest, Self.maxSessions)
        }
        Self.lastPlan = nil
        RemuxSession.sweepOrphans(keeping: Set(Self.sessions.keys).union(Self.frameProviders.keys))

        do {
            let port = try Self.ensureServer()

            let session = try RemuxSession(config: RemuxConfig(
                inputUrl: inputUrl,
                audioTracks: audioTracks,
                durationSeconds: duration,
                subtitles: subtitles,
                videoRange: (config["videoRange"] as? String) ?? "SDR",
                supplementalCodecs: (config["supplementalCodecs"] as? String) ?? "",
                codecs: (config["codecs"] as? String) ?? "",
                width: (config["width"] as? Int) ?? 0,
                height: (config["height"] as? Int) ?? 0,
                frameRate: (config["frameRate"] as? Double) ?? 0,
                bandwidth: (config["bandwidth"] as? Int) ?? 0,
                readAheadSegments: (config["readAheadSegments"] as? Int) ?? 0,
                tierPlaylistUrl: config["tierPlaylistUrl"] as? String,
                tierBandwidth: (config["tierBandwidth"] as? Int) ?? 0,
                tierCodecs: (config["tierCodecs"] as? String) ?? "",
                tierWidth: (config["tierWidth"] as? Int) ?? 0,
                tierHeight: (config["tierHeight"] as? Int) ?? 0,
                tierFirst: (config["tierFirst"] as? Bool) ?? false,
                startOffsetSeconds: (config["startOffsetSeconds"] as? Double) ?? 0,
                itemId: (config["itemId"] as? String) ?? ""
            ))
            session.onPlan = { [weak self] plan in self?.publish(plan: plan) }
            session.onThroughput = { [weak self] sample in self?.publish(throughput: sample) }
            session.start()
            Self.sessions[session.token] = session
            Self.sessionOrder.append(session.token)

            NSLog("[LocalRemuxer] Session started on 127.0.0.1:%d (%d segments)", port, session.segmentCount)
            resolve("http://127.0.0.1:\(port)/\(session.token)/master.m3u8")
        } catch {
            reject("start_failed", "Failed to start remux session: \(error.localizedDescription)", error)
        }
    }

    enum ServerError: Error { case noPort }

    /// Loopback server, started on demand. Call with `Self.lock` held.
    ///
    /// A dead listener (the OS tears the socket down on app suspension) means
    /// every session URL points at a port nobody answers: the player fails
    /// with -1004 and the engine looks broken until relaunch. The sessions
    /// and shims embed that port in their URLs, so they die with it.
    ///
    /// Reuse is decided by asking the server whether it still answers, not by asking whether
    /// anything told us it stopped. Nothing does: the socket the OS reclaims is announced by
    /// no state transition, and a listener that reached `.ready` never reports its way back.
    private static func ensureServer() throws -> UInt16 {
        if let server, let port = reusablePort(of: server) { return port }

        // Bound before anything is torn down. The old sessions are unreachable either way, but
        // a bind that throws here used to take them with it and leave no server behind: a
        // second player reading its own session lost it to another player's failed start.
        let fresh = LocalHTTPServer(route: route)
        let freshPort = try fresh.start()

        if let server {
            NSLog("[LocalRemuxer] loopback server no longer answers, replacing it")
            server.stop()
            for (token, session) in sessions {
                session.stop()
                NSLog("[LocalRemuxer] dropped session %@ (dead server port)", token)
            }
            sessions.removeAll()
            sessionOrder.removeAll()
            shims.removeAll()
            shimOrder.removeAll()
            for provider in frameProviders.values { provider.stop() }
            frameProviders.removeAll()
            frameOrder.removeAll()
        }

        server = fresh
        return freshPort
    }

    /// The port of a server still worth handing out, or nil when it has to be replaced.
    private static func reusablePort(of server: LocalHTTPServer) -> UInt16? {
        guard server.isListening, server.answers() else { return nil }
        return server.port
    }

    /// Starts a playlist shim (PlaylistShim.swift): the server transcode's
    /// playlists re-served through the loopback with EXT-X-START injected so
    /// AVPlayer opens the stream AT the resume point instead of buffering
    /// position zero and seeking away from it. Resolves with the local master
    /// URL; the path's token stops it.
    @objc func startPlaylistShim(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let raw = config["masterUrl"] as? String, let masterUrl = URL(string: raw),
              let offset = config["startOffsetSeconds"] as? Double, offset > 0 else {
            reject("invalid_config", "startPlaylistShim needs masterUrl and a positive startOffsetSeconds", nil)
            return
        }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        while Self.shimOrder.count >= Self.maxShims, let oldest = Self.shimOrder.first {
            Self.shimOrder.removeFirst()
            Self.shims.removeValue(forKey: oldest)
        }
        do {
            let port = try Self.ensureServer()
            let shim = PlaylistShim(masterUrl: masterUrl, startOffsetSeconds: offset)
            Self.shims[shim.token] = shim
            Self.shimOrder.append(shim.token)
            NSLog("[LocalRemuxer] Playlist shim started (offset %.1fs)", offset)
            resolve("http://127.0.0.1:\(port)/\(shim.token)/master.m3u8")
        } catch {
            reject("start_failed", "Failed to start playlist shim: \(error.localizedDescription)", error)
        }
    }

    @objc func stopPlaylistShim(
        _ token: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = token as String
        Self.lock.lock()
        Self.shims.removeValue(forKey: key)
        Self.shimOrder.removeAll { $0 == key }
        Self.lock.unlock()
        resolve(nil)
    }

    /// Starts a frame provider (FrameGrabber.swift) over `inputUrl`, the original file,
    /// for a player that runs no remux session. `itemId` keys the frame pool. Resolves with
    /// the base URL under which `frame-{ms}.jpg` answers; the path's token stops it.
    @objc func startFrameProvider(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let inputUrl = config["inputUrl"] as? String, !inputUrl.isEmpty else {
            reject("invalid_config", "startFrameProvider needs inputUrl", nil)
            return
        }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        while Self.frameOrder.count >= Self.maxFrameProviders, let oldest = Self.frameOrder.first {
            Self.frameOrder.removeFirst()
            Self.frameProviders.removeValue(forKey: oldest)?.stop()
        }
        do {
            let port = try Self.ensureServer()
            let provider = try FrameProvider(inputUrl: inputUrl, itemId: (config["itemId"] as? String) ?? "")
            Self.frameProviders[provider.token] = provider
            Self.frameOrder.append(provider.token)
            resolve("http://127.0.0.1:\(port)/\(provider.token)/")
        } catch {
            reject("start_failed", "Failed to start frame provider: \(error.localizedDescription)", error)
        }
    }

    @objc func stopFrameProvider(
        _ token: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = token as String
        Self.lock.lock()
        let provider = Self.frameProviders.removeValue(forKey: key)
        Self.frameOrder.removeAll { $0 == key }
        Self.lock.unlock()
        // Outside the lock: stop() waits on no one, but it deletes a directory.
        provider?.stop()
        resolve(nil)
    }

    /// A keyframe as the poster for an item without artwork. Config: itemId, inputUrl, and
    /// seconds into the file. Resolves `{uri}` with a file URL, or a null uri with
    /// `cancelled` set when the card withdrew before its turn.
    @objc func posterFrame(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let itemId = config["itemId"] as? String, !itemId.isEmpty,
              let inputUrl = config["inputUrl"] as? String, !inputUrl.isEmpty else {
            reject("invalid_config", "posterFrame needs itemId and inputUrl", nil)
            return
        }
        let seconds = max(0, (config["seconds"] as? Double) ?? 10)
        Self.posters.request(itemId: itemId, inputUrl: inputUrl, milliseconds: Int64(seconds * 1000)) { outcome in
            switch outcome {
            case .poster(let url, let fresh): resolve(["uri": url.absoluteString, "cancelled": false, "fresh": fresh])
            case .none: resolve(["uri": NSNull(), "cancelled": false])
            case .cancelled: resolve(["uri": NSNull(), "cancelled": true])
            }
        }
    }

    @objc func cancelPosterFrame(
        _ itemId: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Self.posters.cancel(itemId: itemId as String)
        resolve(nil)
    }

    /// Empties the frame pool. Item ids repeat across servers, so a switch of server or
    /// account must leave no frame behind to answer for the next one's item of the same id.
    @objc func clearFramePool(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        ChapterFramePool.purge()
        resolve(nil)
    }

    /// Stops the session identified by `token` (the path segment of the master URL
    /// startRemux resolved). Ownership guard: a caller can only stop the session it
    /// started — a late teardown from a replaced player must not kill a session a
    /// newer player owns.
    @objc func stopRemux(
        _ token: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = token as String
        Self.lock.lock()
        let session = Self.sessions.removeValue(forKey: key)
        Self.sessionOrder.removeAll { $0 == key }
        Self.lock.unlock()
        // Outside the lock: stop() removes the session's directory, and there is
        // no reason to hold up a request for another session while it does.
        session?.stop()
        resolve(nil)
    }

    /// Cancellation flags for repackages in flight, keyed by item id.
    private static var repackCancels: Set<String> = []

    /// Rewraps a finished download into MP4 so it direct-plays. Resolves either way:
    /// `repackaged: false` carries the reason and leaves the source file alone, which
    /// is the item continuing to play through the engine exactly as before.
    @objc func repackageDownload(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let itemId = config["itemId"] as? String,
              let inputPath = config["inputPath"] as? String,
              let outputPath = config["outputPath"] as? String else {
            reject("invalid_config", "repackageDownload needs itemId, inputPath and outputPath", nil)
            return
        }

        Self.lock.lock()
        Self.repackCancels.remove(itemId)
        Self.lock.unlock()

        // iOS suspends the app a few seconds after it leaves the screen, which would freeze
        // the pipeline thread mid-file. The assertion buys the pass a window to finish in;
        // when it runs out the run is cancelled and the download heals on a later launch.
        var backgroundTask = UIBackgroundTaskIdentifier.invalid
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "repackage-\(itemId)") {
            Self.lock.lock()
            Self.repackCancels.insert(itemId)
            Self.lock.unlock()
            NSLog("[DownloadRepackager] %@ ran out of background time, cancelling", itemId)
        }
        let endBackgroundTask = {
            guard backgroundTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }

        DispatchQueue.global(qos: .utility).async {
            let started = CFAbsoluteTimeGetCurrent()
            do {
                let report = try DownloadRepackager.run(
                    inputPath: inputPath,
                    outputPath: outputPath,
                    isCancelled: {
                        Self.lock.lock()
                        defer { Self.lock.unlock() }
                        return Self.repackCancels.contains(itemId)
                    },
                    progress: { _ in }
                )
                let elapsed = CFAbsoluteTimeGetCurrent() - started
                NSLog("[DownloadRepackager] %@ repackaged in %.2fs (%d subtitle tracks)",
                      itemId, elapsed, report.subtitleStreamIndices.count)
                resolve([
                    "repackaged": true,
                    "subtitleStreamIndices": report.subtitleStreamIndices,
                    "imageSubtitleIndices": report.imageSubtitleIndices,
                    "droppedAudioIndices": report.droppedAudioIndices,
                    "durationSeconds": report.durationSeconds,
                    "elapsedSeconds": elapsed,
                ])
            } catch let failure as DownloadRepackager.Failure {
                try? FileManager.default.removeItem(atPath: outputPath)
                switch failure {
                case .declined(let reason, let permanent):
                    NSLog("[DownloadRepackager] %@ declined%@: %@", itemId, permanent ? " for good" : "", reason)
                    resolve(["repackaged": false, "reason": reason, "permanent": permanent])
                case .failed(let reason):
                    NSLog("[DownloadRepackager] %@ failed: %@", itemId, reason)
                    resolve(["repackaged": false, "reason": reason, "failed": true, "permanent": false])
                }
            } catch {
                try? FileManager.default.removeItem(atPath: outputPath)
                resolve(["repackaged": false, "reason": error.localizedDescription, "failed": true, "permanent": false])
            }
            Self.lock.lock()
            Self.repackCancels.remove(itemId)
            Self.lock.unlock()
            endBackgroundTask()
        }
    }

    /// Aborts a repackage in flight; the half-written output is removed by the run itself.
    @objc func cancelRepackage(
        _ itemId: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Self.lock.lock()
        Self.repackCancels.insert(itemId as String)
        Self.lock.unlock()
        resolve(nil)
    }

    /// AV1 gets remuxed only where AVPlayer can hardware-decode it
    /// (A17 Pro / M3 and newer; false on every Apple TV).
    @objc func isAV1HardwareDecodeSupported(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // 'av01' fourcc literal keeps this compiling on SDKs where the
        // kCMVideoCodecType_AV1 constant is unavailable.
        resolve(VTIsHardwareDecodeSupported(0x6176_3031))
    }

    /// Throughput of the software-decode lane on this hardware (app/dev-bench.tsx).
    /// Blocks a global queue for `wallSeconds`; never called by playback.
    @objc func benchmarkTranscode(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let inputUrl = config["inputUrl"] as? String else {
            reject("invalid_config", "benchmarkTranscode needs inputUrl", nil)
            return
        }
        let wallSeconds = config["wallSeconds"] as? Double ?? 45
        let encode = config["encode"] as? Bool ?? true
        DispatchQueue.global(qos: .userInitiated).async {
            var result = VideoTranscoder.benchmark(inputUrl: inputUrl, wallSeconds: wallSeconds, encode: encode)
            var system = utsname()
            uname(&system)
            result["device"] = withUnsafePointer(to: &system.machine) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
            }
            #if DEBUG
            result["build"] = "debug"
            #else
            result["build"] = "release"
            #endif
            result["cores"] = ProcessInfo.processInfo.activeProcessorCount
            resolve(result)
        }
    }
}
