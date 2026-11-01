//
//  SubtitlePanelState.swift
//  TomoTV
//
//  What the tvOS subtitle panel draws, as JS sends it: every string already in the viewer's
//  language, so the panel holds no copy of its own.
//

import Foundation

public struct SubtitlePanelLanguage: Codable, Equatable {
    public let code: String
    public let name: String

    public init(code: String, name: String) {
        self.code = code
        self.name = name
    }
}

public struct SubtitlePanelResult: Codable, Equatable {
    public let id: String
    public let name: String
    /// Source, downloads, rating and author, joined for the second line.
    public let meta: String
    public let badges: [String]
    public let monogram: String
    public let hashMatch: Bool
    public let applying: Bool
    public let applied: Bool

    public init(id: String, name: String, meta: String, badges: [String], monogram: String, hashMatch: Bool, applying: Bool, applied: Bool) {
        self.id = id
        self.name = name
        self.meta = meta
        self.badges = badges
        self.monogram = monogram
        self.hashMatch = hashMatch
        self.applying = applying
        self.applied = applied
    }
}

/// The subtitle that is on, with the words its timing controls show.
public struct SubtitlePanelCurrent: Codable, Equatable {
    public let name: String
    public let meta: String
    /// The source letter of a device copy, empty for a track of the file.
    public let monogram: String
    public let offsetLabel: String
    public let earlierLabel: String
    public let laterLabel: String
    public let resetLabel: String

    public init(name: String, meta: String, monogram: String, offsetLabel: String, earlierLabel: String, laterLabel: String, resetLabel: String) {
        self.name = name
        self.meta = meta
        self.monogram = monogram
        self.offsetLabel = offsetLabel
        self.earlierLabel = earlierLabel
        self.laterLabel = laterLabel
        self.resetLabel = resetLabel
    }
}

public struct SubtitlePanelState: Codable, Equatable {
    public let title: String
    /// Set while a subtitle is on: the panel leads with its timing controls.
    public let current: SubtitlePanelCurrent?
    public let query: String
    public let queryPlaceholder: String
    /// The search button's word.
    public let searchLabel: String
    public let languages: [SubtitlePanelLanguage]
    public let selectedLanguage: String
    /// Searching, N results, nothing found, saved: the line under the field.
    public let stateLine: String
    /// A source that refused this session, or empty.
    public let note: String
    public let busy: Bool
    public let results: [SubtitlePanelResult]

    public init(title: String, current: SubtitlePanelCurrent? = nil, query: String, queryPlaceholder: String, searchLabel: String, languages: [SubtitlePanelLanguage], selectedLanguage: String, stateLine: String, note: String, busy: Bool, results: [SubtitlePanelResult]) {
        self.title = title
        self.current = current
        self.query = query
        self.queryPlaceholder = queryPlaceholder
        self.searchLabel = searchLabel
        self.languages = languages
        self.selectedLanguage = selectedLanguage
        self.stateLine = stateLine
        self.note = note
        self.busy = busy
        self.results = results
    }

    /// The state a React Native dictionary describes, or nil when a required field is missing.
    public static func from(dictionary: [String: Any]) -> SubtitlePanelState? {
        guard JSONSerialization.isValidJSONObject(dictionary), let data = try? JSONSerialization.data(withJSONObject: dictionary) else { return nil }
        return try? JSONDecoder().decode(SubtitlePanelState.self, from: data)
    }

    /// The language the chip row should show selected: the selected code's position, else the first.
    public var selectedLanguageIndex: Int {
        languages.firstIndex(where: { $0.code == selectedLanguage }) ?? 0
    }

    /// Which rows changed between two states, so a table reloads only those.
    public func changedResultRows(from previous: SubtitlePanelState) -> [Int]? {
        guard previous.results.count == results.count else { return nil }
        return results.indices.filter { results[$0] != previous.results[$0] }
    }
}
