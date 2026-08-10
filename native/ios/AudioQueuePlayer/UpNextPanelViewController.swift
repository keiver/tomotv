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
        layout.itemSize = CGSize(width: 260, height: 360)
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
        if let url = entry.artworkURL {
            artworkLoader?(url) { [weak upNextCell] data in
                DispatchQueue.main.async {
                    guard let upNextCell, upNextCell.representedURL == url,
                          let data, let image = UIImage(data: data) else { return }
                    upNextCell.setArtwork(image)
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

private final class UpNextCell: UICollectionViewCell {
    static let reuseIdentifier = "UpNextCell"

    private let imageView = UIImageView()
    private let titleLabel = UILabel()
    private let artistLabel = UILabel()
    private(set) var representedURL: URL?

    override init(frame: CGRect) {
        super.init(frame: frame)

        // Native tvOS focus treatment: the image pops and gains the floating
        // specular effect; no custom animations.
        imageView.adjustsImageWhenAncestorFocused = true
        imageView.clipsToBounds = false
        imageView.contentMode = .scaleAspectFill
        imageView.backgroundColor = UIColor(white: 0.15, alpha: 1)
        imageView.layer.cornerRadius = 12
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
            imageView.topAnchor.constraint(equalTo: contentView.topAnchor),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            imageView.heightAnchor.constraint(equalTo: imageView.widthAnchor),

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
        imageView.image = nil
    }

    func setArtwork(_ image: UIImage) {
        imageView.image = image
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        representedURL = nil
        imageView.image = nil
    }
}

#endif
