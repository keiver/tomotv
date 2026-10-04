import ExpoModulesCore
import UIKit

/// A channel card's preview: hosts a player from PreviewPlayerPool while its clip plays. Its clip loops.
final class LiveClipView: ExpoView {
  private(set) var url: URL?
  private var claim: DispatchWorkItem?
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
    if url == nil { release() } else { play() }
  }

  private func play() {
    claim?.cancel()
    claim = nil
    if Self.settle == 0 || PreviewPlayerPool.shared.hosts(self) {
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
