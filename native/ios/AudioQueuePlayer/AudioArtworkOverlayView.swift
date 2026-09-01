//
//  AudioArtworkOverlayView.swift
//  TomoTV
//
//  The audio player's stand-in for a video image: the track's poster as a raised
//  card over a wash of its own artwork, so an audio-only presentation is never a
//  black rectangle. Non-interactive by construction, it shares its layer with
//  AVKit's transport controls.
//
//  Not Liquid Glass, deliberately. Apple's guidance is that glass belongs to the
//  navigation layer that floats above content and never to content itself, and an
//  opaque poster filling a UIGlassEffect view hides the material anyway: the glass
//  can only show where the picture is not, which is a frame around it.
//

import UIKit

final class AudioArtworkOverlayView: UIView {

    enum Content {
        case loading
        case artwork(UIImage)
        /// The track carries no poster, or fetching it failed.
        case empty
    }

    /// The card's side as a share of the window's SHORT side, so one size serves both
    /// orientations and a rotation never resizes it. Capped again by height below.
    #if os(tvOS)
    private static let sideShare: CGFloat = 0.34
    #else
    private static let sideShare: CGFloat = 0.86
    #endif

    /// Rounded square everywhere a pointer or a touch sees it. tvOS keeps the circle: its
    /// poster is a third of the screen at ten feet, where a 16pt radius reads as no radius.
    #if os(tvOS)
    private static let cornerRadius: CGFloat? = nil
    #else
    private static let cornerRadius: CGFloat? = 16
    #endif

    /// Room kept clear above and below for AVKit's transport cluster. The card is capped
    /// against the window's HEIGHT as well as its short side, so a landscape window (every
    /// Mac one) cannot push the artwork under the bar.
    private static let transportClearance: CGFloat = 88

    /// Matches the posterless cards in the Up Next panel and the library grid.
    private static let placeholderFill = UIColor(red: 44 / 255, green: 44 / 255, blue: 46 / 255, alpha: 1)
    private static let placeholderGlyph = UIColor(red: 72 / 255, green: 72 / 255, blue: 74 / 255, alpha: 1)

    /// The same artwork, oversized and blurred, filling the window behind the card. It is what
    /// gives the card something to sit on: against pure black a drop shadow is invisible and a
    /// light rim reads as a white box drawn around the picture.
    private let wash = UIImageView()
    // The material styles are API_UNAVAILABLE(tvos); tvOS never adds this view, but the stored
    // property still has to compile there.
    #if os(tvOS)
    private let washBlur = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
    #else
    private let washBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    #endif
    private let washDim = UIView()

    /// Holds the shadow. Separate from the poster because a layer that clips its content to a
    /// corner radius cannot draw anything outside its own bounds.
    private let card = UIView()
    private let poster = UIImageView()
    private let glyph = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .large)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear

        #if !os(tvOS)
        wash.contentMode = .scaleAspectFill
        wash.clipsToBounds = true
        addSubview(wash)
        addSubview(washBlur)
        // The blur alone leaves a bright wash under white transport glyphs.
        washDim.backgroundColor = UIColor(white: 0, alpha: 0.45)
        addSubview(washDim)

        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.6
        card.layer.shadowRadius = 30
        card.layer.shadowOffset = CGSize(width: 0, height: 14)
        #endif
        addSubview(card)

        poster.contentMode = .scaleAspectFill
        poster.clipsToBounds = true
        poster.backgroundColor = Self.placeholderFill
        card.addSubview(poster)

        glyph.contentMode = .scaleAspectFit
        // Rendered at a size no poster exceeds, so aspect-fit only ever scales it down.
        glyph.image = UIImage(systemName: "music.note", withConfiguration: UIImage.SymbolConfiguration(pointSize: 140, weight: .regular))?
            .withTintColor(Self.placeholderGlyph, renderingMode: .alwaysOriginal)
        poster.addSubview(glyph)

        spinner.color = UIColor(white: 1, alpha: 0.5)
        spinner.hidesWhenStopped = true
        poster.addSubview(spinner)

        show(.loading)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(_ content: Content) {
        switch content {
        case .loading:
            glyph.isHidden = true
            spinner.startAnimating()
            setImage(nil)
        case let .artwork(image):
            glyph.isHidden = true
            spinner.stopAnimating()
            setImage(image)
        case .empty:
            glyph.isHidden = false
            spinner.stopAnimating()
            setImage(nil)
        }
    }

    /// Cross-dissolve rather than a swap: artwork lands whenever its download does,
    /// which is rarely the moment the track changed.
    private func setImage(_ image: UIImage?) {
        guard poster.image !== image else { return }
        UIView.transition(with: poster, duration: 0.25, options: .transitionCrossDissolve) {
            self.poster.image = image
        }
        UIView.transition(with: wash, duration: 0.4, options: .transitionCrossDissolve) {
            self.wash.image = image
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setNeedsLayout()
    }

    /// Laid out against the window, not this view: AVKit sizes contentOverlayView to
    /// the content, which for an audio item is neither the screen nor stable across a
    /// rotation. The window's short side is the same number in both orientations.
    override func layoutSubviews() {
        super.layoutSubviews()
        let reference = window?.bounds ?? bounds

        // Two caps, not one. The short side keeps the card square and rotation-stable; the
        // height cap is what keeps it off AVKit's transport bar in a landscape window, where
        // the short side IS the height and the bar has nowhere else to go.
        let byShortSide = min(reference.width, reference.height) * Self.sideShare
        let byHeight = reference.height - 2 * Self.transportClearance
        let side = max(0, min(byShortSide, byHeight))
        let centre = window.map { convert(CGPoint(x: $0.bounds.midX, y: $0.bounds.midY), from: $0) }
            ?? CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = Self.cornerRadius ?? side / 2

        // The wash covers the whole window, which this view does not: AVKit sizes the content
        // overlay to the item, so the frame has to be borrowed from the window itself.
        let washFrame = window.map { convert($0.bounds, from: $0) } ?? bounds
        wash.frame = washFrame
        washBlur.frame = washFrame
        washDim.frame = washFrame

        card.bounds = CGRect(x: 0, y: 0, width: side, height: side)
        card.center = centre
        // An explicit path: the card's own layer is empty, so without one Core Animation would
        // trace the poster's alpha every frame to find a silhouette it already knows.
        card.layer.shadowPath = UIBezierPath(roundedRect: card.bounds, cornerRadius: radius).cgPath

        poster.frame = card.bounds
        poster.layer.cornerRadius = radius

        let glyphSize = side * 0.28
        glyph.bounds = CGRect(x: 0, y: 0, width: glyphSize, height: glyphSize)
        glyph.center = CGPoint(x: poster.bounds.midX, y: poster.bounds.midY)
        spinner.center = glyph.center
    }
}
