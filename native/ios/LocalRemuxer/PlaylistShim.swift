//
//  PlaylistShim.swift
//  TomoTV
//
//  Loopback playlist proxy for server-lane resume. AVPlayer buffers position
//  zero of a full-duration VOD playlist before any client seek can land, so a
//  resumed server transcode pays two ffmpeg spin-ups and a dead download of
//  the film's opening over links where every byte counts. HLS solves this in
//  the playlist itself: EXT-X-START (RFC 8216 §4.3.5.2) starts playback at an
//  offset with the full timeline intact — probe-verified honored by tvOS 26.
//  Jellyfin never emits the tag, so this shim serves the transcode's playlists
//  through the loopback server with the tag injected and every URI rewritten
//  to absolute. Segments flow straight from the server; nothing else is
//  proxied, produced, or re-stamped.
//
//  AVPlayer refuses file:// HLS playlists, which is why this is a loopback
//  route and not a pair of temp files.

import Foundation

final class PlaylistShim {
    let token = "shim-" + UUID().uuidString
    private let masterUrl: URL
    private let startOffsetSeconds: Double
    private let lock = NSLock()
    /// Media playlist URLs discovered in the master, by the pN index the
    /// rewritten master hands AVPlayer.
    private var mediaUrls: [Int: URL] = [:]
    /// VOD playlists are immutable; serve every refetch from the first fetch.
    private var masterCache: String?
    private var mediaCache: [Int: String] = [:]

    init(masterUrl: URL, startOffsetSeconds: Double) {
        self.masterUrl = masterUrl
        self.startOffsetSeconds = startOffsetSeconds
    }

    private func fetchText(_ url: URL) -> String? {
        let request = URLRequest(url: url, timeoutInterval: 20)
        let semaphore = DispatchSemaphore(value: 0)
        var body: String? = nil
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                body = String(decoding: data, as: UTF8.self)
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 25)
        return body
    }

    /// The master with every child playlist URI (variant lines and
    /// EXT-X-MEDIA URI attributes) pointed back at this shim.
    func masterResponse() -> LocalHTTPResponse {
        lock.lock()
        let cached = masterCache
        lock.unlock()
        if let cached { return .data(Data(cached.utf8), contentType: Self.m3u8) }
        guard let text = fetchText(masterUrl) else {
            NSLog("[PlaylistShim] master fetch failed")
            return .notFound
        }
        var urls: [Int: URL] = [:]
        var next = 0
        func claim(_ raw: String) -> String? {
            guard let absolute = URL(string: raw, relativeTo: masterUrl)?.absoluteURL else { return nil }
            urls[next] = absolute
            defer { next += 1 }
            return "p\(next).m3u8"
        }
        var out: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw).trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") {
                out.append(Self.rewriteUriAttribute(line, claim: claim))
            } else if let local = claim(line) {
                out.append(local)
            } else {
                out.append(line)
            }
        }
        let rewritten = out.joined(separator: "\n")
        lock.lock()
        mediaUrls = urls
        masterCache = rewritten
        lock.unlock()
        return .data(Data(rewritten.utf8), contentType: Self.m3u8)
    }

    /// Media playlist pN: EXT-X-START injected, segment and map URIs absolute.
    func mediaResponse(_ n: Int) -> LocalHTTPResponse {
        lock.lock()
        let cached = mediaCache[n]
        let remote = mediaUrls[n]
        lock.unlock()
        if let cached { return .data(Data(cached.utf8), contentType: Self.m3u8) }
        guard let remote, let text = fetchText(remote) else {
            NSLog("[PlaylistShim] media playlist %d fetch failed", n)
            return .notFound
        }
        var out: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw).trimmingCharacters(in: .whitespaces)
            if line == "#EXTM3U" {
                out.append(line)
                out.append(String(format: "#EXT-X-START:TIME-OFFSET=%.3f,PRECISE=NO", startOffsetSeconds))
            } else if line.isEmpty || line.hasPrefix("#") {
                out.append(Self.rewriteUriAttribute(line) { raw in
                    URL(string: raw, relativeTo: remote)?.absoluteURL.absoluteString
                })
            } else if let absolute = URL(string: line, relativeTo: remote)?.absoluteURL {
                out.append(absolute.absoluteString)
            } else {
                out.append(line)
            }
        }
        let rewritten = out.joined(separator: "\n")
        lock.lock()
        mediaCache[n] = rewritten
        lock.unlock()
        return .data(Data(rewritten.utf8), contentType: Self.m3u8)
    }

    /// Rewrites the URI="..." attribute of a tag line (EXT-X-MEDIA in the
    /// master, EXT-X-MAP in a media playlist) through `claim`; any other line
    /// passes through untouched.
    private static func rewriteUriAttribute(_ line: String, claim: (String) -> String?) -> String {
        guard let range = line.range(of: "URI=\"") else { return line }
        let rest = line[range.upperBound...]
        guard let end = rest.firstIndex(of: "\""), let local = claim(String(rest[..<end])) else { return line }
        return line[..<range.upperBound] + local + line[end...]
    }

    private static let m3u8 = "application/vnd.apple.mpegurl"
}
