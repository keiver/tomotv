import AVFoundation
import ExpoModulesCore
import UIKit

/// A channel card's preview clip: a local video-only file looped muted, a hard cut at every
/// seam. It never touches the audio session, AirPlay or display sleep, and stays hidden until
/// its first frame is ready. A newer clip takes over at the next seam.
final class LiveClipView: ExpoView {
  private let player = AVQueuePlayer()
  private let playerLayer = AVPlayerLayer()
  private var looper: AVPlayerLooper?
  private var current: URL?
  private var pending: URL?
  private var readyObservation: NSKeyValueObservation?
  private var loopObservation: NSKeyValueObservation?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isUserInteractionEnabled = false
    player.isMuted = true
    player.allowsExternalPlayback = false
    player.preventsDisplaySleepDuringVideoPlayback = false
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspectFill
    playerLayer.isHidden = true
    layer.addSublayer(playerLayer)
    readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] observed, _ in
      guard observed.isReadyForDisplay else { return }
      DispatchQueue.main.async { self?.playerLayer.isHidden = false }
    }
  }

  deinit {
    looper?.disableLooping()
    player.pause()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { player.pause() } else if looper != nil { player.play() }
  }

  /// The first clip starts at once; a later one waits for the running loop's seam.
  func show(_ url: URL?) {
    guard url != current else {
      pending = nil
      return
    }
    if looper == nil || url == nil { start(url) } else { pending = url }
  }

  private func start(_ url: URL?) {
    loopObservation = nil
    looper?.disableLooping()
    looper = nil
    player.removeAllItems()
    current = url
    pending = nil
    // A clip the sweep already took leaves the card on its frame.
    guard let url, !url.isFileURL || FileManager.default.fileExists(atPath: url.path) else {
      playerLayer.isHidden = true
      return
    }
    let next = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
    loopObservation = next.observe(\.loopCount, options: [.new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        guard let self, let waiting = self.pending else { return }
        self.start(waiting)
      }
    }
    looper = next
    if window != nil { player.play() }
    // The ready observer fires on a change only; a layer already showing a frame stays visible.
    if playerLayer.isReadyForDisplay { playerLayer.isHidden = false }
  }
}
