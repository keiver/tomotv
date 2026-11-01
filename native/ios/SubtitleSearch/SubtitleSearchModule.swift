//
//  SubtitleSearchModule.swift
//  TomoTV
//
//  React Native module for the tvOS subtitle panel: a view controller presented over whatever is
//  on top (the video player), fed its state by JS and reporting the viewer's choices back.
//

import Foundation
import React
import UIKit

@objc(SubtitleSearch)
class SubtitleSearchModule: RCTEventEmitter {
    private static let queryChanged = "onSubtitlePanelQueryChanged"
    private static let languageChanged = "onSubtitlePanelLanguageChanged"
    private static let picked = "onSubtitlePanelPick"
    private static let shifted = "onSubtitlePanelShift"
    private static let synced = "onSubtitlePanelSync"
    private static let dismissed = "onSubtitlePanelDismissed"

    #if os(tvOS)
        private weak var panel: SubtitleSearchPanelViewController?
    #endif

    @objc override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        [Self.queryChanged, Self.languageChanged, Self.picked, Self.shifted, Self.synced, Self.dismissed]
    }

    @objc func present(_ state: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if os(tvOS)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard let decoded = SubtitlePanelState.from(dictionary: state as? [String: Any] ?? [:]) else {
                    reject("invalid_state", "present needs a panel state", nil)
                    return
                }
                if let open = self.panel, open.viewIfLoaded?.window != nil {
                    open.apply(decoded)
                    resolve(nil)
                    return
                }
                guard let top = self.topViewController() else {
                    reject("no_presenter", "nothing on screen to present over", nil)
                    return
                }
                let controller = SubtitleSearchPanelViewController(state: decoded)
                controller.onQueryChanged = { [weak self] query in self?.sendEvent(withName: Self.queryChanged, body: ["query": query]) }
                controller.onLanguageChanged = { [weak self] code in self?.sendEvent(withName: Self.languageChanged, body: ["code": code]) }
                controller.onPick = { [weak self] id in self?.sendEvent(withName: Self.picked, body: ["id": id]) }
                controller.onShift = { [weak self] deltaMs in self?.sendEvent(withName: Self.shifted, body: ["deltaMs": deltaMs.map { $0 as Any } ?? NSNull()]) }
                controller.onSync = { [weak self] in self?.sendEvent(withName: Self.synced, body: [:]) }
                controller.onDismissed = { [weak self] in
                    self?.panel = nil
                    self?.sendEvent(withName: Self.dismissed, body: [:])
                }
                self.panel = controller
                top.present(controller, animated: true) { resolve(nil) }
            }
        #else
            reject("unsupported", "the subtitle panel is tvOS only", nil)
        #endif
    }

    @objc func update(_ state: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if os(tvOS)
            DispatchQueue.main.async { [weak self] in
                guard let decoded = SubtitlePanelState.from(dictionary: state as? [String: Any] ?? [:]) else {
                    reject("invalid_state", "update needs a panel state", nil)
                    return
                }
                self?.panel?.apply(decoded)
                resolve(nil)
            }
        #else
            reject("unsupported", "the subtitle panel is tvOS only", nil)
        #endif
    }

    @objc func dismiss(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        #if os(tvOS)
            DispatchQueue.main.async { [weak self] in
                guard let open = self?.panel else {
                    resolve(nil)
                    return
                }
                open.closeQuietly { resolve(nil) }
            }
        #else
            resolve(nil)
        #endif
    }

    private func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
