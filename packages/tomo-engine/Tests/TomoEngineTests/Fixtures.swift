import Foundation

@testable import TomoEngine

/// A minimal SDR video session. Every field is required by RemuxConfig; the ones
/// that matter to a given test are passed, the rest are inert defaults.
func makeConfig(
    durationSeconds: Double,
    inputUrl: String = "file:///dev/null",
    audioTracks: [RemuxAudioTrack] = [],
    subtitles: [RemuxSubtitle] = [],
    videoRange: String = "SDR",
    codecs: String = "avc1.640028,mp4a.40.2",
    supplementalCodecs: String = "",
    width: Int = 1920,
    height: Int = 1080,
    frameRate: Double = 23.976,
    bandwidth: Int = 8_000_000,
    readAheadSegments: Int = 0,
    tierPlaylistUrl: String? = nil,
    tierBandwidth: Int = 0,
    tierCodecs: String = "",
    tierWidth: Int = 0,
    tierHeight: Int = 0,
    tiers: [TierConfig]? = nil,
    startOffsetSeconds: Double = 0,
    isLive: Bool = false,
    liveSegmentSeconds: Double = 6.0,
    liveWindowSeconds: Double = 300.0,
    stopRequests: [StopRequest] = []
) -> RemuxConfig {
    // A `tiers` array wins; otherwise build a one-rung ladder from the single-tier
    // params so existing tests read unchanged.
    let resolvedTiers: [TierConfig] = tiers ?? (tierPlaylistUrl.map { [TierConfig(playlistUrl: $0, bandwidth: tierBandwidth, codecs: tierCodecs, width: tierWidth, height: tierHeight)] } ?? [])
    return RemuxConfig(
        inputUrl: inputUrl,
        audioTracks: audioTracks,
        durationSeconds: durationSeconds,
        subtitles: subtitles,
        videoRange: videoRange,
        supplementalCodecs: supplementalCodecs,
        codecs: codecs,
        width: width,
        height: height,
        frameRate: frameRate,
        bandwidth: bandwidth,
        readAheadSegments: readAheadSegments,
        tiers: resolvedTiers,
        startOffsetSeconds: startOffsetSeconds,
        isLive: isLive,
        liveSegmentSeconds: liveSegmentSeconds,
        liveWindowSeconds: liveWindowSeconds,
        stopRequests: stopRequests
    )
}

/// The DELETE that ends each server transcode a tier or audio URL started, as the app builds it
/// (services/localRemux.ts tierStopRequests): the job is keyed by the PlaySessionId riding the URL.
func jellyfinStopRequests(_ urls: [String]) -> [StopRequest] {
    urls.compactMap { urlString in
        guard let components = URLComponents(string: urlString),
              let apiKey = components.queryItems?.first(where: { $0.name == "ApiKey" })?.value,
              let playSessionId = components.queryItems?.first(where: { $0.name == "PlaySessionId" })?.value,
              let scheme = components.scheme, let host = components.host
        else { return nil }
        let port = components.port.map { ":\($0)" } ?? ""
        return StopRequest(url: "\(scheme)://\(host)\(port)/Videos/ActiveEncodings?deviceId=tomo-slipstream&playSessionId=\(playSessionId)&ApiKey=\(apiKey)", method: "DELETE")
    }
}
