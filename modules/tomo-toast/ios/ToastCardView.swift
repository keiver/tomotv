import UIKit

#if os(tvOS)
  private let isTV = true
#else
  private let isTV = false
#endif

private enum Metrics {
  /// The folder loading bar's strip: 8pt above and below one line of its title type.
  static let padding: CGFloat = 8
  static let inset: CGFloat = isTV ? 16 : 12
  static let iconGap: CGFloat = isTV ? 16 : 8
  static let textGap: CGFloat = isTV ? 14 : 8
  static let closeSize: CGFloat = 44
  /// Gold past the screen edge, so a spring overshoot or a drag away never opens a gap.
  static let overscroll: CGFloat = 240
}

enum ToastPauseReason {
  case touch, scene, voiceOver
}

/// A one-line gold strip the size of the folder loading bar, flush to the side edges and its
/// screen edge: icon, title, and a message that truncates first. A darker sweep behind the text
/// drains to dismissal (progress cards fill it instead and wait). iOS adds a close button and
/// a swipe toward the edge to dismiss.
final class ToastCardView: UIView {
  private(set) var model: ToastModel
  var onFinish: ((ToastDismissReason) -> Void)?

  private let theme: ToastTheme
  /// Fixed for the card's life; an in-place update keeps the edge it entered from.
  private let atTop: Bool
  private let surface = UIView()
  private let iconHost = UIView()
  private let iconView = UIImageView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let titleLabel = UILabel()
  private let messageLabel = UILabel()
  private let row = UIStackView()
  private let bar = ToastLifetimeBar()
  #if os(iOS)
    private lazy var closeButton = makeCloseButton()
  #endif
  private var lifetime: UIViewPropertyAnimator?
  private var pauses = Set<ToastPauseReason>()

  init(model: ToastModel, theme: ToastTheme) {
    self.model = model
    self.theme = theme
    atTop = model.edge == .top
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
    layer.shadowOpacity = 0.35
    layer.shadowRadius = isTV ? 24 : 12
    layer.shadowOffset = CGSize(width: 0, height: atTop ? 6 : -6)

    surface.translatesAutoresizingMaskIntoConstraints = false
    surface.backgroundColor = theme.tint
    surface.clipsToBounds = true
    addSubview(surface)

    #if os(tvOS)
      titleLabel.font = .systemFont(ofSize: 32, weight: .bold)
      messageLabel.font = .systemFont(ofSize: 29, weight: .medium)
    #else
      titleLabel.font = ToastCardView.scaled(.headline, bold: true)
      messageLabel.font = ToastCardView.scaled(.subheadline, bold: false)
      titleLabel.adjustsFontForContentSizeCategory = true
      messageLabel.adjustsFontForContentSizeCategory = true
    #endif
    titleLabel.textColor = theme.text
    messageLabel.textColor = theme.text.withAlphaComponent(0.72)
    for label in [titleLabel, messageLabel] {
      label.numberOfLines = 1
      label.lineBreakMode = .byTruncatingTail
    }
    // The message gives way first; the title truncates only once the message is gone.
    titleLabel.setContentCompressionResistancePriority(.defaultHigh + 1, for: .horizontal)
    messageLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    titleLabel.setContentHuggingPriority(.required, for: .horizontal)

    let side = titleLabel.font.pointSize * 1.2
    iconHost.translatesAutoresizingMaskIntoConstraints = false
    iconView.translatesAutoresizingMaskIntoConstraints = false
    iconView.contentMode = .center
    iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(font: titleLabel.font)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.color = theme.text
    spinner.hidesWhenStopped = true
    iconHost.addSubview(iconView)
    iconHost.addSubview(spinner)

    let text = UIStackView(arrangedSubviews: [titleLabel, messageLabel])
    text.axis = .horizontal
    text.alignment = .firstBaseline
    text.spacing = Metrics.textGap
    row.addArrangedSubview(iconHost)
    row.addArrangedSubview(text)
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = Metrics.iconGap
    row.translatesAutoresizingMaskIntoConstraints = false

    bar.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(bar)
    surface.addSubview(row)
    #if os(iOS)
      surface.addSubview(closeButton)
    #endif

    let outer = atTop
      ? surface.topAnchor.constraint(equalTo: topAnchor, constant: -Metrics.overscroll)
      : surface.bottomAnchor.constraint(equalTo: bottomAnchor, constant: Metrics.overscroll)
    let inner = atTop ? surface.bottomAnchor.constraint(equalTo: bottomAnchor) : surface.topAnchor.constraint(equalTo: topAnchor)
    NSLayoutConstraint.activate([
      surface.leadingAnchor.constraint(equalTo: leadingAnchor),
      surface.trailingAnchor.constraint(equalTo: trailingAnchor),
      outer,
      inner,

      iconHost.widthAnchor.constraint(equalToConstant: side),
      iconHost.heightAnchor.constraint(equalToConstant: side),
      iconView.centerXAnchor.constraint(equalTo: iconHost.centerXAnchor),
      iconView.centerYAnchor.constraint(equalTo: iconHost.centerYAnchor),
      spinner.centerXAnchor.constraint(equalTo: iconHost.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: iconHost.centerYAnchor),

      // The sweep fills the strip itself, like the folder bar's fill.
      bar.leadingAnchor.constraint(equalTo: leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: trailingAnchor),
      bar.topAnchor.constraint(equalTo: topAnchor),
      bar.bottomAnchor.constraint(equalTo: bottomAnchor),
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

  /// Edge to edge and as tall as its one line, or down to `cover` (a top navigation bar's bottom)
  /// so the bar's buttons stay hidden. tvOS hugs the true screen edge; iOS starts below the status bar.
  func install(in host: UIView, cover: CGFloat? = nil) {
    translatesAutoresizingMaskIntoConstraints = false
    host.addSubview(self)
    let guide = host.safeAreaLayoutGuide
    // The strip proper: between the screen edge (the safe one on iOS) and the card's inner edge.
    let band = UILayoutGuide()
    addLayoutGuide(band)
    let screenEdge = isTV ? (atTop ? topAnchor : bottomAnchor) : (atTop ? guide.topAnchor : guide.bottomAnchor)
    var trailing = guide.trailingAnchor
    #if os(iOS)
      NSLayoutConstraint.activate([
        closeButton.centerYAnchor.constraint(equalTo: band.centerYAnchor),
        closeButton.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -4),
        closeButton.widthAnchor.constraint(equalToConstant: Metrics.closeSize),
        closeButton.heightAnchor.constraint(equalTo: band.heightAnchor),
      ])
      trailing = closeButton.leadingAnchor
    #endif
    let centred = row.centerXAnchor.constraint(equalTo: guide.centerXAnchor)
    centred.priority = .defaultHigh
    let snug = row.topAnchor.constraint(equalTo: band.topAnchor, constant: Metrics.padding)
    snug.priority = .defaultHigh
    if atTop, let cover {
      bottomAnchor.constraint(greaterThanOrEqualTo: host.topAnchor, constant: cover).isActive = true
    }
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: host.leadingAnchor),
      trailingAnchor.constraint(equalTo: host.trailingAnchor),
      atTop ? topAnchor.constraint(equalTo: host.topAnchor) : bottomAnchor.constraint(equalTo: host.bottomAnchor),

      atTop ? band.topAnchor.constraint(equalTo: screenEdge) : band.bottomAnchor.constraint(equalTo: screenEdge),
      atTop ? band.bottomAnchor.constraint(equalTo: bottomAnchor) : band.topAnchor.constraint(equalTo: topAnchor),

      snug,
      row.topAnchor.constraint(greaterThanOrEqualTo: band.topAnchor, constant: Metrics.padding),
      row.bottomAnchor.constraint(lessThanOrEqualTo: band.bottomAnchor, constant: -Metrics.padding),
      row.centerYAnchor.constraint(equalTo: band.centerYAnchor),
      row.leadingAnchor.constraint(greaterThanOrEqualTo: guide.leadingAnchor, constant: Metrics.inset),
      row.trailingAnchor.constraint(lessThanOrEqualTo: trailing, constant: -Metrics.inset),
      centred,
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
    bar.fillColor = model.kind == .error ? theme.danger.withAlphaComponent(0.3) : theme.text.withAlphaComponent(0.14)
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
    model.edge = atTop ? .top : .bottom
    UIView.transition(with: row, duration: 0.25, options: [.transitionCrossDissolve, .allowUserInteraction]) {
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
    let distance = atTop ? -(frame.maxY + 24) : host.bounds.height - frame.minY + 24
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

    // Toward the screen edge follows the finger, away rubber-bands; a flick or 40% of the height dismisses.
    @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
      let sign: CGFloat = atTop ? -1 : 1
      let dy = pan.translation(in: superview).y * sign
      switch pan.state {
      case .began:
        setPaused(true, for: .touch)
      case .changed:
        transform = CGAffineTransform(translationX: 0, y: (dy > 0 ? dy : dy * 0.25) * sign)
      case .ended, .cancelled, .failed:
        let velocity = pan.velocity(in: superview).y * sign
        if pan.state == .ended, velocity > 500 || dy > bounds.height * 0.4 {
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

/// A left-anchored fill; the fraction is laid out as a frame so a property animator can pause it.
private final class ToastLifetimeBar: UIView {
  private let fill = UIView()
  private var fraction: CGFloat = 1

  var fillColor: UIColor? {
    get { fill.backgroundColor }
    set { fill.backgroundColor = newValue }
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
