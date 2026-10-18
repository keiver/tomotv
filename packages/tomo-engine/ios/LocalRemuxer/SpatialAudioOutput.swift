//
//  SpatialAudioOutput.swift
//  TomoTV
//
//  APAC alone leaves Apple TV's HDMI output in multichannel PCM; SpatialAudioBridge's
//  AtmosOutputActivator loops a silent Dolby Atmos stream beside it so the receiver switches.
//

import AVFoundation
import Foundation
import SpatialAudioPlayback

/// Follows the players of engine sessions: the library's AtmosOutputActivator plays beside a player
/// while its selected audio is spatial, except over AirPlay, which sends spatial tracks back to FLAC.
public enum SpatialAudioOutput {
    private struct Session {
        var names: Set<String>
        weak var session: RemuxSession?
    }

    private typealias Follower = (activator: AnyObject, airPlay: NSKeyValueObservation?)

    private static let lock = NSLock()
    /// Spatial rendition names per session token, as each master named them.
    private static var sessions: [String: Session] = [:]
    /// Players whose AirPlay receiver could not reach the loopback, by follow id.
    private static var external: Set<String> = []
    @MainActor private static var followers: [String: Follower] = [:]

    /// A player plays over AirPlay: no session converts until it stops.
    static var externalPlayback: Bool { lock.withLock { !external.isEmpty } }

    /// Follows `player` until `release(id:)`; call from any thread.
    public static func follow(_ player: AVPlayer, id: String) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard #available(macOS 26, iOS 26, tvOS 26, *) else { return }
                let activator = AtmosOutputActivator()
                #if os(tvOS)
                activator.attach(to: player) { playsSpatialAudio($0) }
                let airPlay: NSKeyValueObservation? = nil
                #else
                let airPlay = player.observe(\.isExternalPlaybackActive, options: [.initial, .new]) { player, _ in
                    let active = player.isExternalPlaybackActive
                    externalPlayback(active, id: id, item: player.currentItem)
                    DispatchQueue.main.async {
                        MainActor.assumeIsolated {
                            guard followers[id]?.activator === activator else { return }
                            if active { activator.detach() } else { activator.attach(to: player) { playsSpatialAudio($0) } }
                        }
                    }
                }
                #endif
                stop(followers.updateValue((activator, airPlay), forKey: id))
            }
        }
    }

    public static func release(id: String) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                stop(followers.removeValue(forKey: id))
                #if !os(tvOS)
                externalPlayback(false, id: id, item: nil)
                #endif
            }
        }
    }

    @MainActor private static func stop(_ follower: Follower?) {
        follower?.airPlay?.invalidate()
        guard #available(macOS 26, iOS 26, tvOS 26, *) else { return }
        (follower?.activator as? AtmosOutputActivator)?.detach()
    }

    /// An AirPlay receiver cannot reach the phone's loopback: a session playing spatial audio reopens as FLAC.
    static func externalPlayback(_ active: Bool, id: String, item: AVPlayerItem?) {
        let session: RemuxSession? = lock.withLock {
            if active { external.insert(id) } else { external.remove(id) }
            guard active, let url = (item?.asset as? AVURLAsset)?.url, url.pathComponents.count > 1 else { return nil }
            return sessions[url.pathComponents[1]]?.session
        }
        session?.withdrawSpatialAudio("AirPlay plays this item")
    }

    static func name(_ renditions: Set<String>, session: RemuxSession) {
        lock.withLock { sessions[session.token] = renditions.isEmpty ? nil : Session(names: renditions, session: session) }
    }

    static func forget(token: String) {
        _ = lock.withLock { sessions.removeValue(forKey: token) }
    }

    /// The item is an engine session whose selected audio option, named by its NAME, is spatial.
    /// The selection rather than the playing track, which lags a switch the activator re-checks on.
    static func playsSpatialAudio(_ item: AVPlayerItem) -> Bool {
        guard let url = (item.asset as? AVURLAsset)?.url, url.pathComponents.count > 1,
              let spatial = lock.withLock({ sessions[url.pathComponents[1]]?.names }),
              let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .audible),
              let option = item.currentMediaSelection.selectedMediaOption(in: group) else { return false }
        let title = AVMetadataItem.metadataItems(from: option.commonMetadata, filteredByIdentifier: .commonIdentifierTitle).first?.stringValue
        return title.map(spatial.contains) ?? false
    }
}
