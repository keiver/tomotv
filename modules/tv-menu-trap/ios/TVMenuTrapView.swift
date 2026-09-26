import ExpoModulesCore
import UIKit

/// An ancestor of the guide's lists: while armed it consumes the Menu press in the
/// responder chain before the navigation controller sees it, and reports it to JS.
final class TVMenuTrapView: ExpoView {
  let onMenuPress = EventDispatcher()
  var trapEnabled = false

  // Presses whose began was swallowed; their ended/cancelled are swallowed too.
  private var swallowed = Set<ObjectIdentifier>()

  private func hasMenuPress(_ presses: Set<UIPress>) -> Bool {
    presses.contains { $0.type == .menu }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if trapEnabled && hasMenuPress(presses) {
      presses.forEach { swallowed.insert(ObjectIdentifier($0)) }
      return
    }
    super.pressesBegan(presses, with: event)
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if presses.contains(where: { swallowed.contains(ObjectIdentifier($0)) }) {
      presses.forEach { swallowed.remove(ObjectIdentifier($0)) }
      onMenuPress()
      return
    }
    super.pressesEnded(presses, with: event)
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if presses.contains(where: { swallowed.contains(ObjectIdentifier($0)) }) {
      presses.forEach { swallowed.remove(ObjectIdentifier($0)) }
      return
    }
    super.pressesCancelled(presses, with: event)
  }
}
