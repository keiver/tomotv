//
//  LyricsOverlayViewController.swift
//  TomoTV
//
//  The Apple TV player's swipe-up surface (AVPlayerViewController.customOverlayViewController):
//  every line with its time, focusable, and a press plays from that line. AVKit owns the
//  presentation and the Menu press that closes it.
//

#if os(tvOS)

import UIKit

final class LyricsOverlayViewController: UIViewController {

    var onSelect: ((Double) -> Void)?
    /// True while the list holds focus, so the player can stand its own left and right down.
    var onVisibilityChange: ((Bool) -> Void)?

    private let list = LyricsListView()

    /// No backdrop of its own: AVKit draws the panel's rounded surface.
    override func viewDidLoad() {
        super.viewDidLoad()
        list.showsTimes = true
        list.onSelect = { [weak self] seconds in self?.onSelect?(seconds) }
        list.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(list)
        NSLayoutConstraint.activate([
            list.topAnchor.constraint(equalTo: view.topAnchor),
            list.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            list.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            list.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.62),
        ])
    }

    func setLyrics(_ lyrics: Lyrics?) {
        loadViewIfNeeded()
        list.setLyrics(lyrics)
    }

    func update(time: Double) {
        guard isViewLoaded else { return }
        list.update(time: time)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        onVisibilityChange?(true)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        onVisibilityChange?(false)
    }

    override var preferredFocusEnvironments: [UIFocusEnvironment] { [list] }
}

#endif
