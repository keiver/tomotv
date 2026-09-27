import UIKit

enum ToastKind: String {
  case info, success, error
}

enum ToastEdge: String {
  case top, bottom

  /// iOS hangs from the top; tvOS keeps the top for its tab bar.
  static var platform: ToastEdge {
    #if os(tvOS)
      return .bottom
    #else
      return .top
    #endif
  }
}

enum ToastDismissReason: String {
  case timeout, swipe, close, replaced, api
}

struct ToastModel {
  var id: String
  var title: String
  var message: String?
  var kind: ToastKind
  var icon: String?
  var progress: Bool
  var duration: TimeInterval
  var edge: ToastEdge
}

struct ToastTheme {
  var tint = UIColor(red: 1, green: 195 / 255, blue: 18 / 255, alpha: 1)
  var text = UIColor(red: 43 / 255, green: 31 / 255, blue: 5 / 255, alpha: 1)
  var danger = UIColor(red: 215 / 255, green: 0, blue: 21 / 255, alpha: 1)
  var heightRatio: CGFloat = 0.3
  var closeLabel = "Close"
}

/// One card on screen at a time, the rest wait in order. Main thread only.
final class ToastCenter: NSObject {
  static let shared = ToastCenter()
  private static let maxPending = 3

  var theme = ToastTheme()
  var emit: ((String, [String: Any?]) -> Void)?
  var emitOwner: ObjectIdentifier?

  private var pending: [ToastModel] = []
  private var window: ToastWindow?
  private var card: ToastCardView?
  private var leaving = false

  override private init() {
    super.init()
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(sceneWillDeactivate), name: UIScene.willDeactivateNotification, object: nil)
    center.addObserver(self, selector: #selector(sceneDidActivate), name: UIScene.didActivateNotification, object: nil)
  }

  func show(_ model: ToastModel) {
    if let card, !leaving, card.model.id == model.id {
      card.apply(model)
      return
    }
    if let index = pending.firstIndex(where: { $0.id == model.id }) {
      pending[index] = model
      return
    }
    pending.append(model)
    while pending.count > Self.maxPending {
      emitDismiss(pending.removeFirst().id, .replaced)
    }
    pump()
  }

  func dismiss(id: String, reason: ToastDismissReason) {
    if let card, card.model.id == id {
      retire(card, reason)
    } else if let index = pending.firstIndex(where: { $0.id == id }) {
      pending.remove(at: index)
      emitDismiss(id, reason)
    }
  }

  func dismissAll() {
    let dropped = pending
    pending.removeAll()
    dropped.forEach { emitDismiss($0.id, .api) }
    if let card { retire(card, .api) }
  }

  private var activeScene: UIWindowScene? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
  }

  // Held while no scene is foreground active (screensaver, app switcher), drained on activation.
  private func pump() {
    guard card == nil, !pending.isEmpty, let scene = activeScene else { return }
    let model = pending.removeFirst()
    let window = self.window ?? ToastWindow(windowScene: scene)
    if window.windowScene !== scene { window.windowScene = scene }
    self.window = window
    window.isHidden = false

    let card = ToastCardView(model: model, theme: theme)
    card.onFinish = { [weak self, weak card] reason in
      guard let self, let card else { return }
      self.retire(card, reason)
    }
    self.card = card
    window.present(card)
    emit?("onShow", ["id": model.id])
  }

  private func retire(_ card: ToastCardView, _ reason: ToastDismissReason) {
    guard self.card === card, !leaving else { return }
    leaving = true
    card.leave { [weak self] in
      card.removeFromSuperview()
      guard let self else { return }
      self.card = nil
      self.leaving = false
      self.emitDismiss(card.model.id, reason)
      if self.pending.isEmpty {
        self.window?.isHidden = true
      } else {
        self.pump()
      }
    }
  }

  private func emitDismiss(_ id: String, _ reason: ToastDismissReason) {
    emit?("onDismiss", ["id": id, "reason": reason.rawValue])
  }

  @objc private func sceneWillDeactivate(_ note: Notification) {
    NSLog("[TomoToast] scene will deactivate")
    card?.setPaused(true, for: .scene)
  }

  @objc private func sceneDidActivate(_ note: Notification) {
    NSLog("[TomoToast] scene did activate")
    card?.setPaused(false, for: .scene)
    pump()
  }
}
