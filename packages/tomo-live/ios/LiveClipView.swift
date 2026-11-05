import ExpoModulesCore
import UIKit

/// A channel card's preview: hosts a player from PreviewPlayerPool while its clip plays. Its clip loops. A live tile
/// plays its engine session instead, muted unless it has the sound, and can hold its last frame while its session is away.
final class LiveClipView: ExpoView {
  private(set) var url: URL?
  private(set) var live = false
  private(set) var muted = true
  private var frozen = false
  private var claim: DispatchWorkItem?
  let onFrozen = EventDispatcher()
  #if os(tvOS)
  private static let settle: TimeInterval = 0
  #else
  /// A card claims a player once it has rested in view this long, so a fling past it starts none.
  private static let settle: TimeInterval = 0.5
  #endif

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isUserInteractionEnabled = false
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    PreviewPlayerPool.shared.layout(in: self)
  }

  // A card leaving the window (unmount included) hands its player back before it goes.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { release() } else if url != nil { play() }
  }

  func show(_ url: URL?) {
    self.url = url
    guard window != nil else { return }
    // A frozen tile keeps its player, and the frame it holds, while its session is away.
    if url == nil {
      if !frozen { release() }
    } else {
      play()
    }
  }

  /// Props arrive in any order: a card that turns live after its player was lent takes a fresh one in live mode.
  func setLive(_ live: Bool) {
    guard live != self.live else { return }
    self.live = live
    guard window != nil, url != nil, PreviewPlayerPool.shared.hosts(self) else { return }
    release()
    play()
  }

  func setMuted(_ muted: Bool) {
    self.muted = muted
    PreviewPlayerPool.shared.player(in: self)?.setMuted(muted)
  }

  /// The tile holds its last frame, then says so; unfrozen with no session to show, it lets its player go.
  func setFrozen(_ frozen: Bool) {
    guard frozen != self.frozen else { return }
    self.frozen = frozen
    if frozen {
      let held = PreviewPlayerPool.shared.player(in: self)?.freeze() ?? false
      onFrozen(["held": held])
      return
    }
    // A new session's uri may arrive in the same update after this prop: judged once the update is applied.
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.frozen, self.url == nil else { return }
      self.release()
    }
  }

  private func play() {
    claim?.cancel()
    claim = nil
    if Self.settle == 0 || live || PreviewPlayerPool.shared.hosts(self) {
      if let url { PreviewPlayerPool.shared.show(url, in: self) }
      return
    }
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.window != nil, let url = self.url else { return }
      self.claim = nil
      PreviewPlayerPool.shared.show(url, in: self)
    }
    claim = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.settle, execute: work)
  }

  private func release() {
    claim?.cancel()
    claim = nil
    PreviewPlayerPool.shared.release(from: self)
  }
}
