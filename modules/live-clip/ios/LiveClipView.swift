import ExpoModulesCore
import UIKit

/// A channel card's preview: a host for the one shared preview player (SharedPreviewPlayer), holding its layer
/// while this card is the last to show one. A local clip loops; the engine's live session URL plays live.
final class LiveClipView: ExpoView {
  private var url: URL?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isUserInteractionEnabled = false
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    SharedPreviewPlayer.shared.layout(in: self)
  }

  // A card leaving the window (unmount included) hands the player back before it goes.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { SharedPreviewPlayer.shared.release(from: self) } else if url != nil { SharedPreviewPlayer.shared.show(url, in: self) }
  }

  func show(_ url: URL?) {
    self.url = url
    guard window != nil else { return }
    if url == nil { SharedPreviewPlayer.shared.release(from: self) } else { SharedPreviewPlayer.shared.show(url, in: self) }
  }
}
