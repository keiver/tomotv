//
//  LyricsListenerModule.swift
//  TomoTV
//
//  React Native module over LyricsListener: whether this device can listen, and one song's
//  heard words.
//

import Foundation
import React

@objc(LyricsListener)
class LyricsListenerModule: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func capability(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["available": LyricsListener.isAvailable])
    }

    /// config: { fileUri, lyrics?, languages }. Resolves { locale, words: [[start, end, text]] },
    /// or null when the device or the language cannot be listened to.
    @objc func transcribe(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let text = config["fileUri"] as? String, let file = URL(string: text), file.isFileURL else {
            reject("invalid_config", "transcribe needs a file URI", nil)
            return
        }
        guard #available(iOS 26.0, tvOS 26.0, *), LyricsListener.isAvailable else {
            resolve(NSNull())
            return
        }
        let lyrics = config["lyrics"] as? String
        let languages = config["languages"] as? [String] ?? ["en"]
        Task.detached(priority: .utility) {
            do {
                guard let heard = try await LyricsListener.transcribe(file: file, lyrics: lyrics, languages: languages) else {
                    resolve(NSNull())
                    return
                }
                resolve(["locale": heard.locale, "words": heard.words.map { [$0.start, $0.end, $0.text] as [Any] }])
            } catch {
                reject("transcribe_failed", String(describing: error), error)
            }
        }
    }
}
