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
import VideoToolbox

@objc(LocalRemuxer)
class LocalRemuxer: NSObject {

    private static let lock = NSLock()
    private static var session: RemuxSession?
    private static var server: LocalHTTPServer?

    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: - Routing

    private static func route(_ path: String) -> LocalHTTPResponse {
        lock.lock()
        let current = session
        lock.unlock()
        guard let current else { return .notFound }

        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 2, parts[0] == current.token else { return .notFound }
        let m3u8 = "application/vnd.apple.mpegurl"

        let name = parts[1]
        switch name {
        case "master.m3u8":
            return .data(Data(current.masterPlaylist().utf8), contentType: m3u8)
        case "media.m3u8":
            return .data(Data(current.mediaPlaylist().utf8), contentType: m3u8)
        case "init.mp4":
            guard let url = current.initSegmentURL() else { return .notFound }
            return .file(url, contentType: "video/mp4")
        default:
            if name.hasPrefix("sub"), name.hasSuffix(".m3u8"),
               let index = Int(name.dropFirst(3).dropLast(5)),
               let playlist = current.subtitlePlaylist(streamIndex: index) {
                return .data(Data(playlist.utf8), contentType: m3u8)
            }
            if name.hasPrefix("seg"), name.hasSuffix(".m4s"),
               let n = Int(name.dropFirst(3).dropLast(4)),
               let url = current.segmentURL(n) {
                return .file(url, contentType: "video/iso.segment")
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
                if rest == "-init.mp4", let url = current.initSegmentURL(prefix: prefix) {
                    return .file(url, contentType: "video/mp4")
                }
                if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"),
                   let n = Int(rest.dropFirst(4).dropLast(4)),
                   let url = current.segmentURL(n, prefix: prefix) {
                    return .file(url, contentType: "video/iso.segment")
                }
            }
            return .notFound
        }
    }

    // MARK: - Bridge API

    /// Start a remux session. Config keys:
    ///   inputUrl: String           — Jellyfin /stream?Static=true URL
    ///   audioTracks: [{index, name, language}] — default first (the JS caller
    ///                                sorts; position 0 becomes DEFAULT=YES);
    ///                                empty means "pick the best audio stream"
    ///   durationSeconds: Double    — item runtime from Jellyfin metadata
    ///   subtitles: [{index, name, language, vttUrl, isDefault, isForced}]
    ///   videoRange: String?        — HLS VIDEO-RANGE ("SDR"/"PQ"/"HLG");
    ///                                required for HDR content or AVFoundation
    ///                                rejects the variant (-12927)
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
            guard let index = raw["index"] as? Int, let vttUrl = raw["vttUrl"] as? String else { return nil }
            return RemuxSubtitle(
                index: index,
                name: raw["name"] as? String ?? "Subtitle \(index)",
                language: raw["language"] as? String ?? "",
                vttUrl: vttUrl,
                isDefault: raw["isDefault"] as? Bool ?? false,
                isForced: raw["isForced"] as? Bool ?? false
            )
        }

        Self.lock.lock()
        defer { Self.lock.unlock() }

        Self.session?.stop()
        Self.session = nil

        do {
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
                codecs: (config["codecs"] as? String) ?? ""
            ))
            session.start()
            Self.session = session

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
        Self.lock.lock()
        if let session = Self.session, session.token == token as String {
            session.stop()
            Self.session = nil
        }
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
}
