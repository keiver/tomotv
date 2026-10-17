//
//  LyricsListener.swift
//  TomoTV
//
//  The system's on-device transcriber run over a song file: every word it hears with the time
//  it was sung. JS fits known lyrics to those times, or keeps the words when there are none.
//

import AVFAudio
import Foundation
import NaturalLanguage
import Speech

enum LyricsListener {

    struct Word {
        let start: Double
        let end: Double
        let text: String
    }

    struct Heard {
        let locale: String
        let words: [Word]
    }

    static var isAvailable: Bool {
        if #available(iOS 26.0, tvOS 26.0, *) { return SpeechTranscriber.isAvailable }
        return false
    }

    /// nil when the transcriber speaks none of the candidate languages. Known lyrics name the
    /// language themselves; without them each candidate is tried and the fullest hearing kept.
    @available(iOS 26.0, tvOS 26.0, *)
    static func transcribe(file: URL, lyrics: String?, languages: [String]) async throws -> Heard? {
        var candidates = languages
        if let lyrics, !lyrics.isEmpty {
            let recognizer = NLLanguageRecognizer()
            recognizer.processString(lyrics)
            candidates = [recognizer.dominantLanguage?.rawValue ?? languages.first ?? "en"]
        }
        var locales: [Locale] = []
        for language in candidates {
            guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: language)),
                  !locales.contains(where: { $0.identifier == locale.identifier }) else { continue }
            locales.append(locale)
        }
        var best: Heard?
        for locale in locales {
            let heard = try await transcribe(file: file, locale: locale)
            if heard.words.count > (best?.words.count ?? -1) { best = heard }
        }
        return best
    }

    @available(iOS 26.0, tvOS 26.0, *)
    private static func transcribe(file: URL, locale: Locale) async throws -> Heard {
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
        // The language's model, fetched by the system the first time it is needed.
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        let audio = try AVAudioFile(forReading: file)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let collector = Task { () -> [Word] in
            var words: [Word] = []
            for try await result in transcriber.results {
                for run in result.text.runs {
                    guard let range = run.audioTimeRange else { continue }
                    let text = String(result.text[run.range].characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { words.append(Word(start: range.start.seconds, end: range.end.seconds, text: text)) }
                }
            }
            return words
        }
        if let last = try await analyzer.analyzeSequence(from: audio) {
            try await analyzer.finalizeAndFinish(through: last)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        return Heard(locale: locale.identifier, words: try await collector.value)
    }
}
