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
    tierFirst: Bool = false,
    startOffsetSeconds: Double = 0
) -> RemuxConfig {
    RemuxConfig(
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
        tierPlaylistUrl: tierPlaylistUrl,
        tierBandwidth: tierBandwidth,
        tierCodecs: tierCodecs,
        tierWidth: tierWidth,
        tierHeight: tierHeight,
        tierFirst: tierFirst,
        startOffsetSeconds: startOffsetSeconds
    )
}
