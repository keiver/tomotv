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
    override func supportedEvents() -> [String]! { ["onEnginePlan"] }

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

    // MARK: - Routing

    private static func route(_ path: String) -> LocalHTTPResponse {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 2 else { return .notFound }

        // The token in the path selects the session, so a player that is being
        // superseded keeps being served until it tears itself down.
        lock.lock()
        let current = sessions[parts[0]]
        lock.unlock()
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
            if name.hasPrefix("t1-seg"), name.hasSuffix(".m4s"),
               let n = Int(name.dropFirst(6).dropLast(4)) {
                return current.tierSegmentResponse(n)
            }
            if name.hasPrefix("seg"), name.hasSuffix(".m4s"),
               let n = Int(name.dropFirst(3).dropLast(4)) {
                return current.segmentResponse(n)
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
                language: raw["language"] as? String ?? ""
            )
        }
        let subtitles: [RemuxSubtitle] = ((config["subtitles"] as? [[String: Any]]) ?? []).compactMap { raw in
            guard let index = raw["index"] as? Int else { return nil }
            let isImage = raw["isImage"] as? Bool ?? false
            // A text track without a Jellyfin URL has nothing to serve. An image
            // track never has one — its bitmaps come out of the source file.
            guard let vttUrl = raw["vttUrl"] as? String, isImage || !vttUrl.isEmpty else { return nil }
            return RemuxSubtitle(
                index: index,
                name: raw["name"] as? String ?? "Subtitle \(index)",
                language: raw["language"] as? String ?? "",
                vttUrl: vttUrl,
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
        RemuxSession.sweepOrphans(keeping: Set(Self.sessions.keys))

        do {
            // A dead listener (the OS tears the socket down on app suspension)
            // means every session URL points at a port nobody answers: the player
            // fails with -1004 and the engine looks broken until relaunch. The
            // sessions embed that port in their URLs, so they die with it.
            if let server = Self.server, !server.isListening {
                NSLog("[LocalRemuxer] loopback listener is dead, restarting server")
                server.stop()
                Self.server = nil
                for (token, session) in Self.sessions {
                    session.stop()
                    NSLog("[LocalRemuxer] dropped session %@ (dead server port)", token)
                }
                Self.sessions.removeAll()
                Self.sessionOrder.removeAll()
            }
            if Self.server == nil {
                let server = LocalHTTPServer(route: Self.route)
                _ = try server.start()
                Self.server = server
            }
            guard let port = Self.server?.port else {
                reject("server_error", "Loopback server has no port", nil)
                return
            }

            let session = try RemuxSession(config: RemuxConfig(
                inputUrl: inputUrl,
                audioTracks: audioTracks,
                durationSeconds: duration,
                subtitles: subtitles,
                videoRange: (config["videoRange"] as? String) ?? "SDR",
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
                tierHeight: (config["tierHeight"] as? Int) ?? 0
            ))
            session.onPlan = { [weak self] plan in self?.publish(plan: plan) }
            session.start()
            Self.sessions[session.token] = session
            Self.sessionOrder.append(session.token)

            NSLog("[LocalRemuxer] Session started on 127.0.0.1:%d (%d segments)", port, session.segmentCount)
            resolve("http://127.0.0.1:\(port)/\(session.token)/master.m3u8")
        } catch {
            reject("start_failed", "Failed to start remux session: \(error.localizedDescription)", error)
        }
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
}
