//
//  AudioPlayerContainerViewController.swift
//  TomoTV
//
//  The phone, iPad and Mac audio screen: AVKit's player embedded as a child, with a song's
//  lyrics beside it, never over it. A song without lyrics leaves the player the whole screen.
//

#if !os(tvOS)

import AVKit
import UIKit

final class AudioPlayerContainerViewController: UIViewController {

    var onWillDismiss: (() -> Void)?
    var onDismissed: (() -> Void)?
    /// Seconds of the line the viewer tapped.
    var onSeek: ((Double) -> Void)?

    private let playerViewController: AVPlayerViewController
    /// The player's own artwork card, told which region it now sits in.
    private weak var artworkOverlay: AudioArtworkOverlayView?
    private let backdrop = AudioArtworkOverlayView(frame: .zero)
    private let lyricsList = LyricsListView()
    private let thumbnail = UIImageView()
    private let titleLabel = UILabel()
    private let artistLabel = UILabel()
    private let closeButton = UIButton(type: .close)
    private var hasLyrics = false
    private var isPlayerFullscreen = false

    /// The player's share of the width when the lines sit beside it.
    private static let playerColumnShare: CGFloat = 0.44
    /// The shortest strip in which AVKit lays out its transport row, scrubber and top buttons apart.
    private static let playerStripHeight: CGFloat = 220
    private static let headerHeight: CGFloat = 56
    private static let margin: CGFloat = 20

    init(playerViewController: AVPlayerViewController, artworkOverlay: AudioArtworkOverlayView?) {
        self.playerViewController = playerViewController
        self.artworkOverlay = artworkOverlay
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        // Always over dark artwork, so the system close button draws its light form.
        overrideUserInterfaceStyle = .dark

        // The same wash the player draws, so the two regions read as one surface.
        backdrop.isCardHidden = true
        backdrop.frame = view.bounds
        backdrop.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(backdrop)

        addChild(playerViewController)
        // The artwork wash is drawn against the window and must stop at the player's edge.
        playerViewController.view.clipsToBounds = true
        view.addSubview(playerViewController.view)
        playerViewController.didMove(toParent: self)
        artworkOverlay?.layoutHost = playerViewController.view

        lyricsList.onSelect = { [weak self] seconds in self?.onSeek?(seconds) }
        view.addSubview(lyricsList)

        thumbnail.contentMode = .scaleAspectFill
        thumbnail.clipsToBounds = true
        thumbnail.layer.cornerRadius = 8
        thumbnail.backgroundColor = UIColor(white: 1, alpha: 0.08)
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textColor = .white
        artistLabel.font = .preferredFont(forTextStyle: .subheadline)
        artistLabel.textColor = UIColor(white: 1, alpha: 0.65)
        view.addSubview(thumbnail)
        view.addSubview(titleLabel)
        view.addSubview(artistLabel)

        // Beside its lyrics AVKit offers Fullscreen where its Close was, so the screen needs its own.
        closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        view.addSubview(closeButton)
    }

    func setTrack(title: String, artist: String) {
        titleLabel.text = title
        artistLabel.text = artist
    }

    func setArtwork(_ content: AudioArtworkOverlayView.Content) {
        backdrop.show(content)
        if case let .artwork(image) = content { thumbnail.image = image } else { thumbnail.image = nil }
    }

    func setLyrics(_ lyrics: Lyrics?) {
        lyricsList.setLyrics(lyrics)
        guard hasLyrics != (lyrics != nil) else { return }
        hasLyrics = lyrics != nil
        guard isViewLoaded else { return }
        view.setNeedsLayout()
        UIView.animate(withDuration: 0.3) { self.view.layoutIfNeeded() }
    }

    /// The next song's lyrics are on their way: the lines go, the layout stays.
    func holdLyricsLayout() {
        lyricsList.setLyrics(nil)
    }

    func updateLyrics(time: Double) {
        lyricsList.update(time: time)
    }

    /// AVKit's own fullscreen takes the player out of this screen, so the artwork is laid out
    /// against the window again and shows its card.
    func setPlayerFullscreen(_ fullscreen: Bool) {
        isPlayerFullscreen = fullscreen
        artworkOverlay?.layoutHost = fullscreen ? nil : playerViewController.view
        if fullscreen { artworkOverlay?.isCardHidden = false } else { view.setNeedsLayout() }
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let bounds = view.bounds
        let safe = view.safeAreaLayoutGuide.layoutFrame
        let sideBySide = bounds.width > bounds.height || traitCollection.horizontalSizeClass == .regular

        lyricsList.isHidden = !hasLyrics
        closeButton.isHidden = !hasLyrics
        let showsHeader = hasLyrics && !sideBySide
        thumbnail.isHidden = !showsHeader
        titleLabel.isHidden = !showsHeader
        artistLabel.isHidden = !showsHeader
        // The header carries the artwork on a portrait phone, as in Apple Music.
        if !isPlayerFullscreen { artworkOverlay?.isCardHidden = showsHeader }

        let closeSize = closeButton.intrinsicContentSize
        guard hasLyrics else {
            playerViewController.view.frame = bounds
            return
        }

        if sideBySide {
            let column = (bounds.width * Self.playerColumnShare).rounded()
            playerViewController.view.frame = CGRect(x: 0, y: 0, width: column, height: bounds.height)
            closeButton.frame = CGRect(x: safe.maxX - Self.margin - closeSize.width, y: safe.minY + Self.margin, width: closeSize.width, height: closeSize.height)
            let left = column + Self.margin
            lyricsList.frame = CGRect(x: left, y: safe.minY, width: closeButton.frame.minX - Self.margin - left, height: safe.height)
            return
        }

        let headerTop = safe.minY + 8
        closeButton.frame = CGRect(x: safe.maxX - Self.margin - closeSize.width, y: headerTop + (Self.headerHeight - closeSize.height) / 2, width: closeSize.width, height: closeSize.height)
        thumbnail.frame = CGRect(x: safe.minX + Self.margin, y: headerTop, width: Self.headerHeight, height: Self.headerHeight)
        let textLeft = thumbnail.frame.maxX + 12
        let textWidth = closeButton.frame.minX - 12 - textLeft
        titleLabel.frame = CGRect(x: textLeft, y: headerTop + 6, width: textWidth, height: 22)
        artistLabel.frame = CGRect(x: textLeft, y: titleLabel.frame.maxY + 2, width: textWidth, height: 20)

        let strip = Self.playerStripHeight + (bounds.height - safe.maxY)
        playerViewController.view.frame = CGRect(x: 0, y: bounds.height - strip, width: bounds.width, height: strip)
        let listTop = headerTop + Self.headerHeight + 8
        lyricsList.frame = CGRect(x: 0, y: listTop, width: bounds.width, height: playerViewController.view.frame.minY - listTop)
    }

    override func viewWillDisappear(_ animated: Bool) {
        if isBeingDismissed { onWillDismiss?() }
        super.viewWillDisappear(animated)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { onDismissed?() }
    }
}

#endif
