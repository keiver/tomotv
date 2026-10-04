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

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func loadTunerGroups(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let requestId = config["requestId"] as? String, let text = config["url"] as? String, let url = URL(string: text) else {
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
                        resolve(["groups": groups, "channels": channels, "tvgUrls": store.playlistHeader.tvgUrls, "stats": Self.dictionary(stats)])
                    case let .failure(error):
                        reject("load_failed", String(describing: error), error)
                    }
                }
            }
        }
    }

    @objc func cancelLoad(_ requestId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.loaders.removeValue(forKey: requestId)?.cancel()
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
