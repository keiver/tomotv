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
    /// Downloads, rating and byline in words, joined: what VoiceOver reads for the row.
    public let meta: String
    public let downloads: Int?
    public let rating: Double?
    /// The author and any source other than OpenSubtitles, joined.
    public let byline: String
    public let badges: [String]
    public let monogram: String
    public let hashMatch: Bool
    public let applying: Bool
    public let applied: Bool
    /// The timing controls under the row of the kept pick that is playing, nil on every other row.
    public let timing: SubtitlePanelTrack?

    public init(
        id: String, name: String, meta: String, downloads: Int? = nil, rating: Double? = nil, byline: String = "", badges: [String], monogram: String, hashMatch: Bool, applying: Bool,
        applied: Bool, timing: SubtitlePanelTrack? = nil
    ) {
        self.id = id
        self.name = name
        self.meta = meta
        self.downloads = downloads
        self.rating = rating
        self.byline = byline
        self.badges = badges
        self.monogram = monogram
        self.hashMatch = hashMatch
        self.applying = applying
        self.applied = applied
        self.timing = timing
    }
}

/// The timing controls of a kept pick, with the words they show.
public struct SubtitlePanelTrack: Codable, Equatable {
    /// The stream index the shift and sync events name.
    public let id: Int
    public let offsetLabel: String
    public let earlierLabel: String
    public let laterLabel: String
    /// The words on the step buttons themselves ("−0.5 s", "+0.5 s"); the labels above are what a screen reader says.
    public let earlierTitle: String
    public let laterTitle: String
    public let resetLabel: String
    public let syncLabel: String
    /// A match can only run while the video plays; the sync button hides without it.
    public let canSync: Bool
    /// A match against the audio is running: the sync button spins and takes no press.
    public let syncing: Bool
    /// The line under the row: how the last match went, empty when none ran.
    public let note: String

    public init(
        id: Int, offsetLabel: String, earlierLabel: String, laterLabel: String, earlierTitle: String, laterTitle: String,
        resetLabel: String, syncLabel: String, canSync: Bool, syncing: Bool, note: String
    ) {
        self.id = id
        self.offsetLabel = offsetLabel
        self.earlierLabel = earlierLabel
        self.laterLabel = laterLabel
        self.earlierTitle = earlierTitle
        self.laterTitle = laterTitle
        self.resetLabel = resetLabel
        self.syncLabel = syncLabel
        self.canSync = canSync
        self.syncing = syncing
        self.note = note
    }
}

/// The alert a result press raises before it downloads.
public struct SubtitlePanelConfirm: Codable, Equatable {
    public let title: String
    /// The downloads left today, empty until the provider has said.
    public let remaining: String
    public let download: String
    public let cancel: String

    public init(title: String, remaining: String, download: String, cancel: String) {
        self.title = title
        self.remaining = remaining
        self.download = download
        self.cancel = cancel
    }
}

/// The video's search: its query, state and results.
public struct SubtitlePanelJob: Codable, Equatable {
    /// The item id the query and pick events name.
    public let id: String
    public let query: String
    /// Searching, N results, nothing found, saved: the line under the field.
    public let stateLine: String
    /// A source that refused this session, or why a save stayed on the device; empty otherwise.
    public let note: String
    public let busy: Bool
    public let results: [SubtitlePanelResult]

    public init(id: String, query: String, stateLine: String, note: String, busy: Bool, results: [SubtitlePanelResult]) {
        self.id = id
        self.query = query
        self.stateLine = stateLine
        self.note = note
        self.busy = busy
        self.results = results
    }
}

public struct SubtitlePanelState: Codable, Equatable {
    public let title: String
    /// The provider credit beside the title.
    public let credit: String
    /// The viewer's theme colour, "#RRGGBB".
    public let accent: String
    /// Nil sends a press straight to the download.
    public let confirm: SubtitlePanelConfirm?
    public let languages: [SubtitlePanelLanguage]
    public let selectedLanguage: String
    public let queryPlaceholder: String
    /// The search button's word.
    public let searchLabel: String
    /// The close button's word, off the TV.
    public let closeLabel: String
    /// False while the video plays under the panel in the player: the screen behind stays sharp.
    public let blurBehind: Bool
    public let job: SubtitlePanelJob

    public init(
        title: String, credit: String = "", accent: String = "", confirm: SubtitlePanelConfirm? = nil, languages: [SubtitlePanelLanguage], selectedLanguage: String,
        queryPlaceholder: String, searchLabel: String, closeLabel: String = "", blurBehind: Bool = true, job: SubtitlePanelJob
    ) {
        self.blurBehind = blurBehind
        self.title = title
        self.credit = credit
        self.accent = accent
        self.confirm = confirm
        self.languages = languages
        self.selectedLanguage = selectedLanguage
        self.queryPlaceholder = queryPlaceholder
        self.searchLabel = searchLabel
        self.closeLabel = closeLabel
        self.job = job
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

    /// The theme colour as red, green and blue from 0 to 1, or nil when `accent` is not "#RRGGBB".
    public var accentComponents: (red: Double, green: Double, blue: Double)? {
        let hex = accent.hasPrefix("#") ? String(accent.dropFirst()) : accent
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
        return (Double((value >> 16) & 0xFF) / 255, Double((value >> 8) & 0xFF) / 255, Double(value & 0xFF) / 255)
    }
}
