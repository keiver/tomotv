//
//  RemoteTouch.swift
//  TomoTV
//
//  Two touches on the Apple TV remote's surface, with no click, sent to JS while a screen asks for them.
//

import Foundation
import React
import UIKit

@objc(RemoteTouch)
class RemoteTouch: RCTEventEmitter, UIGestureRecognizerDelegate {

    private var hasListeners = false

    #if os(tvOS)
    private lazy var doubleTouch: UITapGestureRecognizer = {
        let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTouch))
        recognizer.numberOfTapsRequired = 2
        recognizer.allowedPressTypes = []
        recognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirect.rawValue)]
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.delegate = self
        return recognizer
    }()

    @objc
    private func handleDoubleTouch() {
        NSLog("[RemoteTouch] double touch")
        guard hasListeners else { return }
        sendEvent(withName: "onRemoteDoubleTouch", body: nil)
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
    #endif

    @objc override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! { ["onRemoteDoubleTouch"] }

    override func startObserving() { hasListeners = true }

    override func stopObserving() { hasListeners = false }

    @objc(setArmed:)
    func setArmed(_ armed: Bool) {
        #if os(tvOS)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let recognizer = self.doubleTouch
            recognizer.view?.removeGestureRecognizer(recognizer)
            guard armed else { return }
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
            window?.addGestureRecognizer(recognizer)
            NSLog("[RemoteTouch] armed: \(window != nil)")
        }
        #endif
    }

    override func invalidate() {
        #if os(tvOS)
        DispatchQueue.main.async { [self] in
            doubleTouch.view?.removeGestureRecognizer(doubleTouch)
        }
        #endif
        super.invalidate()
    }
}
