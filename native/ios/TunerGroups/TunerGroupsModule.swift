//
//  TunerGroupsModule.swift
//  TomoTV
//
//  React Native module that streams a Jellyfin M3U tuner's playlist through the engine's
//  playlist loader and resolves its groups with the server's channel ids; nothing is kept.
//

import Foundation
import React
import TomoLiveSources

@objc(TunerGroups)
class TunerGroupsModule: NSObject {
    private static let queue = DispatchQueue(label: "dev.keiver.tomotv.tunergroups", qos: .userInitiated)
    private static var loaders: [String: PlaylistLoader] = [:]
    /// Loaded stores held for row paging until the caller releases them, with the tuner hash hoisted.
    private static var stores: [String: (store: PlaylistStore, tunerHash: String)] = [:]

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func loadTunerGroups(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let requestId = config["requestId"] as? String, let text = config["url"] as? String,
              let url = URL(string: config["fetchUrl"] as? String ?? text) else {
            reject("invalid_config", "loadTunerGroups needs requestId and url", nil)
            return
        }
        let userAgent = config["userAgent"] as? String
        let headers = userAgent.map { ["User-Agent": $0] } ?? [:]
        Self.queue.async {
            let store = PlaylistStore()
            Self.loaders[requestId] = PlaylistLoader.load(url: url, headers: headers, store: store) { result in
                Self.queue.async {
                    Self.loaders[requestId] = nil
                    switch result {
                    case let .success(stats):
                        let entries = store.allEntries
                        let groups: [[String: Any]] = TunerGroups.groups(entries: entries, tunerUrl: text).map { ["name": $0.name, "channelIds": $0.channelIds] }
                        let channels: [[String: Any]] = TunerGroups.channels(entries: entries, tunerUrl: text).map { ["id": $0.id, "tvgId": $0.tvgId ?? NSNull(), "tvgName": $0.tvgName ?? NSNull()] }
                        Self.stores[requestId] = (store, JellyfinChannelId.md5Guid(text))
                        resolve([
                            "groups": groups, "channels": channels, "tvgUrls": store.playlistHeader.tvgUrls,
                            "entryCount": store.count, "stats": Self.dictionary(stats),
                        ])
                    case let .failure(error):
                        reject("load_failed", String(describing: error), error)
                    }
                }
            }
        }
    }

    /// Channel rows for the loaded playlist's entries in [offset, offset+limit): entries Jellyfin
    /// would not make channels of are left out, so a page can come back shorter than `limit`.
    @objc func tunerRows(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let requestId = config["requestId"] as? String, let offset = config["offset"] as? Int, let limit = config["limit"] as? Int else {
            reject("invalid_config", "tunerRows needs requestId, offset and limit", nil)
            return
        }
        Self.queue.async {
            guard let held = Self.stores[requestId] else {
                reject("released", "tunerRows called on a released playlist", nil)
                return
            }
            let rows: [[String: Any]] = held.store.entries(group: nil, offset: offset, limit: limit)
                .compactMap { TunerGroups.row(entry: $0, tunerHash: held.tunerHash) }
                .map {
                    [
                        "id": $0.id, "name": $0.name, "number": $0.number ?? NSNull(), "logo": $0.logo ?? NSNull(),
                        "url": $0.url, "headers": $0.headers, "groups": $0.groups,
                        "tvgId": $0.tvgId ?? NSNull(), "tvgName": $0.tvgName ?? NSNull(),
                        "radio": $0.radio, "drm": $0.drm,
                    ]
                }
            resolve(rows)
        }
    }

    /// Frees the store `loadTunerGroups` held for row paging.
    @objc func releaseTunerPlaylist(_ requestId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.stores[requestId] = nil
            resolve(nil)
        }
    }

    @objc func cancelLoad(_ requestId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.loaders.removeValue(forKey: requestId)?.cancel()
            Self.stores[requestId] = nil
            resolve(nil)
        }
    }

    private static func dictionary(_ stats: PlaylistStats) -> [String: Int] {
        [
            "firstByteMs": stats.load.firstByteMs, "totalMs": stats.load.totalMs, "workMs": stats.load.workMs,
            "networkBytes": stats.load.networkBytes, "inflatedBytes": stats.load.inflatedBytes,
            "footprintBeforeBytes": stats.load.footprintBeforeBytes, "peakFootprintBytes": stats.load.peakFootprintBytes,
            "footprintAfterBytes": stats.load.footprintAfterBytes,
            "entries": stats.entries, "groups": stats.groups,
        ]
    }
}
