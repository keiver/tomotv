//
//  LiveFrameFetch.swift
//  TomoTV
//
//  A live HLS channel's live-edge segment fetched through URLSession, so grabs running side by
//  side never put FFmpeg's TLS on two threads at once (mbedTLS is built without MBEDTLS_THREADING_C).
//

import Foundation

final class LiveFrameFetch {
    enum Result: Equatable {
        /// The live-edge segment, its init section ahead of it when the playlist maps one.
        case media(Data)
        /// A playlist this fetch does not read (encrypted, byte ranges, an untrusted certificate): FFmpeg opens it.
        case unsupported
        case failed
    }

    private let headers: [String: String]
    private let lock = NSLock()
    private var task: URLSessionTask?
    private var cancelled = false
    private var trustRefused = false
    /// Bytes every response carried: the playlists and the media.
    private(set) var bytes: Int64 = 0

    init(headers: [String: String]) {
        self.headers = headers
    }

    /// An http(s) playlist, by the path's extension, the same test the variant resolution makes.
    static func reads(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased() ?? "") && ["m3u8", "m3u"].contains(url.pathExtension.lowercased())
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let running = task
        lock.unlock()
        running?.cancel()
    }

    func fetch(_ url: URL, timeout: TimeInterval) -> Result {
        guard let (first, firstUrl) = get(url, timeout), let firstText = Self.playlist(first) else {
            return trustRefused ? .unsupported : .failed
        }
        var media = firstText
        var mediaUrl = firstUrl
        if let variant = LiveVariantPicker.pick(firstText, base: firstUrl.absoluteString), let variantUrl = URL(string: variant) {
            guard let (body, landed) = get(variantUrl, timeout), let text = Self.playlist(body) else {
                return trustRefused ? .unsupported : .failed
            }
            media = text
            mediaUrl = landed
        }
        guard let plan = Self.plan(media) else { return .unsupported }
        var out = Data()
        if let map = plan.map {
            guard let mapUrl = URL(string: map, relativeTo: mediaUrl)?.absoluteURL, let (initData, _) = get(mapUrl, timeout) else { return .failed }
            out.append(initData)
        }
        guard let segmentUrl = URL(string: plan.segment, relativeTo: mediaUrl)?.absoluteURL, let (segment, _) = get(segmentUrl, timeout) else {
            return .failed
        }
        out.append(segment)
        return .media(out)
    }

    /// The segment FFmpeg's HLS demuxer would open first (live_start_index -3, the first on a VOD
    /// list) and its init section. Nil for what this fetch does not read.
    static func plan(_ media: String) -> (segment: String, map: String?)? {
        var segments: [String] = []
        var map: String?
        var ended = false
        for raw in media.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#EXT-X-KEY:") {
                if LiveVariantPicker.attribute("METHOD", in: String(line.dropFirst("#EXT-X-KEY:".count)))?.uppercased() != "NONE" { return nil }
            } else if line.hasPrefix("#EXT-X-BYTERANGE") {
                return nil
            } else if line.hasPrefix("#EXT-X-MAP:") {
                let attributes = String(line.dropFirst("#EXT-X-MAP:".count))
                if LiveVariantPicker.attribute("BYTERANGE", in: attributes) != nil { return nil }
                map = LiveVariantPicker.attribute("URI", in: attributes)
            } else if line.hasPrefix("#EXT-X-ENDLIST") {
                ended = true
            } else if !line.hasPrefix("#") {
                segments.append(line)
            }
        }
        guard !segments.isEmpty else { return nil }
        return (segments[ended ? 0 : max(0, segments.count - 3)], map)
    }

    private static func playlist(_ data: Data) -> String? {
        guard var text = String(data: data, encoding: .utf8) else { return nil }
        if text.hasPrefix("\u{feff}") { text.removeFirst() }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#EXTM3U") ? text : nil
    }

    private func get(_ url: URL, _ timeout: TimeInterval) -> (Data, URL)? {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let done = DispatchSemaphore(value: 0)
        var result: (Data, URL)?
        var refused = false
        let running = URLSession.shared.dataTask(with: request) { data, response, error in
            if error == nil, let data, let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) {
                result = (data, http.url ?? url)
            }
            if let code = (error as? URLError)?.code {
                refused = [.serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
                           .serverCertificateNotYetValid, .secureConnectionFailed].contains(code)
            }
            done.signal()
        }
        lock.lock()
        if cancelled {
            lock.unlock()
            return nil
        }
        task = running
        lock.unlock()
        running.resume()
        done.wait()
        lock.lock()
        task = nil
        if let result { bytes += Int64(result.0.count) }
        if refused { trustRefused = true }
        lock.unlock()
        return result
    }
}
