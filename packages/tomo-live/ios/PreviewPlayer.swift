import AVFoundation
import UIKit

/// One channel card's preview player, lent out by PreviewPlayerPool. A clip loops with a hard cut at every seam, and a
/// newer one takes over at the next. One item, sought back to its start at each end: AVPlayerLooper's item churn logs
/// a CoreMedia line per seam and six per swap (measured), this logs none per seam. Muted, never external, never
/// keeping the display awake; the layer stays hidden until a frame is ready.
final class PreviewPlayer {
  private let player = AVPlayer()
  private let playerLayer = AVPlayerLayer()
  private var current: URL?
  private var pending: URL?
  private var readyObservation: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var itemObservation: NSKeyValueObservation?
  private var itemStatusObservation: NSKeyValueObservation?
  private(set) weak var host: UIView?
  /// The clip cannot play, with its AVError code: an item the decoder refused.
  var onFailure: ((PreviewPlayer, Int) -> Void)?

  init() {
    player.isMuted = true
    player.allowsExternalPlayback = false
    player.preventsDisplaySleepDuringVideoPlayback = false
    player.actionAtItemEnd = .none
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspectFill
    playerLayer.isHidden = true
    readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] observed, _ in
      guard observed.isReadyForDisplay else { return }
      DispatchQueue.main.async { self?.playerLayer.isHidden = false }
    }
    itemObservation = player.observe(\.currentItem, options: [.new]) { [weak self] observed, _ in
      DispatchQueue.main.async { self?.watch(observed.currentItem) }
    }
  }

  /// `view` takes the layer and plays `url`; the previous host is left showing its card underneath.
  func attach(to view: UIView, playing url: URL) {
    host = view
    // Hidden before it moves, so the new card never shows the last card's frame or an empty player.
    hide()
    playerLayer.removeFromSuperlayer()
    view.layer.addSublayer(playerLayer)
    layout(in: view)
    // A card that just took over starts its own clip at once, never on the last card's seam.
    start(url)
  }

  /// The host's newer clip takes over at the next seam.
  func show(_ url: URL) {
    guard url != current else {
      pending = nil
      return
    }
    if player.currentItem == nil { start(url) } else { pending = url }
  }

  /// Idle and off the card, ready for the next one.
  func detach() {
    host = nil
    hide()
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

  /// A hide is never animated: an implicit fade would paint the empty player black over the card.
  private func hide() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.isHidden = true
    CATransaction.commit()
  }

  private func watch(_ item: AVPlayerItem?) {
    itemStatusObservation = item?.observe(\.status, options: [.initial, .new]) { [weak self] observed, _ in
      guard observed.status == .failed else { return }
      let code = (observed.error as NSError?)?.code ?? 0
      DispatchQueue.main.async {
        guard let self, self.player.currentItem === observed else { return }
        self.onFailure?(self, code)
      }
    }
  }

  private func start(_ url: URL?) {
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = nil
    current = url
    pending = nil
    // A clip the sweep already took leaves the card on its frame. A swap on the same card stays visible: a hard cut.
    guard let url, FileManager.default.fileExists(atPath: url.path) else {
      player.replaceCurrentItem(with: nil)
      hide()
      return
    }
    let item = AVPlayerItem(url: url)
    player.replaceCurrentItem(with: item)
    // The seam: the newer clip takes over here, else the same item plays again from its start.
    endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
      guard let self, self.player.currentItem === item else { return }
      if let waiting = self.pending {
        self.start(waiting)
        return
      }
      self.player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
      self.player.play()
    }
    player.play()
  }
}
