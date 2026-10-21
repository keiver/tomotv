import Foundation

extension RemuxSession {
    /// The loopback URL of a live HLS input cut to the variant and audio rendition that play, or nil
    /// to open the input as given: a media playlist, a raw stream, no loopback, an unreadable master.
    func trimmedLiveSource(_ urlString: String, headers: [String: String]) -> String? {
        // A request to a raw stream is one more connection the provider counts beside the open.
        guard config.isLive, let base = loopbackBase, let url = URL(string: urlString), url.scheme == "http" || url.scheme == "https",
              ["m3u8", "m3u"].contains(url.pathExtension.lowercased()) else { return nil }
        guard case .status(let code, let finalURL, let body) = EndpointProbe.request(url, headers: headers, keepBody: true, timeout: 5),
              (200..<300).contains(code), let text = body.flatMap({ String(data: $0, encoding: .utf8) }), text.contains("#EXT-X-STREAM-INF"),
              let trimmed = LiveVariantPicker.trimmedMaster(text, base: (finalURL ?? url).absoluteString,
                                                            audioLanguage: config.liveAudioLanguage, maxBandwidth: config.liveMaxBandwidth) else { return nil }
        stateLock.lock()
        sourcePlaylist = trimmed
        stateLock.unlock()
        let lines = trimmed.split(separator: "\n").map(String.init)
        let bandwidth = lines.first { $0.hasPrefix("#EXT-X-STREAM-INF:") }.flatMap { LiveVariantPicker.attribute("BANDWIDTH", in: String($0.dropFirst("#EXT-X-STREAM-INF:".count))) } ?? "?"
        let audio = lines.first { $0.hasPrefix("#EXT-X-MEDIA:") }.flatMap { LiveVariantPicker.attribute("LANGUAGE", in: String($0.dropFirst("#EXT-X-MEDIA:".count))) } ?? "muxed"
        NSLog("[LocalRemuxer] live source trimmed to one variant (%@ bps) and its audio (%@)", bandwidth, audio)
        return "\(base)/source.m3u8"
    }

    func sourcePlaylistResponse() -> LocalHTTPResponse {
        stateLock.lock()
        let text = sourcePlaylist
        stateLock.unlock()
        guard let text else { return .notFound }
        return .data(Data(text.utf8), contentType: "application/vnd.apple.mpegurl")
    }
}
