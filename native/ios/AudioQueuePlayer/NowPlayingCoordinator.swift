//
//  NowPlayingCoordinator.swift
//  TomoTV
//
//  Now Playing + remote command ownership for the audio queue player.
//
//  AVKit's automatic publishing path is not used: it drops the artist field and
//  cannot publish queue index/count, which is what makes the lock screen show
//  prev/next track buttons instead of seek buttons. So the module owns the whole
//  dictionary and publishes on state changes only — the system extrapolates
//  elapsed time from the last ElapsedPlaybackTime + PlaybackRate pair, so no
//  per-second updates are needed.
//
//  MPNowPlayingSession (tvOS 16.4 min target; iOS 16+) provides a
//  remote-command center isolated from MPRemoteCommandCenter.shared(), which
//  react-native-video's showNotificationControls path registers video targets
//  on. On iOS 15.x the shared center is used instead, and every target added
//  here is stored and removed on deactivate so the two publishers never fight
//  (they are never active at the same time — starting one player stops the
//  other).
//

import AVFoundation
import Foundation
import MediaPlayer
import UIKit

final class NowPlayingCoordinator {

    struct TrackInfo {
        let title: String
        let artist: String
        let album: String
        let duration: Double
        let queueIndex: Int
        let queueCount: Int
    }

    var onPlay: (() -> Void)?
    var onPause: (() -> Void)?
    var onToggle: (() -> Void)?
    var onNext: (() -> Void)?
    var onPrevious: (() -> Void)?
    var onSeek: ((Double) -> Void)?

    private var session: Any?
    private var sharedTargets: [(MPRemoteCommand, Any)] = []
    private var currentTrack: TrackInfo?
    private var artworkImage: UIImage?

    // MARK: - Lifecycle

    func activate(player: AVPlayer) {
        if #available(iOS 16.0, tvOS 16.0, *) {
            let nowPlayingSession = MPNowPlayingSession(players: [player])
            nowPlayingSession.automaticallyPublishesNowPlayingInfo = false
            registerCommands(on: nowPlayingSession.remoteCommandCenter)
            nowPlayingSession.becomeActiveIfPossible { _ in }
            session = nowPlayingSession
        } else {
            registerCommands(on: MPRemoteCommandCenter.shared())
        }
    }

    func deactivate() {
        // Shared-center targets must be removed one by one; leaving them behind
        // would swallow commands meant for the video player's publisher.
        for (command, target) in sharedTargets {
            command.removeTarget(target)
        }
        sharedTargets.removeAll()
        if session != nil {
            session = nil
        } else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        }
        currentTrack = nil
        artworkImage = nil
    }

    // MARK: - Publishing

    func updateTrack(_ info: TrackInfo, elapsed: Double, rate: Float) {
        currentTrack = info
        // Artwork belongs to the previous track until its download lands.
        artworkImage = nil
        publish(elapsed: elapsed, rate: rate)
    }

    func updatePlayback(elapsed: Double, rate: Float) {
        publish(elapsed: elapsed, rate: rate)
    }

    func setArtwork(_ image: UIImage, elapsed: Double, rate: Float) {
        artworkImage = image
        publish(elapsed: elapsed, rate: rate)
    }

    private func publish(elapsed: Double, rate: Float) {
        guard let track = currentTrack else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyPlaybackDuration: track.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: rate,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: track.queueIndex,
            MPNowPlayingInfoPropertyPlaybackQueueCount: track.queueCount,
        ]
        if !track.artist.isEmpty {
            info[MPMediaItemPropertyArtist] = track.artist
        }
        if !track.album.isEmpty {
            info[MPMediaItemPropertyAlbumTitle] = track.album
        }
        if let image = artworkImage {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        infoCenter.nowPlayingInfo = info
    }

    private var infoCenter: MPNowPlayingInfoCenter {
        if #available(iOS 16.0, tvOS 16.0, *), let nowPlayingSession = session as? MPNowPlayingSession {
            return nowPlayingSession.nowPlayingInfoCenter
        }
        return MPNowPlayingInfoCenter.default()
    }

    // MARK: - Commands

    private func registerCommands(on center: MPRemoteCommandCenter) {
        let isShared = center === MPRemoteCommandCenter.shared()

        func add(_ command: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            command.isEnabled = true
            let target = command.addTarget(handler: handler)
            if isShared {
                sharedTargets.append((command, target))
            }
        }

        add(center.playCommand) { [weak self] _ in
            self?.onPlay?()
            return .success
        }
        add(center.pauseCommand) { [weak self] _ in
            self?.onPause?()
            return .success
        }
        add(center.togglePlayPauseCommand) { [weak self] _ in
            self?.onToggle?()
            return .success
        }
        add(center.nextTrackCommand) { [weak self] _ in
            self?.onNext?()
            return .success
        }
        add(center.previousTrackCommand) { [weak self] _ in
            self?.onPrevious?()
            return .success
        }
        add(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.onSeek?(event.positionTime)
            return .success
        }
        // Music queue semantics: prev/next, not fixed-interval skips. Disabling
        // these keeps the lock screen from showing seek buttons over track
        // buttons.
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
    }
}
