//
//  SubtitlePanelState.swift
//  TomoTV
//
//  What the subtitle panel draws, as JS sends it: every string already in the viewer's
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

/// A text subtitle the video already has, with the words its timing controls show.
public struct SubtitlePanelTrack: Codable, Equatable {
    /// The stream index the shift and sync events name.
    public let id: Int
    public let name: String
    public let meta: String
    /// The source letter of a device copy, empty for a track of the file.
    public let monogram: String
    public let offsetLabel: String
    public let earlierLabel: String
    public let laterLabel: String
    public let resetLabel: String
    public let syncLabel: String
    public let replaceLabel: String
    /// A match can only run while the video plays; the sync button hides without it.
    public let canSync: Bool
    /// The in-player panel hides Replace: picking a result is the replacement there.
    public let canReplace: Bool
    /// The row a Replace press armed: the next pick replaces this copy.
    public let replacing: Bool
    /// A match against the audio is running: the sync button spins and takes no press.
    public let syncing: Bool
    /// The line under the row: how the last match went, empty when none ran.
    public let note: String

    public init(
        id: Int, name: String, meta: String, monogram: String, offsetLabel: String, earlierLabel: String, laterLabel: String, resetLabel: String, syncLabel: String,
        replaceLabel: String, canSync: Bool, canReplace: Bool, replacing: Bool, syncing: Bool, note: String
    ) {
        self.id = id
        self.name = name
        self.meta = meta
        self.monogram = monogram
        self.offsetLabel = offsetLabel
        self.earlierLabel = earlierLabel
        self.laterLabel = laterLabel
        self.resetLabel = resetLabel
        self.syncLabel = syncLabel
        self.replaceLabel = replaceLabel
        self.canSync = canSync
        self.canReplace = canReplace
        self.replacing = replacing
        self.syncing = syncing
        self.note = note
    }
}

/// One button for the whole set: applies every hash match and lone result at once.
public struct SubtitlePanelTakeAll: Codable, Equatable {
    public let label: String
    public let busy: Bool

    public init(label: String, busy: Bool) {
        self.label = label
        self.busy = busy
    }
}

/// One video's search: its own query, state and results. A lone job shows no heading.
public struct SubtitlePanelJob: Codable, Equatable {
    /// The item id the query and pick events name.
    public let id: String
    /// The episode mark ("S04E06"), empty for a movie or a lone video.
    public let label: String
    /// The video's title, empty when the job is the whole search.
    public let heading: String
    public let query: String
    /// Searching, N results, nothing found, saved: the line by the heading or field.
    public let stateLine: String
    /// A source that refused this session, or why a save stayed on the device; empty otherwise.
    public let note: String
    public let busy: Bool
    public let results: [SubtitlePanelResult]

    public init(id: String, label: String, heading: String, query: String, stateLine: String, note: String, busy: Bool, results: [SubtitlePanelResult]) {
        self.id = id
        self.label = label
        self.heading = heading
        self.query = query
        self.stateLine = stateLine
        self.note = note
        self.busy = busy
        self.results = results
    }
}

public struct SubtitlePanelState: Codable, Equatable {
    public let title: String
    /// The video's own text subtitles, led by their timing controls; the playing one alone in-player.
    public let tracks: [SubtitlePanelTrack]
    public let languages: [SubtitlePanelLanguage]
    public let selectedLanguage: String
    /// Set while hash matches wait: the one button that takes them all.
    public let takeAll: SubtitlePanelTakeAll?
    /// "N files already have the language", or empty.
    public let skippedLine: String
    /// Shown when no job exists: every file subtitled, or nothing to search; empty otherwise.
    public let emptyLine: String
    public let queryPlaceholder: String
    /// The search button's word.
    public let searchLabel: String
    public let jobs: [SubtitlePanelJob]

    public init(
        title: String, tracks: [SubtitlePanelTrack] = [], languages: [SubtitlePanelLanguage], selectedLanguage: String, takeAll: SubtitlePanelTakeAll? = nil,
        skippedLine: String = "", emptyLine: String = "", queryPlaceholder: String, searchLabel: String, jobs: [SubtitlePanelJob]
    ) {
        self.title = title
        self.tracks = tracks
        self.languages = languages
        self.selectedLanguage = selectedLanguage
        self.takeAll = takeAll
        self.skippedLine = skippedLine
        self.emptyLine = emptyLine
        self.queryPlaceholder = queryPlaceholder
        self.searchLabel = searchLabel
        self.jobs = jobs
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
}
