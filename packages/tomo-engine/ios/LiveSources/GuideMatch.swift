//
//  GuideMatch.swift
//  TomoTV
//
//  Which guide channels an app's channels can pair with, by the three passes of tomo-live's
//  guideMatch.ts: tvg-id against the channel id, tvg-name against display-names as written or with
//  spaces as underscores, then a name against display-names. Case is ignored and the first guide
//  channel in file order wins. The parser keeps programmes only for the channels this returns.
//

import Foundation

/// One app channel, with every name the app may ask the guide about it by.
struct GuideChannelRequest: Equatable {
    var tvgId: String?
    var tvgName: String?
    var names: [String]
}

struct GuideChannelMatcher {
    let requests: [GuideChannelRequest]

    /// Every guide channel id any pass pairs with any request: a superset of the single pairing
    /// guideMatch.ts settles on per request, so no channel it picks ever lacks its programmes.
    func pairedIds(_ channels: [GuideChannel]) -> Set<String> {
        var ids: [String: String] = [:]
        var names: [String: String] = [:]
        var underscored: [String: String] = [:]
        for channel in channels {
            Self.setFirst(&ids, Self.fold(channel.id), channel.id)
            for name in [channel.id] + channel.displayNames {
                let folded = Self.fold(name)
                Self.setFirst(&names, folded, channel.id)
                Self.setFirst(&underscored, folded.replacingOccurrences(of: " ", with: "_"), channel.id)
            }
        }
        var paired = Set<String>()
        for request in requests {
            if let tvgId = request.tvgId, let id = ids[Self.fold(tvgId)] { paired.insert(id) }
            if let tvgName = request.tvgName {
                let folded = Self.fold(tvgName)
                if let id = names[folded] ?? underscored[folded] { paired.insert(id) }
            }
            for name in request.names {
                if let id = names[Self.fold(name)] { paired.insert(id) }
            }
        }
        return paired
    }

    /// guideMatch.ts's `fold`: trimmed and lower case.
    static func fold(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func setFirst(_ map: inout [String: String], _ key: String, _ id: String) {
        if !key.isEmpty, map[key] == nil { map[key] = id }
    }
}
