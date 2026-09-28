import AVFoundation
import UIKit

/// The one player every channel card's preview plays through: the card that shows last hosts its layer, and a
/// focus move re-parents it instead of building a player per card. A local clip loops with a hard cut at every seam
/// (a newer one takes over at the next); any other URL (the engine's live session) plays straight, never looped.
/// Muted, never external, never keeping the display awake; the layer stays hidden until a frame is ready.
final class SharedPreviewPlayer {
  static let shared = SharedPreviewPlayer()

  private let player = AVQueuePlayer()
  private let playerLayer = AVPlayerLayer()
  private var looper: AVPlayerLooper?
  private var current: URL?
  private var pending: URL?
  private var readyObservation: NSKeyValueObservation?
  private var loopObservation: NSKeyValueObservation?
  private weak var host: UIView?

  private init() {
    player.isMuted = true
    player.allowsExternalPlayback = false
    player.preventsDisplaySleepDuringVideoPlayback = false
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspectFill
    playerLayer.isHidden = true
    readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] observed, _ in
      guard observed.isReadyForDisplay else { return }
      DispatchQueue.main.async { self?.playerLayer.isHidden = false }
    }
  }

  /// `view` takes the layer and plays `url`; the previous host is left showing its card underneath.
  func show(_ url: URL?, in view: UIView) {
    if host !== view {
      host = view
      playerLayer.removeFromSuperlayer()
      view.layer.addSublayer(playerLayer)
      layout(in: view)
      // A card that just took over starts its own clip at once, never on the last card's seam.
      start(url)
      return
    }
    guard url != current else {
      pending = nil
      return
    }
    if looper == nil || url == nil || url?.isFileURL != true { start(url) } else { pending = url }
  }

  /// A host leaving the window or unmounting lets the player go idle; another host's claim stands.
  func release(from view: UIView) {
    guard host === view else { return }
    host = nil
    start(nil)
    playerLayer.removeFromSuperlayer()
  }

  func layout(in view: UIView) {
    guard host === view else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = view.bounds
    CATransaction.commit()
  }

  private func start(_ url: URL?) {
    loopObservation = nil
    looper?.disableLooping()
    looper = nil
    player.removeAllItems()
    current = url
    pending = nil
    playerLayer.isHidden = true
    // A clip the sweep already took leaves the card on its frame.
    guard let url, !url.isFileURL || FileManager.default.fileExists(atPath: url.path) else { return }
    if url.isFileURL {
      let next = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
      loopObservation = next.observe(\.loopCount, options: [.new]) { [weak self] _, _ in
        DispatchQueue.main.async {
          guard let self, let waiting = self.pending else { return }
          self.start(waiting)
        }
      }
      looper = next
    } else {
      player.insert(AVPlayerItem(url: url), after: nil)
    }
    player.play()
  }
}
