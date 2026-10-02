import AVFoundation
import UIKit

/// Lends preview players to the channel cards showing a clip: every card in view plays up to a ceiling, and a card
/// past it waits for the next player to free up.
final class PreviewPlayerPool {
  static let shared = PreviewPlayerPool()

  private struct Hosting {
    weak var view: LiveClipView?
    let player: PreviewPlayer
  }

  private struct Waiting {
    weak var view: LiveClipView?
  }

  #if os(tvOS)
  /// Above the 5 cards a guide screen shows; a decoder-busy failure lowers it on the device.
  private static let ceiling = 12
  #else
  /// Decoder busy (-11839) is reported at 16 players on iPhone; a Mac ran 48 card-sized 1080p clips in realtime.
  private static let ceiling = ProcessInfo.processInfo.isiOSAppOnMac ? 48 : 16
  #endif
  private var limit = ceiling
  private var hosting: [Hosting] = []
  private var idle: [PreviewPlayer] = []
  private var waiting: [Waiting] = []
  private var lowPower = false

  private init() {
    #if !os(tvOS)
    lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
      self?.setLowPower(ProcessInfo.processInfo.isLowPowerModeEnabled)
    }
    #endif
  }

  func hosts(_ view: LiveClipView) -> Bool {
    hosting.contains { $0.view === view }
  }

  func show(_ url: URL, in view: LiveClipView) {
    if let held = hosting.first(where: { $0.view === view }) {
      held.player.show(url)
      return
    }
    if let player = take() {
      lend(player, to: view, playing: url)
      return
    }
    if !waiting.contains(where: { $0.view === view }) {
      waiting.append(Waiting(view: view))
      NSLog("[LiveClip] %@", "waiting: \(hosting.count) of \(limit) playing\(lowPower ? ", low power" : "")")
    }
  }

  /// A card leaving the window or losing its clip hands its player to the next card waiting.
  func release(from view: LiveClipView) {
    waiting.removeAll { $0.view == nil || $0.view === view }
    guard let index = hosting.firstIndex(where: { $0.view === view }) else { return }
    free(at: index)
    grantWaiting()
  }

  func layout(in view: LiveClipView) {
    hosting.first { $0.view === view }?.player.layout(in: view)
  }

  private func take() -> PreviewPlayer? {
    hosting.removeAll { $0.view == nil }
    guard !lowPower, hosting.count < limit else { return nil }
    if let player = idle.popLast() { return player }
    let player = PreviewPlayer()
    player.onFailure = { [weak self] player, code in self?.failed(player, code: code) }
    return player
  }

  private func lend(_ player: PreviewPlayer, to view: LiveClipView, playing url: URL) {
    hosting.append(Hosting(view: view, player: player))
    player.attach(to: view, playing: url)
    NSLog("[LiveClip] %@", "playing \(hosting.count) of \(limit)")
  }

  private func free(at index: Int) {
    let player = hosting.remove(at: index).player
    player.detach()
    idle.append(player)
  }

  private func grantWaiting() {
    while !waiting.isEmpty {
      let next = waiting[0].view
      guard let view = next, view.window != nil, let url = view.url else {
        waiting.removeFirst()
        continue
      }
      guard let player = take() else { return }
      waiting.removeFirst()
      lend(player, to: view, playing: url)
    }
  }

  /// The failed card keeps its still frame; a busy decoder caps the pool at what was playing without it.
  private func failed(_ player: PreviewPlayer, code: Int) {
    guard let index = hosting.firstIndex(where: { $0.player === player }) else { return }
    free(at: index)
    if code == AVError.Code.decoderTemporarilyUnavailable.rawValue { limit = max(1, hosting.count) }
    NSLog("[LiveClip] %@", "clip failed \(code), \(hosting.count) playing, limit \(limit)")
    grantWaiting()
  }

  private func setLowPower(_ on: Bool) {
    guard on != lowPower else { return }
    lowPower = on
    NSLog("[LiveClip] %@", "low power \(on ? "on" : "off")")
    guard on else {
      grantWaiting()
      return
    }
    // Every card falls back to its frame and queues to play again once it ends.
    let views = hosting.compactMap { $0.view }
    while !hosting.isEmpty { free(at: hosting.count - 1) }
    waiting = views.map { Waiting(view: $0) } + waiting
  }
}
