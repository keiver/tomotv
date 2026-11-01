//
//  SubtitleSearchModule.swift
//  TomoTV
//
//  React Native module for the subtitle panel: a view controller presented over whatever is on
//  top (the player, or the info panel), fed its state by JS and reporting the viewer's choices back.
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
    private static let replaced = "onSubtitlePanelReplace"
    private static let tookAll = "onSubtitlePanelTakeAll"
    private static let dismissed = "onSubtitlePanelDismissed"

    private weak var panel: SubtitleSearchPanelViewController?

    @objc override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        [Self.queryChanged, Self.languageChanged, Self.picked, Self.shifted, Self.synced, Self.replaced, Self.tookAll, Self.dismissed]
    }

    @objc func present(_ state: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
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
            controller.onQueryChanged = { [weak self] jobId, query in self?.sendEvent(withName: Self.queryChanged, body: ["jobId": jobId, "query": query]) }
            controller.onLanguageChanged = { [weak self] code in self?.sendEvent(withName: Self.languageChanged, body: ["code": code]) }
            controller.onPick = { [weak self] jobId, id in self?.sendEvent(withName: Self.picked, body: ["jobId": jobId, "id": id]) }
            controller.onShift = { [weak self] trackId, deltaMs in self?.sendEvent(withName: Self.shifted, body: ["trackId": trackId, "deltaMs": deltaMs.map { $0 as Any } ?? NSNull()]) }
            controller.onSync = { [weak self] trackId in self?.sendEvent(withName: Self.synced, body: ["trackId": trackId]) }
            controller.onReplace = { [weak self] trackId in self?.sendEvent(withName: Self.replaced, body: ["trackId": trackId]) }
            controller.onTakeAll = { [weak self] in self?.sendEvent(withName: Self.tookAll, body: [:]) }
            controller.onDismissed = { [weak self] in
                self?.panel = nil
                self?.sendEvent(withName: Self.dismissed, body: [:])
            }
            self.panel = controller
            top.present(controller, animated: true) { resolve(nil) }
        }
    }

    @objc func update(_ state: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            guard let decoded = SubtitlePanelState.from(dictionary: state as? [String: Any] ?? [:]) else {
                reject("invalid_state", "update needs a panel state", nil)
                return
            }
            self?.panel?.apply(decoded)
            resolve(nil)
        }
    }

    @objc func dismiss(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            guard let open = self?.panel else {
                resolve(nil)
                return
            }
            open.closeQuietly { resolve(nil) }
        }
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
