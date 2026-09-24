//
//  HLSManifestGenerator.swift
//  TomoTV
//
//  Created on January 23, 2026.
//  Generates multivariant HLS manifests with multiple audio tracks
//

import Foundation

/// Generates combined HLS manifests from multiple Jellyfin manifests
class HLSManifestGenerator {

    /// Defensive hygiene for HLS quoted-string attributes.
    /// Strips quotes and newlines that would break manifest parsing.
    private static func sanitizeHLSAttribute(_ value: String) -> String {
        return value
            .replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
    }

    /// Combine multiple Jellyfin manifests into a single multivariant manifest
    /// - Parameters:
    ///   - manifests: Array of HLS manifest strings (one per audio track)
    ///   - audioTrackInfo: Audio track metadata from Jellyfin
    ///   - fetchUrls: Array of URLs used to fetch each manifest (includes unique audioStreamIndex and playSessionId)
    /// - Returns: Combined HLS manifest string
    /// - Throws: Error if manifests are empty or malformed
    /// `manifests` and `fetchUrls` carry one slot per `audioTrackInfo` entry, so an index names the
    /// same track in all three. A nil slot fails the whole item: every track is served or none is.
    func combine(
        manifests: [String?],
        audioTrackInfo: [[String: Any]],
        fetchUrls: [String?]
    ) throws -> String {

        guard manifests.contains(where: { $0 != nil }) else {
            throw NSError(
                domain: "HLSGenerator",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No manifests provided"]
            )
        }

        guard !audioTrackInfo.isEmpty else {
            throw NSError(
                domain: "HLSGenerator",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "No audio track info provided"]
            )
        }

        guard manifests.count == audioTrackInfo.count, fetchUrls.count == audioTrackInfo.count,
              manifests.allSatisfy({ $0 != nil }), fetchUrls.allSatisfy({ $0 != nil }),
              audioTrackInfo.allSatisfy({ ($0["Index"] as? Int).map { $0 >= 0 } == true }) else {
            throw NSError(domain: "HLSGenerator", code: 4, userInfo: [NSLocalizedDescriptionKey: "An audio track has no usable manifest"])
        }
        let parser = HLSManifestParser()
        let parsedManifests: [HLSManifest?] = try manifests.map { text in
            guard let text else {
                throw NSError(domain: "HLSGenerator", code: 4, userInfo: [NSLocalizedDescriptionKey: "An audio track has no usable manifest"])
            }
            return try parser.parse(text)
        }

        // Every slot parsed, or the map above threw. Subtitles are identical across the audio
        // variants, so the first track supplies them.
        let firstFetched = 0
        let subtitles = parsedManifests[firstFetched]?.subtitleTracks ?? []

        // Build combined manifest
        var combined = "#EXTM3U\n"
        combined += "#EXT-X-VERSION:3\n\n"

        // Add subtitle renditions (shared across all stream variants)
        // Use the same track's fetch URL as the base for resolving their URIs.
        let subtitleBaseUrl = fetchUrls[firstFetched] ?? ""
        for subtitle in subtitles {
            let absoluteUri = makeAbsoluteUrl(baseUrl: subtitleBaseUrl, relativeUrl: subtitle.uri)
            let safeName = Self.sanitizeHLSAttribute(subtitle.name)
            // Jellyfin writes LANGUAGE="Unknown" for a track with no language
            // tag, which is not one of the RFC 5646 tags RFC 8216 requires here.
            // "und" is, and is what the engine's own playlist emits.
            let rawLang = Self.sanitizeHLSAttribute(subtitle.language)
            let safeLang = rawLang.isEmpty || rawLang.caseInsensitiveCompare("Unknown") == .orderedSame ? "und" : rawLang
            // AUTOSELECT=YES is on every rendition Jellyfin publishes, and
            // rebuilding the line without it silently made these tracks
            // un-auto-selectable. Absent, it defaults to NO.
            combined += "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"\(safeName)\",LANGUAGE=\"\(safeLang)\",AUTOSELECT=YES,URI=\"\(absoluteUri)\"\n"
        }

        if !subtitles.isEmpty {
            combined += "\n"
        }

        // Add audio tracks as separate media groups
        for (index, trackInfo) in audioTrackInfo.enumerated() {
            let language = trackInfo["Language"] as? String ?? "und"
            let displayTitle = trackInfo["DisplayTitle"] as? String ?? "Audio \(index + 1)"
            let isDefault = trackInfo["IsDefault"] as? Bool ?? false
            let name = displayTitle

            // Get actual Jellyfin stream index from track metadata
            guard let streamIndex = trackInfo["Index"] as? Int else {
                throw NSError(domain: "HLSGenerator", code: 4, userInfo: [NSLocalizedDescriptionKey: "Audio track is missing its stream index"])
            }

            guard let trackFetchUrl = fetchUrls[index] else {
                throw NSError(domain: "HLSGenerator", code: 4, userInfo: [NSLocalizedDescriptionKey: "Audio track \(streamIndex) is missing its manifest"])
            }
            let parsed = parsedManifests[index]

            // Log each track's IsDefault value for debugging
            NSLog("[HLSGenerator] Track \(index + 1): Index=\(streamIndex), IsDefault=\(isDefault), Language=\"\(language)\"")

            // Build audio URL using the fetch URL for this specific track
            // This preserves the unique audioStreamIndex and playSessionId parameters
            let audioUrl: String
            if let audioUri = parsed?.audioUri {
                audioUrl = makeAbsoluteUrl(baseUrl: trackFetchUrl, relativeUrl: audioUri)
                #if DEBUG
                NSLog("[HLSGenerator] 🎵 Track \(index + 1) audio URL: \(audioUrl)")
                #endif
            } else if let videoUri = parsed?.videoUri {
                audioUrl = makeAbsoluteUrl(baseUrl: trackFetchUrl, relativeUrl: videoUri)
                #if DEBUG
                NSLog("[HLSGenerator] 🎵 Track \(index + 1) audio URL (from video): \(audioUrl)")
                #endif
            } else {
                // Fallback: use fetch URL directly (already has audioStreamIndex and playSessionId)
                audioUrl = trackFetchUrl
                #if DEBUG
                NSLog("[HLSGenerator] 🎵 Track \(index + 1) audio URL (fallback): \(audioUrl)")
                #endif
            }

            // Build audio media tag - conditionally include LANGUAGE
            // CRITICAL: iOS ALWAYS prioritizes LANGUAGE for display. For "und" tracks, OMIT LANGUAGE entirely
            // to force iOS to display the NAME attribute (RFC 8216: LANGUAGE is OPTIONAL)
            let safeName = Self.sanitizeHLSAttribute(name)
            let safeLang = Self.sanitizeHLSAttribute(language)
            if language != "und" && !language.isEmpty {
                combined += "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"\(safeName)\",LANGUAGE=\"\(safeLang)\""
            } else {
                // OMIT LANGUAGE entirely for undefined languages - forces iOS to display NAME
                combined += "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"\(safeName)\""
            }

            // Strategy: Mark ALL tracks as DEFAULT=NO,AUTOSELECT=NO
            // This allows iOS to display NAME attribute for "und" tracks (when LANGUAGE is omitted)
            // Track names display correctly in native picker
            combined += ",DEFAULT=NO,AUTOSELECT=NO"
            combined += ",URI=\"\(audioUrl)\"\n"

            NSLog("[HLSGenerator] 🎵 Track \(index + 1): NAME=\"\(name)\", LANGUAGE=\"\(language.isEmpty || language == "und" ? "OMITTED" : language)\", IsDefault=\(isDefault)")
        }

        combined += "\n"

        // Add video stream using the DEFAULT audio track's transcode session
        // This ensures video segments have the correct default audio baked in.
        // TypeScript sorts audioTrackInfo so IsDefault=true is ALWAYS at index 0,
        // so that is the track to take the video from — unless its own fetch
        // failed, in which case the first track that did return one stands in.
        // Falling through to a nil slot would leave the master with no
        // EXT-X-STREAM-INF at all, which is not a playable playlist.
        let defaultTrackIndex = firstFetched
        NSLog("[HLSGenerator] 📹 Using video stream from track at index \(defaultTrackIndex)")

        // Log the selected default track's URL
        #if DEBUG
        if let selectedUrl = fetchUrls[defaultTrackIndex] {
            NSLog("[HLSGenerator] Selected video stream URL: \(selectedUrl)")
        }
        #endif

        if let defaultManifest = parsedManifests[defaultTrackIndex] {
            combined += "#EXT-X-STREAM-INF:"
            combined += "BANDWIDTH=\(defaultManifest.bandwidth ?? 5000000)"

            // Everything Jellyfin already worked out for this variant, put back.
            // It computes all of these correctly and we were dropping them on
            // the floor while rebuilding the line.
            combined += ",AVERAGE-BANDWIDTH=\(defaultManifest.averageBandwidth ?? defaultManifest.bandwidth ?? 5000000)"

            if let videoRange = defaultManifest.videoRange {
                combined += ",VIDEO-RANGE=\(videoRange)"
            }

            if let codecs = defaultManifest.codecs {
                combined += ",CODECS=\"\(codecs)\""
            }

            if let resolution = defaultManifest.resolution {
                combined += ",RESOLUTION=\(resolution)"
            }

            if let frameRate = defaultManifest.frameRate {
                combined += ",FRAME-RATE=\(frameRate)"
            }

            combined += ",AUDIO=\"audio\""

            // Reference subtitle group if we have subtitles
            if !subtitles.isEmpty {
                combined += ",SUBTITLES=\"subs\""
            }

            // Say plainly that there are none, exactly as the engine's own
            // playlist does (Remuxer.masterPlaylist). With the attribute absent
            // the player cannot rule out captions carried inside the video, and
            // answers by offering a legible option with an empty title that
            // AVKit lists as "CC" and that draws nothing when selected.
            //
            // Safer to claim here than on the engine path: this lane is the
            // server transcode, so Jellyfin has re-encoded the video and
            // anything embedded in the source is gone by construction. This
            // line is rebuilt from parsed fields anyway, so whatever Jellyfin
            // declared was already being dropped.
            //
            // NONE is only legal if EVERY EXT-X-STREAM-INF says NONE. There is
            // one, written here.
            combined += ",CLOSED-CAPTIONS=NONE"

            combined += "\n"

            // Use video URI from default track's manifest and fetch URL
            let defaultFetchUrl = fetchUrls[defaultTrackIndex] ?? ""
            if let videoUri = defaultManifest.videoUri {
                combined += "\(makeAbsoluteUrl(baseUrl: defaultFetchUrl, relativeUrl: videoUri))\n"
            } else {
                // Fallback to default track's fetch URL
                #if DEBUG
                NSLog("[HLSGenerator] 📹 Video stream URL (no videoUri): \(defaultFetchUrl)")
                #endif
                combined += "\(defaultFetchUrl)\n"
            }
        }

        return combined
    }

    /// Convert relative URL to absolute URL by replacing the last path component
    /// - Parameters:
    ///   - baseUrl: Base URL (e.g., "http://server:8096/Videos/123/master.m3u8?ApiKey=...")
    ///   - relativeUrl: Relative URL (e.g., "main.m3u8?ApiKey=...")
    /// - Returns: Absolute URL
    private func makeAbsoluteUrl(baseUrl: String, relativeUrl: String) -> String {
        guard let base = URL(string: baseUrl),
              let resolved = URL(string: relativeUrl, relativeTo: base)?.absoluteURL,
              var components = URLComponents(url: resolved, resolvingAgainstBaseURL: true) else { return baseUrl }
        guard resolved.scheme == base.scheme, resolved.host == base.host, resolved.port == base.port else { return resolved.absoluteString }
        let baseItems = URLComponents(url: base, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let identityKeys: Set<String> = ["audiostreamindex", "playsessionid", "mediasourceid"]
        let protectedKeys = Set(baseItems.map { $0.name.lowercased() }).intersection(identityKeys)
        var merged: [URLQueryItem] = []
        for item in baseItems {
            merged.removeAll { $0.name.lowercased() == item.name.lowercased() }
            merged.append(item)
        }
        for item in components.queryItems ?? [] where !protectedKeys.contains(item.name.lowercased()) {
            merged.removeAll { $0.name.lowercased() == item.name.lowercased() }
            merged.append(item)
        }
        components.queryItems = merged.isEmpty ? nil : merged
        return components.url?.absoluteString ?? resolved.absoluteString
    }

}
