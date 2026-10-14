//
//  AudioPlayerContainerViewController.swift
//  TomoTV
//
//  The phone, iPad and Mac audio screen: AVKit's player embedded as a child that fills it.
//  A song's lyrics are drawn in the player's own content overlay, under its controls.
//

#if !os(tvOS)

import AVKit
import UIKit

final class AudioPlayerContainerViewController: UIViewController {

    var onWillDismiss: (() -> Void)?
    var onDismissed: (() -> Void)?

    private let playerViewController: AVPlayerViewController

    init(playerViewController: AVPlayerViewController) {
        self.playerViewController = playerViewController
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        // Always over dark artwork, so AVKit draws its light controls.
        overrideUserInterfaceStyle = .dark

        addChild(playerViewController)
        playerViewController.view.frame = view.bounds
        playerViewController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(playerViewController.view)
        playerViewController.didMove(toParent: self)
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
