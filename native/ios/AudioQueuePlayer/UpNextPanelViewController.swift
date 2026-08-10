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
    private var needsReload = false

    override func viewDidLoad() {
        super.viewDidLoad()
        // The tab label in the info panel comes from the view controller title.
        title = "Up Next"
        preferredContentSize = CGSize(width: 1920, height: 440)
        view.backgroundColor = .clear

        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: 260, height: 360)
        layout.minimumLineSpacing = 40
        layout.sectionInset = UIEdgeInsets(top: 20, left: 90, bottom: 20, right: 90)

        let cv = UICollectionView(frame: .zero, collectionViewLayout: layout)
        cv.backgroundColor = .clear
        cv.dataSource = self
        cv.delegate = self
        cv.remembersLastFocusedIndexPath = true
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
        reload()
    }

    /// Mark the list stale (called by the module on every track change; safe
    /// before viewDidLoad — the initial application happens there). The actual
    /// reloadData is DEFERRED until the panel's next presentation: reloading
    /// while the panel is on screen strands previously-focused cells in
    /// UIKit's lifted (floating-focus) appearance, and they render zoomed-in
    /// on the next open. Selecting a card therefore leaves the visible list
    /// untouched; it refreshes when the panel is opened again.
    func reload() {
        needsReload = true
        applyPendingReloadIfOffScreen()
    }

    private func applyPendingReloadIfOffScreen() {
        guard needsReload, let cv = collectionView else { return }
        guard viewIfLoaded?.window == nil else { return }
        needsReload = false
        entries = entriesProvider()
        cv.reloadData()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Not yet in a window at willAppear time, so a pending reload applies
        // here — before focus lands on any cell.
        applyPendingReloadIfOffScreen()
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
        // Belt-and-braces against the lifted-appearance leak: flipping the
        // flag drops any floating-focus state a reused cell carried.
        imageView.adjustsImageWhenAncestorFocused = false
        imageView.adjustsImageWhenAncestorFocused = true
    }
}

#endif
