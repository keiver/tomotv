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
    card.install(in: host, cover: navigationBarBottom())
  }

  /// The bottom edge of the navigation bar at the top of the app's frontmost screen, if one shows.
  private func navigationBarBottom() -> CGFloat? {
    #if os(iOS)
      guard let scene = windowScene,
        let app = scene.windows.first(where: { $0 !== self && $0.isKeyWindow }) ?? scene.windows.first(where: { $0 !== self && !$0.isHidden }),
        var top = app.rootViewController
      else { return nil }
      while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
      guard let root = top.viewIfLoaded else { return nil }
      let edge = app.safeAreaInsets.top + 1
      var bottom: CGFloat?
      func visit(_ view: UIView) {
        guard !view.isHidden, view.alpha > 0.01 else { return }
        if let bar = view as? UINavigationBar {
          let frame = bar.convert(bar.bounds, to: app)
          if frame.minY <= edge, frame.height > 0 { bottom = max(bottom ?? 0, frame.maxY) }
          return
        }
        view.subviews.forEach(visit)
      }
      visit(root)
      return bottom
    #else
      return nil
    #endif
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
