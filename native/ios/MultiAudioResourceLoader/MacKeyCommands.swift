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

    /// Every unconditional key past Escape: the input, its modifiers, the name JS receives, and
    /// the title the hold-⌘ HUD lists. All of them carry a modifier. A bare key belongs in
    /// contextCommands instead, or it is taken from the rest of the app for nothing: space
    /// registered here answered every press with "ignore" while nothing played, which is how it
    /// stopped activating a focused control.
    private static let extraCommands: [(input: String, modifiers: UIKeyModifierFlags, key: String, title: String)] = [
        (UIKeyCommand.inputLeftArrow, .command, "previousTrack", "Previous Track"),
        (UIKeyCommand.inputRightArrow, .command, "nextTrack", "Next Track"),
        ("f", .command, "search", "Search"),
        (",", .command, "settings", "Settings"),
    ]

    /// Keys offered only while a screen has claimed them. Registered unconditionally the bare
    /// arrows would outrank the arrow scrolling every grid relies on, and Return would outrank
    /// activating whatever control is focused: a key command is collected before the responder
    /// that would otherwise have used the key. Return is "\r"; UIKit defines no constant for it.
    private static func contextCommands(for context: String) -> [(input: String, key: String, title: String)] {
        switch context {
        case "photo":
            return [
                (UIKeyCommand.inputLeftArrow, "previousPhoto", "Previous Photo"),
                (UIKeyCommand.inputRightArrow, "nextPhoto", "Next Photo"),
            ]
        case "seek":
            return [
                (UIKeyCommand.inputLeftArrow, "seekBackward", "Back 15 Seconds"),
                (UIKeyCommand.inputRightArrow, "seekForward", "Forward 15 Seconds"),
                ("\r", "playPause", "Play or Pause"),
                (" ", "playPause", "Play or Pause"),
            ]
        default:
            return []
        }
    }

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
            commands += Self.contextCommands(for: MacKeyCommands.keyContext).map { entry in
                let command = UIKeyCommand(
                    title: entry.title,
                    action: #selector(handleKey(_:)),
                    input: entry.input,
                    modifierFlags: [],
                    propertyList: entry.key,
                    discoverabilityTitle: entry.title
                )
                // AVKit answers these itself from nearer the first responder when it wants
                // them, and a presented player must keep its own transport.
                command.wantsPriorityOverSystemBehavior = false
                return command
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

    /// Double click, read here rather than in JS because AVKit owns the recognizers over the
    /// player. react-native-gesture-handler refuses to co-recognise with anything that is not
    /// one of its own handlers (RNGestureHandler.mm, shouldRecognizeSimultaneouslyWith), so
    /// AVKit's single tap recognises first and fails the pending double tap every time. This
    /// one declares the opposite: it never cancels AVKit's touches and always co-recognises.
    private lazy var doubleClick: UITapGestureRecognizer = {
        let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleDoubleClick))
        recognizer.numberOfTapsRequired = 2
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.delegate = self
        return recognizer
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        guard MacKeyCommands.isMacHost else { return }
        view.addGestureRecognizer(doubleClick)
    }

    /// Only while a player owns the contextual keys, so a double click anywhere else in the app
    /// stays the app's own.
    @objc
    private func handleDoubleClick() {
        guard MacKeyCommands.keyContext == "seek" else { return }
        NSLog("[MacKeyCommands] double click")
        MacKeyCommands.emit(key: "toggleVideoFill")
    }

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

extension MacKeyCommandsViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
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

    /// Which screen currently owns the contextual keys: "photo", "seek", or "" for nobody.
    /// Written from JS as a screen mounts and cleared as it leaves, read every time UIKit
    /// collects key commands.
    private static var keyContextStorage = ""

    static var keyContext: String {
        lock.lock()
        defer { lock.unlock() }
        return keyContextStorage
    }

    @objc(setKeyContext:)
    func setKeyContext(_ context: String) {
        Self.lock.lock()
        Self.keyContextStorage = context
        Self.lock.unlock()
        NSLog("[MacKeyCommands] key context: \(context.isEmpty ? "none" : context)")
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
