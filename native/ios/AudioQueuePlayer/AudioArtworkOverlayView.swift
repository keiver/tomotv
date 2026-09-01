//
//  AudioArtworkOverlayView.swift
//  TomoTV
//
//  The audio player's stand-in for a video image: the track's poster as a raised
//  card over a wash of its own artwork, so an audio-only presentation is never a
//  black rectangle. Non-interactive by construction, it shares its layer with
//  AVKit's transport controls.
//

import UIKit

final class AudioArtworkOverlayView: UIView {

    enum Content {
        case loading
        case artwork(UIImage)
        /// The track carries no poster, or fetching it failed.
        case empty
    }

    /// Share of the window's SHORT side, so a rotation never resizes the card.
    #if os(tvOS)
    private static let sideShare: CGFloat = 0.34
    #else
    private static let sideShare: CGFloat = 0.86
    #endif

    /// One radius everywhere. The card is a share of the screen, so it reads the same at any
    /// viewing distance.
    private static let cornerRadius: CGFloat = 16

    /// Kept clear above and below for AVKit's transport cluster. The card is centred, so the
    /// height budget pays it twice.
    private static let transportClearance: CGFloat = 88

    /// Floor for the caps. In a window too short to hold the clearance, overlapping the
    /// transport bar beats a poster too small to read.
    private static let minimumSide: CGFloat = 120

    /// Breathing room at the sides, so a wide poster stops short of the screen edges.
    private static let horizontalMargin: CGFloat = 24

    /// Matches the posterless cards in the Up Next panel and the library grid.
    private static let placeholderFill = UIColor(red: 44 / 255, green: 44 / 255, blue: 46 / 255, alpha: 1)
    private static let placeholderGlyph = UIColor(red: 72 / 255, green: 72 / 255, blue: 74 / 255, alpha: 1)

    /// The same artwork, oversized and blurred, filling the window behind the card. A shadow
    /// needs something other than black to fall on.
    private let wash = UIImageView()
    // The material styles are API_UNAVAILABLE(tvos); tvOS never adds this view, but the stored
    // property still has to compile there.
    #if os(tvOS)
    private let washBlur = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
    #else
    private let washBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    #endif
    private let washDim = UIView()

    /// Holds the shadow: a layer clipping to a corner radius cannot draw outside its bounds.
    private let card = UIView()
    private let poster = UIImageView()
    private let glyph = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .large)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear

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

    /// Cross-dissolve: artwork lands when its download does, rarely when the track changed.
    private func setImage(_ image: UIImage?) {
        guard poster.image !== image else { return }
        UIView.transition(with: poster, duration: 0.25, options: .transitionCrossDissolve) {
            self.poster.image = image
        }
        UIView.transition(with: wash, duration: 0.4, options: .transitionCrossDissolve) {
            self.wash.image = image
        }
        // The card is shaped by the image, so a new one has to re-measure it.
        setNeedsLayout()
    }

    /// The artwork's aspect, or 1 for the placeholder, which the glyph is drawn square for.
    private func posterRatio() -> CGFloat {
        guard let size = poster.image?.size, size.width > 0, size.height > 0 else { return 1 }
        return size.width / size.height
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setNeedsLayout()
    }

    /// The window, never this view's bounds: AVKit sizes contentOverlayView to the content, and
    /// an audio item has no picture, so those bounds can be near zero. nil means "no window to
    /// measure", never "a small one".
    private func layoutReference() -> CGRect? {
        guard let frame = window?.bounds, frame.width > 0, frame.height > 0 else { return nil }
        return frame
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // presentUI adds this view before the controller is presented, so the first passes have
        // no window. Hold the geometry rather than measure against nothing.
        guard let reference = layoutReference(), let window else { return }

        // Two caps: the short side holds the size steady across a rotation, the height keeps the
        // card off the transport bar where the short side IS the height.
        let byShortSide = min(reference.width, reference.height) * Self.sideShare
        let byHeight = reference.height - 2 * Self.transportClearance
        // Floored, never zero: a zero side is an invisible card rather than a small one.
        let heightLimit = max(Self.minimumSide, min(byShortSide, byHeight))
        let widthLimit = max(Self.minimumSide, reference.width - 2 * Self.horizontalMargin)

        // The card takes the artwork's shape. A square one is unchanged; anything else shows
        // whole instead of being cropped to a square or banded inside it.
        let ratio = posterRatio()
        var cardSize = CGSize(width: heightLimit * ratio, height: heightLimit)
        if cardSize.width > widthLimit {
            cardSize = CGSize(width: widthLimit, height: widthLimit / ratio)
        }
        let centre = convert(CGPoint(x: reference.midX, y: reference.midY), from: window)
        let radius = Self.cornerRadius

        // The wash covers the window, which this view does not.
        let washFrame = convert(reference, from: window)
        wash.frame = washFrame
        washBlur.frame = washFrame
        washDim.frame = washFrame

        card.bounds = CGRect(origin: .zero, size: cardSize)
        card.center = centre
        // An explicit path: the card's own layer is empty, so without one Core Animation would
        // trace the poster's alpha every frame to find a silhouette it already knows.
        card.layer.shadowPath = UIBezierPath(roundedRect: card.bounds, cornerRadius: radius).cgPath

        poster.frame = card.bounds
        poster.layer.cornerRadius = radius

        let glyphSize = min(cardSize.width, cardSize.height) * 0.28
        glyph.bounds = CGRect(x: 0, y: 0, width: glyphSize, height: glyphSize)
        glyph.center = CGPoint(x: poster.bounds.midX, y: poster.bounds.midY)
        spinner.center = glyph.center
    }
}
