//
//  UpNextPanelViewController.swift
//  TomoTV
//
//  Custom "Up Next" tab for the tvOS audio player's swipe-down info panel
//  (AVPlayerViewController.customInfoViewControllers). Shows the remaining
//  queue as focusable artwork cards; selecting one jumps playback to that
//  track. Data and behavior are injected by AudioQueuePlayer so this stays a
//  dumb view layer: entriesProvider snapshots the upcoming tracks, onSelect
//  maps back to the module's skip(to:), artworkLoader shares the module's
//  artwork download/cache.
//

#if os(tvOS)

import Foundation
import UIKit

final class UpNextPanelViewController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegate {

    struct Entry {
        let index: Int
        let title: String
        let artist: String
        let artworkURL: URL?
    }

    var entriesProvider: () -> [Entry] = { [] }
    var onSelect: ((Int) -> Void)?
    var artworkLoader: ((URL, @escaping (Data?) -> Void) -> Void)?

    private var entries: [Entry] = []
    private var collectionView: UICollectionView?

    /// Baked card images, keyed by artwork URL. The module's own cache holds raw
    /// Data (shared with the player-item metadata and Now Playing), so the
    /// decode-and-round pass is cached separately here rather than repeated for
    /// every cell that scrolls back into view.
    private static let cardCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 60
        return cache
    }()

    // AVKit builds the info panel's tab bar from the child controllers'
    // title/preferredContentSize without loading their views — set in init so
    // they exist before customInfoViewControllers is assigned.
    override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
        title = "Up Next"
        preferredContentSize = CGSize(width: 1920, height: 440)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
    }

    /// Kept for the module's track-change callers: the list materializes fresh
    /// from entriesProvider on every presentation, so nothing to do here.
    func reload() {}

    // Focus-strand discipline: a cell removed from the window while focused
    // (panel dismissed over it) keeps its lifted floating-focus appearance
    // forever — UIKit never delivers the focus-out — and reappears zoomed on
    // the next open until focus passes over it again. Resetting flags or
    // deferring reloadData does NOT clear it. The only reset guaranteed by
    // construction: no view survives across presentations. Build the
    // collection view fresh on every appearance, destroy it on disappear.
    // Bonus: every open shows the current queue.
    private func rebuildCollectionView() {
        collectionView?.removeFromSuperview()
        entries = entriesProvider()

        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: UpNextCell.artworkSize.width, height: UpNextCell.artworkSize.height + 100)
        layout.minimumLineSpacing = 40
        layout.sectionInset = UIEdgeInsets(top: 20, left: 90, bottom: 20, right: 90)

        let cv = UICollectionView(frame: .zero, collectionViewLayout: layout)
        cv.backgroundColor = .clear
        cv.dataSource = self
        cv.delegate = self
        cv.register(UpNextCell.self, forCellWithReuseIdentifier: UpNextCell.reuseIdentifier)
        cv.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cv)
        NSLayoutConstraint.activate([
            cv.topAnchor.constraint(equalTo: view.topAnchor),
            cv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            cv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        collectionView = cv
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        rebuildCollectionView()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        collectionView?.removeFromSuperview()
        collectionView = nil
    }

    // MARK: - UICollectionViewDataSource

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        entries.count
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: UpNextCell.reuseIdentifier, for: indexPath)
        guard let upNextCell = cell as? UpNextCell, indexPath.item < entries.count else { return cell }
        let entry = entries[indexPath.item]
        upNextCell.configure(title: entry.title, artist: entry.artist, artworkURL: entry.artworkURL)
        guard let url = entry.artworkURL else { return cell }

        if let baked = Self.cardCache.object(forKey: url.absoluteString as NSString) {
            upNextCell.setArtwork(baked)
            return cell
        }
        artworkLoader?(url) { [weak upNextCell] data in
            guard let data else { return }
            // The loader answers on the main queue (synchronously on a cache
            // hit); decoding and re-drawing a full row of cards there would
            // land straight on the focus engine's runloop.
            DispatchQueue.global(qos: .userInitiated).async {
                guard let image = UIImage(data: data) else { return }
                let baked = UpNextArtwork.card(from: image)
                DispatchQueue.main.async {
                    Self.cardCache.setObject(baked, forKey: url.absoluteString as NSString)
                    guard let upNextCell, upNextCell.representedURL == url else { return }
                    upNextCell.setArtwork(baked)
                }
            }
        }
        return cell
    }

    // MARK: - UICollectionViewDelegate

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard indexPath.item < entries.count else { return }
        onSelect?(entries[indexPath.item].index)
    }
}

/// Card artwork, baked to the card's exact geometry with rounded corners.
///
/// Two tvOS focus rules force the drawing to happen here instead of on the
/// layer:
///
///  - `adjustsImageWhenAncestorFocused` builds the lift, parallax and specular
///    sweep FROM the image. A card with no image has nothing to animate and
///    sits dead under focus, so every card gets an image — artwork when the
///    track has it, the placeholder when it doesn't.
///  - `layer.cornerRadius` cannot round the artwork. CALayer applies the radius
///    to the layer's background and to the `masksToBounds` mask only (CALayer.h),
///    and the focus effect requires `clipsToBounds = false`, so the image itself
///    always drew square-cornered. Baking the corners into the image and setting
///    `masksFocusEffectToContents` masks the focus shadow and highlight to the
///    alpha channel rather than the bounds. UIImageView.h requires the view and
///    its image to share an aspect ratio for that to take effect, which drawing
///    at the card size guarantees.
private enum UpNextArtwork {
    static let size = CGSize(width: 260, height: 260)
    static let cornerRadius: CGFloat = 12

    /// Matches the posterless cards in the library grid (`video-grid-item.tsx`).
    private static let placeholderFill = UIColor(red: 44 / 255, green: 44 / 255, blue: 46 / 255, alpha: 1)
    private static let placeholderGlyph = UIColor(red: 72 / 255, green: 72 / 255, blue: 74 / 255, alpha: 1)

    /// Identical for every artworkless track, so it is drawn once.
    static let placeholder: UIImage = render { _ in
        placeholderFill.setFill()
        UIBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
        let config = UIImage.SymbolConfiguration(pointSize: 72, weight: .regular)
        guard let glyph = UIImage(systemName: "music.note", withConfiguration: config)?
            .withTintColor(placeholderGlyph, renderingMode: .alwaysOriginal) else { return }
        glyph.draw(at: CGPoint(x: (size.width - glyph.size.width) / 2,
                               y: (size.height - glyph.size.height) / 2))
    }

    /// Centre-cropped to fill the card (what `.scaleAspectFill` used to do at
    /// display time), then clipped to the rounded rect.
    static func card(from image: UIImage) -> UIImage {
        guard image.size.width > 0, image.size.height > 0 else { return placeholder }
        return render { _ in
            let scale = max(size.width / image.size.width, size.height / image.size.height)
            let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(x: (size.width - drawn.width) / 2,
                                  y: (size.height - drawn.height) / 2,
                                  width: drawn.width,
                                  height: drawn.height))
        }
    }

    /// Built once, off the screen traits, so `card(from:)` never touches them
    /// from its background queue. Safe by ordering: the first access is
    /// `placeholder`, which every cell renders in its initializer on the main
    /// thread, and a cell always exists before any download can complete.
    private static let format: UIGraphicsImageRendererFormat = {
        let format = UIGraphicsImageRendererFormat.preferred()
        format.opaque = false // the corners have to stay transparent
        return format
    }()

    private static func render(_ body: @escaping (UIGraphicsImageRendererContext) -> Void) -> UIImage {
        UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: cornerRadius).addClip()
            body(context)
        }
    }
}

private final class UpNextCell: UICollectionViewCell {
    static let reuseIdentifier = "UpNextCell"
    static let artworkSize = UpNextArtwork.size

    private let imageView = UIImageView()
    private let titleLabel = UILabel()
    private let artistLabel = UILabel()
    private(set) var representedURL: URL?

    override init(frame: CGRect) {
        super.init(frame: frame)

        // Native tvOS focus treatment: the image pops and gains the floating
        // specular effect; no custom animations. The rounded corners live in
        // the image (see UpNextArtwork) — hence no layer cornerRadius, and a
        // clear background so nothing square shows through those corners.
        imageView.adjustsImageWhenAncestorFocused = true
        imageView.masksFocusEffectToContents = true
        imageView.clipsToBounds = false
        imageView.contentMode = .scaleAspectFill
        imageView.backgroundColor = .clear
        imageView.image = UpNextArtwork.placeholder
        imageView.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .systemFont(ofSize: 27, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        artistLabel.font = .systemFont(ofSize: 23)
        artistLabel.textColor = UIColor(white: 1, alpha: 0.6)
        artistLabel.lineBreakMode = .byTruncatingTail
        artistLabel.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(imageView)
        contentView.addSubview(titleLabel)
        contentView.addSubview(artistLabel)
        NSLayoutConstraint.activate([
            // Sized from the same constant the artwork is drawn at:
            // masksFocusEffectToContents only takes effect while the view and
            // its image share an aspect ratio (UIImageView.h).
            imageView.topAnchor.constraint(equalTo: contentView.topAnchor),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            imageView.widthAnchor.constraint(equalToConstant: Self.artworkSize.width),
            imageView.heightAnchor.constraint(equalToConstant: Self.artworkSize.height),

            titleLabel.topAnchor.constraint(equalTo: imageView.bottomAnchor, constant: 18),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),

            artistLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 4),
            artistLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            artistLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(title: String, artist: String, artworkURL: URL?) {
        titleLabel.text = title
        artistLabel.text = artist.isEmpty ? " " : artist
        representedURL = artworkURL
        imageView.image = UpNextArtwork.placeholder
    }

    func setArtwork(_ image: UIImage) {
        imageView.image = image
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        representedURL = nil
        // Never nil: an imageless card has nothing for the focus effect to
        // lift, so it would sit frozen while its neighbours animate.
        imageView.image = UpNextArtwork.placeholder
    }
}

#endif
