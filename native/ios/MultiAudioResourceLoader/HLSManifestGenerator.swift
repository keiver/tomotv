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
    func combine(
        manifests: [String],
        audioTrackInfo: [[String: Any]],
        fetchUrls: [String]
    ) throws -> String {

        guard !manifests.isEmpty else {
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

        // Parse all manifests
        let parser = HLSManifestParser()
        let parsedManifests = try manifests.map { try parser.parse($0) }

        // Extract subtitles from first manifest (they're the same across all audio variants)
        let subtitles = parsedManifests.first?.subtitleTracks ?? []

        // Build combined manifest
        var combined = "#EXTM3U\n"
        combined += "#EXT-X-VERSION:3\n\n"

        // Add subtitle renditions (shared across all stream variants)
        // Use first fetch URL as base for subtitles (they're the same across all audio variants)
        let subtitleBaseUrl = fetchUrls.first ?? ""
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
            let codec = trackInfo["Codec"] as? String
            let channels = trackInfo["Channels"] as? Int
            let isDefault = trackInfo["IsDefault"] as? Bool ?? false

            // Use Jellyfin's DisplayTitle (already includes codec, channels, and "Default" suffix)
            // Only use custom format as fallback if DisplayTitle is missing or "Unknown"
            var name = displayTitle
            if displayTitle.hasPrefix("Audio ") || displayTitle == "Audio \(index + 1)" ||
               displayTitle.hasPrefix("Unknown") {
                // Fallback: DisplayTitle is missing/invalid, generate from metadata
                if let codec = codec, let channels = channels {
                    let channelStr = formatChannels(channels)
                    if isDefault {
                        // Default track: "AAC - Stereo - Default"
                        name = "\(codec.uppercased()) - \(channelStr) - Default"
                    } else if language != "und" && !language.isEmpty {
                        // Non-default with known language: "ENGLISH - AAC - Stereo"
                        name = "\(language.uppercased()) - \(codec.uppercased()) - \(channelStr)"
                    } else {
                        // Non-default without language: "AAC - Stereo"
                        name = "\(codec.uppercased()) - \(channelStr)"
                    }
                } else if let codec = codec {
                    // Only codec available
                    if isDefault {
                        name = "\(codec.uppercased()) - Default"
                    } else if language != "und" && !language.isEmpty {
                        name = "\(language.uppercased()) - \(codec.uppercased())"
                    } else {
                        name = codec.uppercased()
                    }
                }
            }

            // Get actual Jellyfin stream index from track metadata
            guard let streamIndex = trackInfo["Index"] as? Int else {
                NSLog("[HLSGenerator] ⚠️ Missing Index for track \(index + 1), skipping")
                continue
            }

            // Log each track's IsDefault value for debugging
            NSLog("[HLSGenerator] Track \(index + 1): Index=\(streamIndex), IsDefault=\(isDefault), Language=\"\(language)\"")

            // Build audio URL using the fetch URL for this specific track
            // This preserves the unique audioStreamIndex and playSessionId parameters
            let trackFetchUrl = fetchUrls[safe: index] ?? ""
            let audioUrl: String
            if let audioUri = parsedManifests[safe: index]?.audioUri {
                audioUrl = makeAbsoluteUrl(baseUrl: trackFetchUrl, relativeUrl: audioUri)
                #if DEBUG
                NSLog("[HLSGenerator] 🎵 Track \(index + 1) audio URL: \(audioUrl)")
                #endif
            } else if let videoUri = parsedManifests[safe: index]?.videoUri {
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
        // This ensures video segments have the correct default audio baked in
        // TypeScript sorts audioTrackInfo so IsDefault=true track is ALWAYS at index 0
        let defaultTrackIndex = 0
        NSLog("[HLSGenerator] 📹 Using video stream from track at index 0 (language-preferred default)")

        // Log the selected default track's URL
        #if DEBUG
        if let selectedUrl = fetchUrls[safe: defaultTrackIndex] {
            NSLog("[HLSGenerator] Selected video stream URL: \(selectedUrl)")
        }
        #endif

        if let defaultManifest = parsedManifests[safe: defaultTrackIndex] {
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
            let defaultFetchUrl = fetchUrls[safe: defaultTrackIndex] ?? fetchUrls.first ?? ""
            if let videoUri = defaultManifest.videoUri {
                // Extract ONLY the path from videoUri (e.g., "main.m3u8")
                // Don't merge query params - preserve fetchUrl's audioStreamIndex
                let videoPath = videoUri.components(separatedBy: "?").first ?? videoUri

                if var components = URLComponents(string: defaultFetchUrl) {
                    // Replace last path component with video path
                    var pathParts = components.path.components(separatedBy: "/")
                    if !pathParts.isEmpty {
                        pathParts[pathParts.count - 1] = videoPath
                        components.path = pathParts.joined(separator: "/")
                    }
                    let videoUrl = components.url?.absoluteString ?? defaultFetchUrl
                    #if DEBUG
                    NSLog("[HLSGenerator] 📹 Video stream URL: \(videoUrl)")
                    #endif
                    combined += "\(videoUrl)\n"
                } else {
                    #if DEBUG
                    NSLog("[HLSGenerator] 📹 Video stream URL (fallback): \(defaultFetchUrl)")
                    #endif
                    combined += "\(defaultFetchUrl)\n"
                }
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
        // If already absolute (starts with http/https), return as-is
        if relativeUrl.lowercased().hasPrefix("http://") || relativeUrl.lowercased().hasPrefix("https://") {
            return relativeUrl
        }

        // Parse the base URL to extract components
        guard let baseURL = URL(string: baseUrl) else {
            // Fallback: simple concatenation
            return baseUrl.hasSuffix("/") ? baseUrl + relativeUrl : baseUrl + "/" + relativeUrl
        }

        // Remove query string and fragment from base URL to get just the path
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return baseUrl.hasSuffix("/") ? baseUrl + relativeUrl : baseUrl + "/" + relativeUrl
        }

        // Remove the last path component (e.g., "master.m3u8") and append the relative URL
        var pathComponents = components.path.split(separator: "/").map(String.init)
        if !pathComponents.isEmpty {
            pathComponents.removeLast() // Remove "master.m3u8"
        }

        // Append the relative URL's path component
        let relativePath = relativeUrl.split(separator: "?").first.map(String.init) ?? relativeUrl
        pathComponents.append(relativePath)

        // Reconstruct the path
        components.path = "/" + pathComponents.joined(separator: "/")

        // Merge query parameters from both base URL and relative URL
        var mergedQueryItems = components.queryItems ?? []

        // Add query parameters from relative URL if present
        if let queryStart = relativeUrl.firstIndex(of: "?") {
            let relativeQuery = String(relativeUrl[relativeUrl.index(after: queryStart)...])
            if let relativeComponents = URLComponents(string: "http://dummy?" + relativeQuery) {
                let relativeItems = relativeComponents.queryItems ?? []
                // Append relative params (they override base params with same name)
                for item in relativeItems {
                    mergedQueryItems.removeAll { $0.name == item.name }
                    mergedQueryItems.append(item)
                }
            }
        }

        components.queryItems = mergedQueryItems.isEmpty ? nil : mergedQueryItems

        return components.url?.absoluteString ?? baseUrl
    }

    /// Append query parameter to URL
    /// - Parameters:
    ///   - url: Base URL (may or may not have existing query parameters)
    ///   - key: Query parameter key
    ///   - value: Query parameter value
    /// - Returns: URL with appended query parameter
    private func appendQueryParameter(url: String, key: String, value: String) -> String {
        guard var components = URLComponents(string: url) else {
            // Fallback: simple concatenation
            return url.contains("?") ? "\(url)&\(key)=\(value)" : "\(url)?\(key)=\(value)"
        }

        // Add query parameter
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: key, value: value))
        components.queryItems = queryItems

        return components.url?.absoluteString ?? url
    }

    /// Format channel count to human-readable string
    /// - Parameter channels: Number of audio channels
    /// - Returns: Formatted string (e.g., "Stereo", "5.1", "7.1")
    private func formatChannels(_ channels: Int) -> String {
        switch channels {
        case 1:
            return "Mono"
        case 2:
            return "Stereo"
        case 6:
            return "5.1"
        case 8:
            return "7.1"
        default:
            return "\(channels)ch"
        }
    }
}

// Safe array access extension
extension Array {
    subscript(safe index: Index) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }
}
