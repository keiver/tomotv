import UIKit

/// Sits above everything the scene presents, AVKit included, and never becomes key. iOS lets
/// touches through everywhere but the card; tvOS takes none, which keeps it out of the focus engine.
final class ToastWindow: UIWindow {
  override init(windowScene: UIWindowScene) {
    super.init(windowScene: windowScene)
    windowLevel = .alert
    backgroundColor = .clear
    rootViewController = ToastRootController()
    #if os(tvOS)
      isUserInteractionEnabled = false
    #endif
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var canBecomeKey: Bool { false }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self || hit === rootViewController?.view ? nil : hit
  }

  func present(_ card: ToastCardView) {
    guard let host = rootViewController?.view else { return }
    card.install(in: host)
  }
}

private final class ToastRootController: UIViewController {
  override func loadView() {
    view = UIView()
    view.backgroundColor = .clear
  }

  #if os(iOS)
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }
  #endif
}
