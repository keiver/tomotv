//
//  LiveSources.swift
//  TomoTV
//
//  React Native module for live TV sources: XMLTV guides and M3U playlists loaded into native
//  stores and queried by token (the oldest of each closed when a third loads), plus a Jellyfin
//  tuner's playlist groups mapped to the server's channel ids.
//

import Foundation
import React

@objc(LiveSources)
class LiveSources: NSObject {
    private static let queue = DispatchQueue(label: "dev.keiver.tomotv.livesources", qos: .userInitiated)
    private static var guides: [String: GuideStore] = [:]
    private static var guideLoaders: [String: GuideLoader] = [:]
    private static var guideOrder: [String] = []
    private static var playlists: [String: PlaylistStore] = [:]
    private static var playlistLoaders: [String: PlaylistLoader] = [:]
    private static var playlistOrder: [String] = []
    private static var tunerLoaders: [String: PlaylistLoader] = [:]
    private static let maxOpen = 2

    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: Guides

    @objc func loadGuide(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let text = config["url"] as? String, let url = URL(string: text) else {
            reject("invalid_config", "loadGuide needs a url", nil)
            return
        }
        guard let headers = Self.headers(config) else {
            reject("invalid_config", "headers must be a string map", nil)
            return
        }
        let window: GuideWindow?
        switch Self.window(config, required: false) {
        case let .success(value): window = value
        case let .failure(error):
            reject("invalid_config", error.localizedDescription, nil)
            return
        }
        Self.queue.async {
            let token = UUID().uuidString
            let store = GuideStore()
            Self.guides[token] = store
            Self.guideLoaders[token] = GuideLoader.load(url: url, window: window, headers: headers, store: store) { result in
                Self.queue.async {
                    Self.guideLoaders[token] = nil
                    // A cancelled or evicted load has no store to resolve into.
                    guard Self.guides[token] != nil else {
                        reject("closed", "Guide \(token) was closed", nil)
                        return
                    }
                    switch result {
                    case let .success(stats):
                        Self.guideOrder.append(token)
                        while Self.guideOrder.count > Self.maxOpen, let oldest = Self.guideOrder.first { Self.closeGuide(oldest) }
                        resolve(["token": token, "stats": Self.dictionary(stats)])
                    case let .failure(error):
                        Self.closeGuide(token)
                        reject("load_failed", String(describing: error), error)
                    }
                }
            }
        }
    }

    @objc func guideChannels(_ token: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            guard let store = Self.guides[token] else {
                reject("closed", "Guide \(token) is not open", nil)
                return
            }
            let channels: [[String: Any]] = store.channels.map { ["id": $0.id, "displayNames": $0.displayNames, "icon": $0.icon ?? NSNull()] }
            resolve(channels)
        }
    }

    @objc func guideProgrammes(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let token = config["token"] as? String, let channelIds = config["channelIds"] as? [String] else {
            reject("invalid_config", "guideProgrammes needs token and channelIds", nil)
            return
        }
        guard case let .success(window?) = Self.window(config, required: true) else {
            reject("invalid_config", "guideProgrammes needs finite from and to", nil)
            return
        }
        Self.queue.async {
            guard let store = Self.guides[token] else {
                reject("closed", "Guide \(token) is not open", nil)
                return
            }
            resolve(store.programmes(channelIds: channelIds, window: window).map(Self.dictionary))
        }
    }

    @objc func closeGuide(_ token: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.closeGuide(token)
            resolve(nil)
        }
    }

    // MARK: Playlists

    @objc func loadPlaylist(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let text = config["url"] as? String, let url = URL(string: text) else {
            reject("invalid_config", "loadPlaylist needs a url", nil)
            return
        }
        guard let headers = Self.headers(config) else {
            reject("invalid_config", "headers must be a string map", nil)
            return
        }
        Self.queue.async {
            let token = UUID().uuidString
            let store = PlaylistStore()
            Self.playlists[token] = store
            Self.playlistLoaders[token] = PlaylistLoader.load(url: url, headers: headers, store: store) { result in
                Self.queue.async {
                    Self.playlistLoaders[token] = nil
                    guard Self.playlists[token] != nil else {
                        reject("closed", "Playlist \(token) was closed", nil)
                        return
                    }
                    switch result {
                    case let .success(stats):
                        Self.playlistOrder.append(token)
                        while Self.playlistOrder.count > Self.maxOpen, let oldest = Self.playlistOrder.first { Self.closePlaylist(oldest) }
                        resolve(["token": token, "stats": Self.dictionary(stats), "header": Self.dictionary(store.playlistHeader)])
                    case let .failure(error):
                        Self.closePlaylist(token)
                        reject("load_failed", String(describing: error), error)
                    }
                }
            }
        }
    }

    @objc func playlistGroups(_ token: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            guard let store = Self.playlists[token] else {
                reject("closed", "Playlist \(token) is not open", nil)
                return
            }
            let groups: [[String: Any]] = store.groups.map { ["name": $0.name, "count": $0.count] }
            resolve(groups)
        }
    }

    @objc func playlistEntries(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let token = config["token"] as? String, let offset = config["offset"] as? Int, let limit = config["limit"] as? Int else {
            reject("invalid_config", "playlistEntries needs token, offset and limit", nil)
            return
        }
        let group = config["group"] as? String
        Self.queue.async {
            guard let store = Self.playlists[token] else {
                reject("closed", "Playlist \(token) is not open", nil)
                return
            }
            resolve(store.entries(group: group, offset: offset, limit: limit).map(Self.dictionary))
        }
    }

    @objc func closePlaylist(_ token: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.closePlaylist(token)
            resolve(nil)
        }
    }

    // MARK: Jellyfin tuner groups

    /// Streams a Jellyfin M3U tuner's playlist and resolves its groups with the server's channel ids; nothing is kept.
    @objc func loadTunerGroups(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let requestId = config["requestId"] as? String, let text = config["url"] as? String, let url = URL(string: text) else {
            reject("invalid_config", "loadTunerGroups needs requestId and url", nil)
            return
        }
        let userAgent = config["userAgent"] as? String
        let headers = userAgent.map { ["User-Agent": $0] } ?? [:]
        Self.queue.async {
            let store = PlaylistStore()
            Self.tunerLoaders[requestId] = PlaylistLoader.load(url: url, headers: headers, store: store) { result in
                Self.queue.async {
                    Self.tunerLoaders[requestId] = nil
                    switch result {
                    case let .success(stats):
                        let entries = store.allEntries
                        let groups: [[String: Any]] = TunerGroups.groups(entries: entries, tunerUrl: text).map { ["name": $0.name, "channelIds": $0.channelIds] }
                        let channels: [[String: Any]] = TunerGroups.channels(entries: entries, tunerUrl: text).map { ["id": $0.id, "tvgId": $0.tvgId] }
                        resolve(["groups": groups, "channels": channels, "stats": Self.dictionary(stats)])
                    case let .failure(error):
                        reject("load_failed", String(describing: error), error)
                    }
                }
            }
        }
    }

    @objc func cancelLoad(_ requestId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.tunerLoaders.removeValue(forKey: requestId)?.cancel()
            resolve(nil)
        }
    }

    @objc func memoryFootprint(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        resolve(MemoryFootprint.bytes())
    }

    // MARK: Helpers

    private static func closeGuide(_ token: String) {
        guideLoaders.removeValue(forKey: token)?.cancel()
        guides[token] = nil
        guideOrder.removeAll { $0 == token }
    }

    private static func closePlaylist(_ token: String) {
        playlistLoaders.removeValue(forKey: token)?.cancel()
        playlists[token] = nil
        playlistOrder.removeAll { $0 == token }
    }

    /// Nil when a header value is not a string, so a lost credential is an error rather than a silent omission.
    private static func headers(_ config: NSDictionary) -> [String: String]? {
        guard let raw = config["headers"] else { return [:] }
        return raw as? [String: String]
    }

    private struct WindowError: LocalizedError {
        var errorDescription: String? { "from and to must be finite epoch milliseconds" }
    }

    /// `from` and `to` as finite doubles; absent is nil when not required. Non-finite values never reach Int64.
    private static func window(_ config: NSDictionary, required: Bool) -> Result<GuideWindow?, Error> {
        let from = config["from"], to = config["to"]
        if from == nil, to == nil, !required { return .success(nil) }
        guard let from = from as? Double, let to = to as? Double, from.isFinite, to.isFinite,
              abs(from) < 9.0e18, abs(to) < 9.0e18
        else { return .failure(WindowError()) }
        return .success(GuideWindow(from: Int64(from), to: Int64(to)))
    }

    private static func dictionary(_ load: LoadStats) -> [String: Int] {
        [
            "firstByteMs": load.firstByteMs, "totalMs": load.totalMs, "workMs": load.workMs,
            "networkBytes": load.networkBytes, "inflatedBytes": load.inflatedBytes,
            "footprintBeforeBytes": load.footprintBeforeBytes, "peakFootprintBytes": load.peakFootprintBytes,
            "footprintAfterBytes": load.footprintAfterBytes,
        ]
    }

    private static func dictionary(_ stats: GuideStats) -> [String: Int] {
        dictionary(stats.load).merging(["channels": stats.channels, "programmes": stats.programmes, "skipped": stats.skipped, "errors": stats.errors]) { $1 }
    }

    private static func dictionary(_ stats: PlaylistStats) -> [String: Int] {
        dictionary(stats.load).merging(["entries": stats.entries, "groups": stats.groups]) { $1 }
    }

    private static func dictionary(_ header: M3uHeader) -> [String: Any] {
        [
            "tvgUrls": header.tvgUrls,
            "tvgShift": header.tvgShift ?? NSNull(),
            "catchup": header.catchup.map(dictionary) ?? NSNull(),
            "attrs": header.attrs,
        ]
    }

    private static func dictionary(_ catchup: M3uCatchup) -> [String: Any] {
        ["type": catchup.type ?? NSNull(), "source": catchup.source ?? NSNull(), "days": catchup.days ?? NSNull()]
    }

    private static func dictionary(_ entry: M3uEntry) -> [String: Any] {
        [
            "name": entry.name,
            "url": entry.url,
            "line": entry.line,
            "hasExtInf": entry.hasExtInf,
            "tvgId": entry.tvgId ?? NSNull(),
            "tvgName": entry.tvgName ?? NSNull(),
            "tvgLogo": entry.tvgLogo ?? NSNull(),
            "tvgChno": entry.tvgChno ?? NSNull(),
            "groups": entry.groups,
            "tvgShift": entry.tvgShift ?? NSNull(),
            "radio": entry.radio,
            "catchup": entry.catchup.map(dictionary) ?? NSNull(),
            "headers": entry.headers,
            "kodiProps": entry.kodiProps,
            "drm": entry.drm,
            "attrs": entry.attrs,
        ]
    }

    private static func dictionary(_ programme: GuideProgramme) -> [String: Any] {
        [
            "channel": programme.channel,
            "start": programme.start,
            "stop": programme.stop ?? NSNull(),
            "title": programme.title,
            "subTitle": programme.subTitle ?? NSNull(),
            "desc": programme.desc ?? NSNull(),
            "categories": programme.categories,
            "episodeNumbers": programme.episodeNumbers.map { number -> [String: Any] in ["system": number.system ?? NSNull(), "value": number.value] },
            "icon": programme.icon ?? NSNull(),
            "rating": programme.rating ?? NSNull(),
            "isNew": programme.isNew,
            "previouslyShown": programme.previouslyShown,
        ]
    }
}
