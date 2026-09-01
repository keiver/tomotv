//
//  MacKeyCommands.swift
//  TomoTV
//
//  Hardware keyboard support for the Mac build, where the player is inline and
//  carries no ✕ and no Menu button. Nothing here arms anywhere else: the view
//  controller is compiled for iOS only and both halves check the host at runtime.
//
//  The controller is installed by plugins/withMacKeyCommands.js through the react
//  delegate's createRootViewController extension point. That is deliberate: the
//  root view controller is the one responder that is an ancestor of every chain in
//  the app, AVKit's inline player included, and key commands are collected from the
//  first responder upwards, so anything AVKit answers itself still wins.
//

import Foundation
// Required with react-native-tvos's prebuilt React core (React.framework + VFS
// overlay): the bridging header's <React/RCTEventEmitter.h> resolves as
// framework-module content there, so the class only becomes visible to Swift
// through an explicit module import. Same trap LocalRemuxer.swift documents.
import React

#if os(iOS)
import UIKit

final class MacKeyCommandsViewController: UIViewController {

    /// Logged once. `keyCommands` is queried constantly, and the useful fact is
    /// whether UIKit ever asked this controller at all.
    private static var announcedCommands = false

    /// Every key past Escape: the input, its modifiers, the name JS receives, and the
    /// title the hold-⌘ HUD lists. Transport drives the audio queue — AVKit answers
    /// the player's own transport first, from nearer the first responder.
    private static let extraCommands: [(input: String, modifiers: UIKeyModifierFlags, key: String, title: String)] = [
        (" ", [], "playPause", "Play or Pause"),
        (UIKeyCommand.inputLeftArrow, .command, "previousTrack", "Previous Track"),
        (UIKeyCommand.inputRightArrow, .command, "nextTrack", "Next Track"),
        ("f", .command, "search", "Search"),
        (",", .command, "settings", "Settings"),
    ]

    override var keyCommands: [UIKeyCommand]? {
        guard MacKeyCommands.isMacHost else { return nil }
        let escape = UIKeyCommand(
            input: UIKeyCommand.inputEscape,
            modifierFlags: [],
            action: #selector(handleEscapeKey(_:))
        )
        // Escape carries system behaviour on a Mac, and the system wins by default:
        // without this the command is collected and never invoked.
        escape.wantsPriorityOverSystemBehavior = true
        // A title is what puts a command in the hold-⌘ list, which is the only
        // discovery surface an iOS binary has on a Mac.
        escape.discoverabilityTitle = "Back"

        var commands = [escape]
        // A command outranks the field it would otherwise type into, so every binding
        // but Escape is withdrawn while the viewer is editing.
        if Self.editingResponder(in: view.window) == nil {
            commands += Self.extraCommands.map { entry in
                UIKeyCommand(
                    title: entry.title,
                    action: #selector(handleKey(_:)),
                    input: entry.input,
                    modifierFlags: entry.modifiers,
                    propertyList: entry.key,
                    discoverabilityTitle: entry.title
                )
            }
        }

        if !Self.announcedCommands {
            Self.announcedCommands = true
            NSLog("[MacKeyCommands] UIKit asked for key commands, offering \(commands.count)")
        }
        return commands
    }

    /// The chain is walked from the first responder up, and with nothing focused
    /// there is no chain to walk. Claiming it here is what puts this controller in
    /// front of a press when the viewer has clicked nothing.
    override var canBecomeFirstResponder: Bool { MacKeyCommands.isMacHost }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard MacKeyCommands.isMacHost, !isFirstResponder else { return }
        let claimed = becomeFirstResponder()
        NSLog("[MacKeyCommands] first responder claimed: \(claimed)")
    }

    /// The first Escape leaves a text field, the second leaves the screen — the
    /// macOS convention, and what keeps Escape from navigating out of Search or
    /// the login form mid-typing.
    @objc
    private func handleEscapeKey(_ sender: UIKeyCommand) {
        if let editing = Self.editingResponder(in: view.window) {
            NSLog("[MacKeyCommands] escape resigned a text field")
            editing.resignFirstResponder()
            return
        }
        NSLog("[MacKeyCommands] escape pressed")
        MacKeyCommands.emit(key: "escape")
    }

    /// Everything but Escape. The key travels in the command's own propertyList, so
    /// a new binding costs a row in `extraCommands` and nothing else.
    @objc
    private func handleKey(_ sender: UIKeyCommand) {
        guard let key = sender.propertyList as? String else { return }
        NSLog("[MacKeyCommands] \(key) pressed")
        MacKeyCommands.emit(key: key)
    }

    /// The focused text input, if there is one. Walked rather than asked for:
    /// UIKit exposes no public accessor for the current first responder.
    private static func editingResponder(in root: UIView?) -> UIView? {
        guard let root else { return nil }
        if root.isFirstResponder, root is UITextInput { return root }
        for subview in root.subviews {
            if let found = editingResponder(in: subview) { return found }
        }
        return nil
    }
}
#endif

@objc(MacKeyCommands)
class MacKeyCommands: RCTEventEmitter {

    private static let lock = NSLock()

    /// The live emitter, or nil while nothing is subscribed. Weak because React
    /// owns the instance's life, and cleared on stopObserving so a key press can
    /// never reach a torn-down bridge.
    private static weak var listener: MacKeyCommands?

    /// Both ways this app reaches a desktop: the iOS binary run by macOS, and a
    /// future Catalyst build. False on every device we ship to today.
    static var isMacHost: Bool {
        let info = ProcessInfo.processInfo
        return info.isiOSAppOnMac || info.isMacCatalystApp
    }

    @objc override static func requiresMainQueueSetup() -> Bool { false }

    // RCTEventEmitter.h carries no nullability audit, so the imported Swift
    // signature is the implicitly-unwrapped [String]!.
    override func supportedEvents() -> [String]! { ["onMacKeyCommand"] }

    override func startObserving() {
        Self.lock.lock()
        Self.listener = self
        Self.lock.unlock()
        NSLog("[MacKeyCommands] JS subscribed")
    }

    override func stopObserving() {
        Self.lock.lock()
        if Self.listener === self { Self.listener = nil }
        Self.lock.unlock()
        NSLog("[MacKeyCommands] JS unsubscribed")
    }

    /// No listener, no event: RCTEventEmitter warns when it sends into nothing.
    /// Logged rather than dropped in silence, since a press that reaches here and
    /// stops is indistinguishable from one that never arrived.
    static func emit(key: String) {
        lock.lock()
        let target = listener
        lock.unlock()
        guard let target else {
            NSLog("[MacKeyCommands] \(key) had nowhere to go, nothing is subscribed")
            return
        }
        target.sendEvent(withName: "onMacKeyCommand", body: ["key": key])
    }
}
