import UIKit

#if os(tvOS)
  private let isTV = true
#else
  private let isTV = false
#endif

private enum Metrics {
  static let radius: CGFloat = isTV ? 40 : 30
  static let padding: CGFloat = isTV ? 44 : 20
  static let spacing: CGFloat = isTV ? 32 : 16
  static let iconSize: CGFloat = isTV ? 64 : 40
  static let barHeight: CGFloat = isTV ? 8 : 5
  static let closeSize: CGFloat = 44
  /// Gold past the screen edge, so a spring overshoot or a downward drag never opens a gap.
  static let overscroll: CGFloat = 240
}

enum ToastPauseReason {
  case touch, scene, voiceOver
}

/// The gold card, flush to the side edges and its screen edge (bottom on tvOS, top on iOS): icon,
/// title, message, and a lifetime bar on the inner edge that drains to dismissal. iOS adds a close
/// button and swipe-up dismissal. Progress cards fill the bar instead and wait.
final class ToastCardView: UIView {
  private(set) var model: ToastModel
  var onFinish: ((ToastDismissReason) -> Void)?

  private let theme: ToastTheme
  private let surface = UIView()
  private let iconHost = UIView()
  private let iconView = UIImageView()
  private let spinner = UIActivityIndicatorView(style: isTV ? .large : .medium)
  private let titleLabel = UILabel()
  private let messageLabel = UILabel()
  private let textStack = UIStackView()
  private let bar = ToastLifetimeBar()
  #if os(iOS)
    private lazy var closeButton = makeCloseButton()
  #endif
  private var lifetime: UIViewPropertyAnimator?
  private var pauses = Set<ToastPauseReason>()

  init(model: ToastModel, theme: ToastTheme) {
    self.model = model
    self.theme = theme
    super.init(frame: .zero)
    build()
    render()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  // MARK: Layout

  private func build() {
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.4
    layer.shadowRadius = isTV ? 30 : 18
    layer.shadowOffset = CGSize(width: 0, height: isTV ? -10 : 8)

    surface.translatesAutoresizingMaskIntoConstraints = false
    surface.backgroundColor = theme.tint
    surface.layer.cornerRadius = Metrics.radius
    surface.layer.cornerCurve = .continuous
    surface.layer.maskedCorners = isTV
      ? [.layerMinXMinYCorner, .layerMaxXMinYCorner]
      : [.layerMinXMaxYCorner, .layerMaxXMaxYCorner]
    surface.clipsToBounds = true
    addSubview(surface)

    iconHost.translatesAutoresizingMaskIntoConstraints = false
    iconView.translatesAutoresizingMaskIntoConstraints = false
    iconView.contentMode = .scaleAspectFit
    iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: Metrics.iconSize * 0.8, weight: .semibold)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.color = theme.text
    spinner.hidesWhenStopped = true
    iconHost.addSubview(iconView)
    iconHost.addSubview(spinner)

    titleLabel.textColor = theme.text
    titleLabel.numberOfLines = 2
    messageLabel.textColor = theme.text.withAlphaComponent(0.78)
    messageLabel.numberOfLines = 3
    #if os(tvOS)
      titleLabel.font = .systemFont(ofSize: 38, weight: .bold)
      messageLabel.font = .systemFont(ofSize: 29, weight: .medium)
    #else
      titleLabel.font = ToastCardView.scaled(.title3, bold: true)
      messageLabel.font = ToastCardView.scaled(.subheadline, bold: false)
      titleLabel.adjustsFontForContentSizeCategory = true
      messageLabel.adjustsFontForContentSizeCategory = true
    #endif
    textStack.axis = .vertical
    textStack.spacing = isTV ? 8 : 4
    textStack.addArrangedSubview(titleLabel)
    textStack.addArrangedSubview(messageLabel)
    textStack.translatesAutoresizingMaskIntoConstraints = false

    bar.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(iconHost)
    surface.addSubview(textStack)
    surface.addSubview(bar)
    #if os(iOS)
      surface.addSubview(closeButton)
    #endif

    let outer = isTV
      ? surface.bottomAnchor.constraint(equalTo: bottomAnchor, constant: Metrics.overscroll)
      : surface.topAnchor.constraint(equalTo: topAnchor, constant: -Metrics.overscroll)
    let inner = isTV ? surface.topAnchor.constraint(equalTo: topAnchor) : surface.bottomAnchor.constraint(equalTo: bottomAnchor)
    let barEdge = isTV ? bar.topAnchor.constraint(equalTo: topAnchor) : bar.bottomAnchor.constraint(equalTo: bottomAnchor)
    NSLayoutConstraint.activate([
      surface.leadingAnchor.constraint(equalTo: leadingAnchor),
      surface.trailingAnchor.constraint(equalTo: trailingAnchor),
      outer,
      inner,

      iconHost.widthAnchor.constraint(equalToConstant: Metrics.iconSize),
      iconHost.heightAnchor.constraint(equalToConstant: Metrics.iconSize),
      iconHost.centerYAnchor.constraint(equalTo: textStack.centerYAnchor),
      iconView.topAnchor.constraint(equalTo: iconHost.topAnchor),
      iconView.bottomAnchor.constraint(equalTo: iconHost.bottomAnchor),
      iconView.leadingAnchor.constraint(equalTo: iconHost.leadingAnchor),
      iconView.trailingAnchor.constraint(equalTo: iconHost.trailingAnchor),
      spinner.centerXAnchor.constraint(equalTo: iconHost.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: iconHost.centerYAnchor),
      textStack.leadingAnchor.constraint(equalTo: iconHost.trailingAnchor, constant: Metrics.spacing),

      bar.leadingAnchor.constraint(equalTo: leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: trailingAnchor),
      barEdge,
      bar.heightAnchor.constraint(equalToConstant: Metrics.barHeight),
    ])

    #if os(iOS)
      isAccessibilityElement = true
      accessibilityTraits = .staticText
      accessibilityCustomActions = [
        UIAccessibilityCustomAction(name: theme.closeLabel) { [weak self] _ in
          self?.onFinish?(.close)
          return true
        },
      ]
      addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handlePan)))
    #endif
  }

  #if os(iOS)
    private static func scaled(_ style: UIFont.TextStyle, bold: Bool) -> UIFont {
      let base = UIFontDescriptor.preferredFontDescriptor(withTextStyle: style)
      let descriptor = bold ? base.withSymbolicTraits(.traitBold) ?? base : base
      return UIFont(descriptor: descriptor, size: 0)
    }

    private func makeCloseButton() -> UIButton {
      let button = UIButton(type: .system)
      button.translatesAutoresizingMaskIntoConstraints = false
      button.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .bold)), for: .normal)
      button.tintColor = theme.text.withAlphaComponent(0.6)
      button.accessibilityLabel = theme.closeLabel
      button.addAction(UIAction { [weak self] _ in self?.onFinish?(.close) }, for: .touchUpInside)
      return button
    }
  #endif

  /// Edge to edge, 30% of the window tall by default; the content keeps to the safe area.
  func install(in host: UIView) {
    translatesAutoresizingMaskIntoConstraints = false
    host.addSubview(self)
    let guide = host.safeAreaLayoutGuide
    // The band between the safe screen edge and the lifetime bar, where the content centres.
    let band = UILayoutGuide()
    addLayoutGuide(band)
    let height = heightAnchor.constraint(equalTo: host.heightAnchor, multiplier: theme.heightRatio)
    height.priority = .defaultHigh
    var trailing = guide.trailingAnchor
    #if os(iOS)
      NSLayoutConstraint.activate([
        closeButton.topAnchor.constraint(equalTo: band.topAnchor, constant: 4),
        closeButton.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -6),
        closeButton.widthAnchor.constraint(equalToConstant: Metrics.closeSize),
        closeButton.heightAnchor.constraint(equalToConstant: Metrics.closeSize),
      ])
      trailing = closeButton.leadingAnchor
    #endif
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: host.leadingAnchor),
      trailingAnchor.constraint(equalTo: host.trailingAnchor),
      isTV ? bottomAnchor.constraint(equalTo: host.bottomAnchor) : topAnchor.constraint(equalTo: host.topAnchor),
      height,

      band.topAnchor.constraint(equalTo: isTV ? bar.bottomAnchor : guide.topAnchor),
      band.bottomAnchor.constraint(equalTo: isTV ? guide.bottomAnchor : bar.topAnchor),

      iconHost.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: Metrics.padding),
      textStack.trailingAnchor.constraint(lessThanOrEqualTo: trailing, constant: isTV ? -Metrics.padding : -4),
      textStack.centerYAnchor.constraint(equalTo: band.centerYAnchor),
      textStack.topAnchor.constraint(greaterThanOrEqualTo: band.topAnchor, constant: Metrics.padding),
      textStack.bottomAnchor.constraint(lessThanOrEqualTo: band.bottomAnchor, constant: -Metrics.padding),
    ])
    host.layoutIfNeeded()
    enter()
  }

  // MARK: Content

  private func render() {
    titleLabel.text = model.title
    messageLabel.text = model.message
    messageLabel.isHidden = model.message == nil
    let accent = model.kind == .error ? theme.danger : theme.text
    iconView.tintColor = accent
    iconView.image = ToastCardView.symbol(model.icon) ?? ToastCardView.symbol(ToastCardView.defaultIcon(model.kind))
    bar.fillColor = model.kind == .error ? theme.danger : theme.text.withAlphaComponent(0.85)
    bar.trackColor = theme.text.withAlphaComponent(0.12)
    if model.progress {
      iconView.isHidden = true
      spinner.startAnimating()
    } else {
      iconView.isHidden = false
      spinner.stopAnimating()
    }
    accessibilityLabel = [model.title, model.message].compactMap { $0 }.joined(separator: ". ")
  }

  private static func defaultIcon(_ kind: ToastKind) -> String {
    switch kind {
    case .info: return "info.circle.fill"
    case .success: return "checkmark.circle.fill"
    case .error: return "exclamationmark.triangle.fill"
    }
  }

  private static func symbol(_ name: String?) -> UIImage? {
    guard let name, !name.isEmpty else { return nil }
    return UIImage(systemName: name)
  }

  /// Same id, same card: the text crossfades and a progress card resolves into its countdown.
  func apply(_ next: ToastModel) {
    let wasProgress = model.progress
    model = next
    UIView.transition(with: surface, duration: 0.25, options: [.transitionCrossDissolve, .allowUserInteraction]) {
      self.render()
    }
    if next.progress {
      if !wasProgress { startTrickle() }
    } else if wasProgress {
      resolve()
    } else {
      startLifetime()
    }
    announce()
  }

  // MARK: Lifetime

  private func startTrickle() {
    stopLifetime()
    bar.setFraction(0.08)
    UIView.animate(withDuration: 0.9, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
      self.bar.setFraction(0.9)
    }
  }

  private func resolve() {
    feedback()
    UIView.animate(withDuration: 0.14, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
      self.bar.setFraction(1)
    } completion: { _ in
      self.startLifetime()
    }
  }

  private func startLifetime() {
    stopLifetime()
    bar.setFraction(1)
    let animator = UIViewPropertyAnimator(duration: model.duration, curve: .linear) {
      self.bar.setFraction(0)
    }
    animator.isUserInteractionEnabled = true
    animator.addCompletion { [weak self] position in
      if position == .end { self?.onFinish?(.timeout) }
    }
    lifetime = animator
    if pauses.isEmpty {
      animator.startAnimation()
    } else {
      animator.pauseAnimation()
    }
  }

  private func stopLifetime() {
    guard let animator = lifetime else { return }
    lifetime = nil
    if animator.state == .active { animator.stopAnimation(true) }
  }

  func setPaused(_ paused: Bool, for reason: ToastPauseReason) {
    if paused {
      pauses.insert(reason)
    } else {
      pauses.remove(reason)
    }
    guard let animator = lifetime, animator.state == .active else { return }
    if pauses.isEmpty {
      animator.startAnimation()
    } else {
      animator.pauseAnimation()
    }
  }

  // MARK: Motion

  private var offscreen: CGAffineTransform {
    guard let host = superview else { return .identity }
    let distance = isTV ? host.bounds.height - frame.minY + 24 : -(frame.maxY + 24)
    return CGAffineTransform(translationX: 0, y: distance)
  }

  private func enter() {
    let begin: () -> Void = { [weak self] in
      guard let self else { return }
      if self.model.progress { self.startTrickle() } else { self.startLifetime() }
    }
    feedback()
    announce()
    if UIAccessibility.isReduceMotionEnabled {
      alpha = 0
      UIView.animate(withDuration: 0.25, delay: 0, options: [.allowUserInteraction], animations: { self.alpha = 1 }) { _ in begin() }
      return
    }
    transform = offscreen
    UIView.animate(withDuration: 0.6, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.3, options: [.allowUserInteraction]) {
      self.transform = .identity
    } completion: { _ in
      begin()
    }
  }

  func leave(_ completion: @escaping () -> Void) {
    stopLifetime()
    isUserInteractionEnabled = false
    if UIAccessibility.isReduceMotionEnabled {
      UIView.animate(withDuration: 0.2, animations: { self.alpha = 0 }) { _ in completion() }
      return
    }
    UIView.animate(withDuration: 0.32, delay: 0, options: [.curveEaseIn]) {
      self.transform = self.offscreen
    } completion: { _ in
      completion()
    }
  }

  private func feedback() {
    #if os(iOS)
      switch model.kind {
      case .success where !model.progress: UINotificationFeedbackGenerator().notificationOccurred(.success)
      case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
      default: break
      }
    #endif
  }

  private func announce() {
    UIAccessibility.post(notification: .announcement, argument: accessibilityLabel)
  }

  // MARK: Touch (iOS)

  #if os(iOS)
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
      super.touchesBegan(touches, with: event)
      setPaused(true, for: .touch)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
      super.touchesEnded(touches, with: event)
      setPaused(false, for: .touch)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
      super.touchesCancelled(touches, with: event)
      setPaused(false, for: .touch)
    }

    // Up follows the finger, down rubber-bands; a flick or 40% of the height up dismisses.
    @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
      let dy = pan.translation(in: superview).y
      switch pan.state {
      case .began:
        setPaused(true, for: .touch)
      case .changed:
        transform = CGAffineTransform(translationX: 0, y: dy < 0 ? dy : dy * 0.25)
      case .ended, .cancelled, .failed:
        let velocity = pan.velocity(in: superview).y
        if pan.state == .ended, velocity < -500 || dy < -bounds.height * 0.4 {
          onFinish?(.swipe)
          return
        }
        UIView.animate(withDuration: 0.45, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
          self.transform = .identity
        }
        setPaused(false, for: .touch)
      default:
        break
      }
    }

    override func accessibilityPerformEscape() -> Bool {
      onFinish?(.close)
      return true
    }

    override func accessibilityElementDidBecomeFocused() {
      setPaused(true, for: .voiceOver)
    }

    override func accessibilityElementDidLoseFocus() {
      setPaused(false, for: .voiceOver)
    }
  #endif
}

/// A track with a left-anchored fill; the fraction is laid out as a frame so a property animator can pause it.
private final class ToastLifetimeBar: UIView {
  private let fill = UIView()
  private var fraction: CGFloat = 1

  var fillColor: UIColor? {
    get { fill.backgroundColor }
    set { fill.backgroundColor = newValue }
  }

  var trackColor: UIColor? {
    get { backgroundColor }
    set { backgroundColor = newValue }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    addSubview(fill)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func setFraction(_ value: CGFloat) {
    fraction = min(1, max(0, value))
    setNeedsLayout()
    layoutIfNeeded()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    fill.frame = CGRect(x: 0, y: 0, width: bounds.width * fraction, height: bounds.height)
  }
}
