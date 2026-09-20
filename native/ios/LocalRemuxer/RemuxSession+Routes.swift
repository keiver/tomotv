import Foundation

/// The loopback routes of one session, shared by the app bridge (LocalRemuxer.route) and the drills.
extension RemuxSession {
    /// The time in "frame-{ms}.jpg"; the path carries it because the server strips queries.
    static func frameMilliseconds(_ name: String) -> Int64? {
        guard name.hasPrefix("frame-"), name.hasSuffix(".jpg") else { return nil }
        return Int64(name.dropFirst(6).dropLast(4))
    }

    /// Routes one file name under this session's token.
    func route(_ name: String) -> LocalHTTPResponse {
        let m3u8 = "application/vnd.apple.mpegurl"

        switch name {
        case "master.m3u8":
            return .data(Data(masterPlaylist().utf8), contentType: m3u8)
        case "media.m3u8":
            return .data(Data(mediaPlaylist().utf8), contentType: m3u8)
        case "init.mp4":
            return initResponse()
        default:
            break
        }
        // "init-g{N}.mp4": the init segment of live generation N (one per splice).
        if name.hasPrefix("init-g"), name.hasSuffix(".mp4"),
           let generation = Int(name.dropFirst(6).dropLast(4)) {
            return initResponse(generation: generation)
        }
        if name.hasPrefix("sub"), name.hasSuffix(".m3u8"),
           let index = Int(name.dropFirst(3).dropLast(5)),
           let playlist = subtitlePlaylist(streamIndex: index) {
            return .data(Data(playlist.utf8), contentType: m3u8)
        }
        // "sub{stream}-{segment}.vtt": one window of an engine-decoded text
        // track. Blocks on the read loop, like a media segment does.
        if name.hasPrefix("sub"), name.hasSuffix(".vtt"), name.contains("-") {
            let parts = name.dropFirst(3).dropLast(4).split(separator: "-")
            if parts.count == 2, let index = Int(parts[0]), let segment = Int(parts[1]),
               let body = subtitleSegment(streamIndex: index, segment: segment) {
                return .data(Data(body.utf8), contentType: "text/vtt")
            }
            return .data(Data(emptySubtitleBody().utf8), contentType: "text/vtt")
        }
        // The cue-less body an image subtitle rendition resolves to. AVKit
        // lists and selects the track and draws none of it; the app draws
        // the bitmaps over the video instead.
        if name.hasPrefix("sub"), name.hasSuffix(".vtt") {
            // A track saved with a download serves its own bytes; an image track, and any
            // local file that has since gone, fall back to the cue-less body.
            if let index = Int(name.dropFirst(3).dropLast(4)),
               let body = localSubtitleBody(streamIndex: index) {
                return .data(body, contentType: "text/vtt")
            }
            return .data(Data(emptySubtitleBody().utf8), contentType: "text/vtt")
        }
        // Cue manifest for an image subtitle track, and the cue images
        // themselves. Both are read by the app, never by AVPlayer.
        if name.hasPrefix("pgs"), name.hasSuffix(".json"),
           let index = Int(name.dropFirst(3).dropLast(5)),
           let manifest = subtitleCueManifest(streamIndex: index) {
            return .data(manifest, contentType: "application/json")
        }
        if name.hasPrefix("pgs"), name.hasSuffix(".png"),
           let url = subtitleImageURL(name) {
            return .file(url, contentType: "image/png")
        }
        // A chapter keyframe, made on the first request. Read by AVKit's info panel.
        if let ms = Self.frameMilliseconds(name), let url = chapterFrame(atMilliseconds: ms) {
            return .file(url, contentType: "image/jpeg")
        }
        // Slipstream ladder rungs: "t{k}.m3u8", "t{k}-init.mp4",
        // "t{k}-seg{n}.m4s", where k is the rung index in the master.
        if name.hasPrefix("t") {
            let afterT = name.dropFirst()
            if let rungEnd = afterT.firstIndex(where: { !$0.isNumber }), rungEnd > afterT.startIndex,
               let rung = Int(afterT[afterT.startIndex..<rungEnd]) {
                let rest = String(afterT[rungEnd...])
                if rest == ".m3u8" {
                    guard let playlist = tierPlaylist(rung: rung) else { return .notFound }
                    return .data(Data(playlist.utf8), contentType: m3u8)
                }
                if rest == "-init.mp4" {
                    return tierInitResponse(rung: rung)
                }
                if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"), let n = Int(rest.dropFirst(4).dropLast(4)) {
                    return tierSegmentResponse(rung: rung, n)
                }
            }
        }
        if name.hasPrefix("seg"), name.hasSuffix(".m4s"),
           let n = Int(name.dropFirst(3).dropLast(4)) {
            return segmentResponse(n)
        }

        // Slipstream audio-lo renditions: "aNs.m3u8", "aNs-init.mp4",
        // "aNs-seg{index}.m4s" — must match before the engine "aN" block,
        // whose digits-only guard would 404 the "s" suffix.
        let digits = name.dropFirst().prefix(while: \.isNumber)
        if name.hasPrefix("a"), !digits.isEmpty, let position = Int(digits),
           name.dropFirst(1 + digits.count).first == "s" {
            let rest = String(name.dropFirst(2 + digits.count))
            if rest == ".m3u8" {
                guard let playlist = audioLoPlaylist(position: position) else { return .notFound }
                return .data(Data(playlist.utf8), contentType: m3u8)
            }
            if rest == "-init.mp4" {
                return audioLoInitResponse(position: position)
            }
            if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"),
               let n = Int(rest.dropFirst(4).dropLast(4)) {
                return audioLoSegmentResponse(position: position, n: n)
            }
        }

        // Alternate audio renditions: "aN.m3u8", "aN-init.mp4",
        // "aN-seg{index}.m4s".
        if name.hasPrefix("a"), let split = name.firstIndex(where: { $0 == "-" || $0 == "." }) {
            let prefix = String(name[name.startIndex..<split])
            guard prefix.count > 1, prefix.dropFirst().allSatisfy(\.isNumber) else { return .notFound }
            let rest = String(name[split...])
            if rest == ".m3u8" {
                return .data(Data(mediaPlaylist(prefix: prefix).utf8), contentType: m3u8)
            }
            if rest == "-init.mp4" {
                return initResponse(prefix: prefix)
            }
            if rest.hasPrefix("-init-g"), rest.hasSuffix(".mp4"),
               let generation = Int(rest.dropFirst(7).dropLast(4)) {
                return initResponse(prefix: prefix, generation: generation)
            }
            if rest.hasPrefix("-seg"), rest.hasSuffix(".m4s"),
               let n = Int(rest.dropFirst(4).dropLast(4)) {
                return segmentResponse(n, prefix: prefix)
            }
        }
        return .notFound
    }
}
