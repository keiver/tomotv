//
//  TVToast.swift
//  TomoTV
//
//  A transient notification pill in its own non-interactive window, so it draws above
//  everything the app presents, the AVKit player included. The window never becomes key
//  and takes no touches, which on tvOS keeps it out of the focus engine's way, unlike a
//  React Native view, which Fabric forces interactive and which occludes focus beneath it.
//

import UIKit

@objc(TVToast)
class TVToast: NSObject {
    private static var window: UIWindow?
    private static var pill: UIView?
    private static var label: UILabel?
    private static var hideWork: DispatchWorkItem?

    @objc
    func show(_ message: String, isError: Bool) {
        DispatchQueue.main.async { TVToast.present(message, isError: isError) }
    }

    private static func present(_ message: String, isError: Bool) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return }
        let window = self.window ?? makeWindow()
        if window.windowScene !== scene { window.windowScene = scene }

        label?.text = message
        // The app's SURFACE_RAISED and DESTRUCTIVE_DEEP tokens.
        pill?.backgroundColor = isError
            ? UIColor(red: 215 / 255, green: 0, blue: 21 / 255, alpha: 0.96)
            : UIColor(red: 35 / 255, green: 35 / 255, blue: 38 / 255, alpha: 0.96)

        hideWork?.cancel()
        window.isHidden = false
        window.layoutIfNeeded()
        UIView.animate(withDuration: 0.2) { pill?.alpha = 1 }

        let work = DispatchWorkItem {
            UIView.animate(withDuration: 0.3, animations: { pill?.alpha = 0 }) { finished in
                if finished, pill?.alpha == 0 { self.window?.isHidden = true }
            }
        }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: work)
    }

    private static func makeWindow() -> UIWindow {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.windowLevel = .alert
        window.isUserInteractionEnabled = false
        let controller = UIViewController()
        controller.view.backgroundColor = .clear
        controller.view.isUserInteractionEnabled = false
        window.rootViewController = controller

        let pill = UIView()
        pill.translatesAutoresizingMaskIntoConstraints = false
        pill.layer.cornerRadius = 24
        pill.alpha = 0

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.textColor = .white
        label.font = .systemFont(ofSize: 29, weight: .medium)
        label.numberOfLines = 2
        label.textAlignment = .center

        pill.addSubview(label)
        controller.view.addSubview(pill)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: pill.topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: pill.bottomAnchor, constant: -12),
            label.leadingAnchor.constraint(equalTo: pill.leadingAnchor, constant: 28),
            label.trailingAnchor.constraint(equalTo: pill.trailingAnchor, constant: -28),
            // The screen's upper right, 12% down from the top edge, clear of the player
            // chrome's bottom band and of AVKit's own top-right badges.
            pill.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -90),
            NSLayoutConstraint(item: pill, attribute: .centerY, relatedBy: .equal, toItem: controller.view, attribute: .bottom, multiplier: 0.12, constant: 0),
            pill.widthAnchor.constraint(lessThanOrEqualTo: controller.view.widthAnchor, multiplier: 0.5),
        ])

        self.window = window
        self.pill = pill
        self.label = label
        return window
    }
}
