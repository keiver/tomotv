//
//  PlaylistShim.swift
//  TomoTV
//
//  Loopback playlist proxy for the server lane. AVPlayer buffers position zero
//  of a full-duration VOD playlist before any client seek can land, so a
//  resumed server transcode pays two ffmpeg spin-ups and a dead download of
//  the film's opening over links where every byte counts. HLS solves this in
//  the playlist itself: EXT-X-START (RFC 8216 §4.3.5.2) starts playback at an
//  offset with the full timeline intact, probe-verified honored by tvOS 26.
//  Jellyfin never emits the tag, so this shim serves the transcode's playlists
//  through the loopback server with the tag injected and every URI rewritten
//  to absolute. With `sdrInit` the init segments pass through as well, every
//  avc1 entry retagged BT.709 (InitSegmentSdr.swift). Media segments flow
//  straight from the server; nothing else is proxied, produced, or re-stamped.
//
//  AVPlayer refuses file:// HLS playlists, which is why this is a loopback
//  route and not a pair of temp files.

import Foundation

final class PlaylistShim {
    let token = "shim-" + UUID().uuidString
    private let masterUrl: URL
    private let startOffsetSeconds: Double
    private let sdrInit: Bool
    private let lock = NSLock()
    /// Media playlist URLs discovered in the master, by the pN index the
    /// rewritten master hands AVPlayer.
    private var mediaUrls: [Int: URL] = [:]
    /// Variants the master declares SDR (or leaves undeclared), by pN: the ones whose init is retagged.
    private var sdrVariants: Set<Int> = []
    /// Init segment URLs discovered in the media playlists, by the iN index they hand AVPlayer.
    private var initUrls: [Int: URL] = [:]
    private var nextInit = 0
    /// VOD playlists are immutable; serve every refetch from the first fetch.
    private var masterCache: String?
    private var mediaCache: [Int: String] = [:]
    private var initCache: [Int: Data] = [:]

    init(masterUrl: URL, startOffsetSeconds: Double, sdrInit: Bool = false) {
        self.masterUrl = masterUrl
        self.startOffsetSeconds = startOffsetSeconds
        self.sdrInit = sdrInit
    }

    private func fetchData(_ url: URL) -> Data? {
        let request = URLRequest(url: url, timeoutInterval: 20)
        let semaphore = DispatchSemaphore(value: 0)
        var body: Data? = nil
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                body = data
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 25)
        return body
    }

    private func fetchText(_ url: URL) -> String? {
        fetchData(url).map { String(decoding: $0, as: UTF8.self) }
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
        var sdr: Set<Int> = []
        var next = 0
        func claim(_ raw: String) -> String? {
            guard let absolute = URL(string: raw, relativeTo: masterUrl)?.absoluteURL else { return nil }
            urls[next] = absolute
            defer { next += 1 }
            return "p\(next).m3u8"
        }
        var out: [String] = []
        var streamInf: String?
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw).trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") {
                out.append(Self.rewriteUriAttribute(line, claim: claim))
                if line.hasPrefix("#EXT-X-STREAM-INF") { streamInf = line }
            } else if let local = claim(line) {
                if let inf = streamInf, !Self.declaresHdr(inf) { sdr.insert(next - 1) }
                streamInf = nil
                out.append(local)
            } else {
                out.append(line)
            }
        }
        let rewritten = out.joined(separator: "\n")
        lock.lock()
        mediaUrls = urls
        sdrVariants = sdr
        masterCache = rewritten
        lock.unlock()
        return .data(Data(rewritten.utf8), contentType: Self.m3u8)
    }

    /// Media playlist pN: EXT-X-START injected for a resume, segment URIs absolute, and with
    /// `sdrInit` the EXT-X-MAP URI of an SDR-declared variant pointed at this shim's iN.mp4.
    func mediaResponse(_ n: Int) -> LocalHTTPResponse {
        lock.lock()
        let cached = mediaCache[n]
        let remote = mediaUrls[n]
        let retag = sdrInit && sdrVariants.contains(n)
        lock.unlock()
        if let cached { return .data(Data(cached.utf8), contentType: Self.m3u8) }
        guard let remote, let text = fetchText(remote) else {
            NSLog("[PlaylistShim] media playlist %d fetch failed", n)
            return .notFound
        }
        var inits: [Int: URL] = [:]
        var out: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw).trimmingCharacters(in: .whitespaces)
            if line == "#EXTM3U" {
                out.append(line)
                if startOffsetSeconds > 0 {
                    out.append(String(format: "#EXT-X-START:TIME-OFFSET=%.3f,PRECISE=NO", startOffsetSeconds))
                }
            } else if line.isEmpty || line.hasPrefix("#") {
                out.append(Self.rewriteUriAttribute(line) { raw in
                    guard let absolute = URL(string: raw, relativeTo: remote)?.absoluteURL else { return nil }
                    guard retag, line.hasPrefix("#EXT-X-MAP") else { return absolute.absoluteString }
                    lock.lock()
                    let index = nextInit
                    nextInit += 1
                    lock.unlock()
                    inits[index] = absolute
                    return "i\(index).mp4"
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
        initUrls.merge(inits) { _, new in new }
        lock.unlock()
        return .data(Data(rewritten.utf8), contentType: Self.m3u8)
    }

    /// Whether a STREAM-INF line declares an HDR variant; its content is left as it came.
    static func declaresHdr(_ streamInf: String) -> Bool {
        guard let range = streamInf.range(of: "VIDEO-RANGE=") else { return false }
        let value = streamInf[range.upperBound...].prefix { $0 != "," }
        return value == "PQ" || value == "HLG"
    }

    /// Init segment iN: the server's, with every video entry retagged BT.709.
    func initResponse(_ n: Int) -> LocalHTTPResponse {
        lock.lock()
        let cached = initCache[n]
        let remote = initUrls[n]
        lock.unlock()
        if let cached { return .data(cached, contentType: Self.mp4) }
        guard let remote, let data = fetchData(remote) else {
            NSLog("[PlaylistShim] init segment %d fetch failed", n)
            return .notFound
        }
        let retagged = InitSegmentSdr.normalise(data)
        NSLog("[PlaylistShim] init segment %d: %@", n, retagged == nil ? "served as it came" : "colour retagged BT.709 to match the SDR variant")
        let served = retagged ?? data
        lock.lock()
        initCache[n] = served
        lock.unlock()
        return .data(served, contentType: Self.mp4)
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
    private static let mp4 = "video/mp4"
}
