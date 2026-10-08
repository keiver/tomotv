//
//  GuideSearch.swift
//  TomoTV
//
//  Text matching over guide programmes: every word of a query in the title, sub-title or
//  description, compared case and accent folded the way the app folds its own search text.
//

import Foundation

enum GuideSearch {
    /// Trimmed, lower case, combining marks (U+0300 to U+036F) dropped after canonical decomposition.
    static func fold(_ text: String) -> String {
        let scalars = text.decomposedStringWithCanonicalMapping.unicodeScalars.filter { !(0x300 ... 0x36F).contains($0.value) }
        return String(String.UnicodeScalarView(scalars)).lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The query's words, folded; empty when nothing is left to match.
    static func terms(_ query: String) -> [String] {
        fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
    }

    /// The folded text a query's words are looked for in: title, sub-title and description.
    static func text(_ programme: GuideProgramme) -> String {
        fold([programme.title, programme.subTitle, programme.desc].compactMap { $0 }.joined(separator: " "))
    }
}
