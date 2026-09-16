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
    tierFirst: Bool = false,
    startOffsetSeconds: Double = 0,
    isLive: Bool = false,
    liveSegmentSeconds: Double = 6.0,
    liveWindowSeconds: Double = 300.0
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
        tierFirst: tierFirst,
        startOffsetSeconds: startOffsetSeconds,
        isLive: isLive,
        liveSegmentSeconds: liveSegmentSeconds,
        liveWindowSeconds: liveWindowSeconds
    )
}
