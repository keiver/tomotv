//
//  AudioArtworkOverlayView.swift
//  TomoTV
//
//  The audio player's stand-in for a video image: the track's poster as a
//  circle in the centre of AVKit's content overlay, so an audio-only
//  presentation is never a black rectangle. Non-interactive by construction —
//  it shares its layer with AVKit's transport controls.
//

import UIKit

final class AudioArtworkOverlayView: UIView {

    enum Content {
        case loading
        case artwork(UIImage)
        /// The track carries no poster, or fetching it failed.
        case empty
    }

    /// Diameter as a share of the window's SHORT side, so one disc size serves both
    /// orientations and a rotation never resizes it. On phones it is wide enough that
    /// AVKit's transport cluster lands on artwork instead of half off it.
    #if os(tvOS)
    private static let diameterShare: CGFloat = 0.34
    #else
    private static let diameterShare: CGFloat = 0.86
    #endif

    /// Matches the posterless cards in the Up Next panel and the library grid.
    private static let placeholderFill = UIColor(red: 44 / 255, green: 44 / 255, blue: 46 / 255, alpha: 1)
    private static let placeholderGlyph = UIColor(red: 72 / 255, green: 72 / 255, blue: 74 / 255, alpha: 1)

    private let disc = UIImageView()
    private let glyph = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .large)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear

        disc.contentMode = .scaleAspectFill
        disc.clipsToBounds = true
        disc.backgroundColor = Self.placeholderFill
        addSubview(disc)

        glyph.contentMode = .scaleAspectFit
        // Rendered at a size no disc exceeds, so aspect-fit only ever scales it down.
        glyph.image = UIImage(systemName: "music.note", withConfiguration: UIImage.SymbolConfiguration(pointSize: 140, weight: .regular))?
            .withTintColor(Self.placeholderGlyph, renderingMode: .alwaysOriginal)
        disc.addSubview(glyph)

        spinner.color = UIColor(white: 1, alpha: 0.5)
        spinner.hidesWhenStopped = true
        disc.addSubview(spinner)

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
        guard disc.image !== image else { return }
        UIView.transition(with: disc, duration: 0.25, options: .transitionCrossDissolve) {
            self.disc.image = image
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
        let diameter = min(reference.width, reference.height) * Self.diameterShare
        disc.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
        disc.center = window.map { convert(CGPoint(x: $0.bounds.midX, y: $0.bounds.midY), from: $0) }
            ?? CGPoint(x: bounds.midX, y: bounds.midY)
        disc.layer.cornerRadius = diameter / 2

        let glyphSize = diameter * 0.28
        glyph.bounds = CGRect(x: 0, y: 0, width: glyphSize, height: glyphSize)
        glyph.center = CGPoint(x: disc.bounds.midX, y: disc.bounds.midY)
        spinner.center = glyph.center
    }
}
