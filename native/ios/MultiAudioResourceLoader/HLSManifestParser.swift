//
//  HLSManifestParser.swift
//  TomoTV
//
//  Created on January 23, 2026.
//  HLS manifest parsing utilities for multi-audio track support
//

import Foundation

/// Represents a subtitle track from HLS manifest
struct SubtitleTrack {
    var name: String
    var language: String
    var uri: String
}

/// Represents a parsed HLS manifest with extracted metadata
struct HLSManifest {
    var version: Int = 3
    var audioUri: String?
    var videoUri: String?
    var bandwidth: Int?
    var resolution: String?
    /// Variant attributes Jellyfin already computed. They were never captured,
    /// so the combined manifest we hand AVPlayer dropped them: Apple requires
    /// CODECS (9.1), FRAME-RATE (9.15) and AVERAGE-BANDWIDTH (9.14) on every
    /// variant, and discarding VIDEO-RANGE is only harmless while the server
    /// says SDR, since a PQ variant that omits it is rejected outright (-12927).
    var videoRange: String?
    var codecs: String?
    var frameRate: String?
    var averageBandwidth: Int?
    var audioGroupId: String?
    var audioLanguage: String?
    var audioName: String?
    var subtitleTracks: [SubtitleTrack] = []
}

/// Parses HLS m3u8 manifests from Jellyfin
class HLSManifestParser {

    /// Parse an HLS manifest string and extract metadata
    /// - Parameter manifestText: The raw m3u8 file content
    /// - Returns: Parsed HLSManifest structure
    /// - Throws: Error if manifest is malformed or missing required fields
    func parse(_ manifestText: String) throws -> HLSManifest {
        var manifest = HLSManifest()
        let lines = manifestText.components(separatedBy: .newlines)

        for (index, line) in lines.enumerated() {
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)

            // Parse version
            if trimmedLine.hasPrefix("#EXT-X-VERSION:") {
                let versionStr = trimmedLine.replacingOccurrences(of: "#EXT-X-VERSION:", with: "")
                manifest.version = Int(versionStr) ?? 3
            }
            // Parse audio media tags
            else if trimmedLine.hasPrefix("#EXT-X-MEDIA:TYPE=AUDIO") {
                manifest.audioGroupId = extractValue(from: trimmedLine, key: "GROUP-ID")
                manifest.audioLanguage = extractValue(from: trimmedLine, key: "LANGUAGE")
                manifest.audioName = extractValue(from: trimmedLine, key: "NAME")
                manifest.audioUri = extractValue(from: trimmedLine, key: "URI")
            }
            // Parse subtitle media tags
            else if trimmedLine.hasPrefix("#EXT-X-MEDIA:TYPE=SUBTITLES") {
                let name = extractValue(from: trimmedLine, key: "NAME")
                let language = extractValue(from: trimmedLine, key: "LANGUAGE")
                let uri = extractValue(from: trimmedLine, key: "URI")

                if !uri.isEmpty {
                    manifest.subtitleTracks.append(SubtitleTrack(
                        name: name,
                        language: language,
                        uri: uri
                    ))
                }
            }
            // Parse stream info
            else if trimmedLine.hasPrefix("#EXT-X-STREAM-INF:") {
                // Extract bandwidth
                if trimmedLine.contains("BANDWIDTH=") {
                    let bandwidth = extractValue(from: trimmedLine, key: "BANDWIDTH")
                    manifest.bandwidth = Int(bandwidth)
                }
                // Extract resolution
                if trimmedLine.contains("RESOLUTION=") {
                    manifest.resolution = extractValue(from: trimmedLine, key: "RESOLUTION")
                }
                // AVERAGE-BANDWIDTH first: searching for "BANDWIDTH=" matches
                // inside it, so the more specific key has to be read separately.
                if trimmedLine.contains("AVERAGE-BANDWIDTH=") {
                    manifest.averageBandwidth = Int(extractValue(from: trimmedLine, key: "AVERAGE-BANDWIDTH"))
                }
                if trimmedLine.contains("VIDEO-RANGE=") {
                    manifest.videoRange = extractValue(from: trimmedLine, key: "VIDEO-RANGE")
                }
                if trimmedLine.contains("CODECS=") {
                    manifest.codecs = extractValue(from: trimmedLine, key: "CODECS")
                }
                if trimmedLine.contains("FRAME-RATE=") {
                    manifest.frameRate = extractValue(from: trimmedLine, key: "FRAME-RATE")
                }
                // Next non-empty line is the video URI
                if index + 1 < lines.count {
                    let nextLine = lines[index + 1].trimmingCharacters(in: .whitespaces)
                    if !nextLine.isEmpty && !nextLine.hasPrefix("#") {
                        manifest.videoUri = nextLine
                    }
                }
            }
            // Direct URI line (if no #EXT-X-STREAM-INF before it)
            else if !trimmedLine.isEmpty && !trimmedLine.hasPrefix("#") && manifest.videoUri == nil {
                manifest.videoUri = trimmedLine
            }
        }

        return manifest
    }

    /// Extract value for a key from HLS tag line
    /// - Parameters:
    ///   - line: The HLS tag line (e.g., "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1280x720")
    ///   - key: The key to extract (e.g., "BANDWIDTH")
    /// - Returns: The value as a string, or empty string if not found
    private func extractValue(from line: String, key: String) -> String {
        // Handle quoted values (e.g., NAME="English")
        if let quotedRange = line.range(of: "\(key)=\"") {
            let startIndex = quotedRange.upperBound
            let substring = line[startIndex...]

            if let endQuoteIndex = substring.firstIndex(of: "\"") {
                return String(substring[..<endQuoteIndex])
            }
        }

        // Handle unquoted values (e.g., BANDWIDTH=5000000)
        if let range = line.range(of: "\(key)=") {
            let startIndex = range.upperBound
            let substring = line[startIndex...]

            if let commaIndex = substring.firstIndex(of: ",") {
                return String(substring[..<commaIndex])
            } else {
                return String(substring).trimmingCharacters(in: .whitespaces)
            }
        }

        return ""
    }
}
