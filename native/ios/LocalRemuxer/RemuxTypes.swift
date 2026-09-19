//
//  RemuxTypes.swift
//  TomoTV
//
//  Data types the remux engine is configured with and reports through: the
//  master-playlist subtitle/audio descriptors, the session config, and the
//  Slipstream tier's adopted grid and rungs. Behaviour lives in RemuxSession
//  and its extensions; this file is only the shapes they pass around.
//

import Foundation

/// One subtitle rendition surfaced in the master playlist. An engine-decoded
/// text track is cut on the session grid; every other kind resolves to a single
/// full-duration segment.
struct RemuxSubtitle {
    let index: Int
    let name: String
    let language: String
    /// Jellyfin's WebVTT endpoint, for a sidecar: it is not in the container.
    let vttUrl: String
    /// Filesystem path of a track saved with a download. Served over the loopback like an
    /// image track's body: a file:// URI inside an http playlist is a scheme AVFoundation
    /// will not follow.
    let localVtt: String
    let isDefault: Bool
    /// Carries dialogue the viewer is meant to see without turning subtitles on
    /// (foreign speech, signs). Reaches the playlist as AUTOSELECT=YES, never as
    /// FORCED=YES: see masterPlaylist() for the device measurement that killed
    /// that attribute. These used to be burned into the picture instead.
    let isForced: Bool
    /// A bitmap track (PGS, DVD/VobSub, DVB, XSUB). Jellyfin cannot render one
    /// as WebVTT, so `vttUrl` is empty and the rendition serves a cue-less
    /// playlist instead: proven on a real Apple TV to be listed and selectable
    /// in AVKit's picker while drawing nothing, which leaves the picture to us.
    /// The images come from ImageSubtitleDecoder.
    let isImage: Bool
    /// An embedded text track this engine decodes itself, as WebVTT segments on
    /// the session grid. `vttUrl` instead costs a server ffmpeg extraction
    /// before AVPlayer reports ready.
    let isEngineText: Bool
    /// The server's WebVTT of an engine text track: the cue source for a window the read loop
    /// cannot reach in time (a slow link, or a session held on the server rungs).
    var serverVttUrl: String = ""
    /// The server's raw copy of a PGS track (Stream.pgssub), for when the source is not read.
    var serverSupUrl: String = ""
}

/// One cue of a server WebVTT, in source time like the decoder's.
struct ServerCue {
    let start: Double
    let end: Double
    let text: String
}

/// One selectable audio track. With several tracks, every one becomes its own
/// audio-only rendition and the variant is video-only; a lone track is muxed
/// with the video as before. Ordering is the contract: the JS caller
/// (services/localRemux.ts) sorts the preferred track first (user selection,
/// else Jellyfin's default) and masterPlaylist() marks position 0 DEFAULT=YES.
struct RemuxAudioTrack {
    /// ffprobe/Jellyfin stream index in the source file.
    let index: Int
    let name: String
    let language: String
    /// Jellyfin audio-only HLS playlist for this track (main.m3u8, fMP4).
    /// Feeds the tier's "audio-lo" rendition group so the survival rung never
    /// needs the engine's source pull. Empty = no server rendition; the tier
    /// then shares the engine's audio group as before.
    let serverAudioUrl: String
    /// The same track in the "audio-hi" group: AAC at its own channel count, for the rungs with
    /// room for it. Empty when the item has no hi group.
    var serverAudioHiUrl: String = ""
}

struct RemuxConfig {
    let inputUrl: String
    /// Every audio track to expose, default first. Empty means "pick the best
    /// audio stream in the file".
    let audioTracks: [RemuxAudioTrack]
    let durationSeconds: Double
    let subtitles: [RemuxSubtitle]
    /// HLS VIDEO-RANGE for the variant: "SDR", "PQ" (HDR10) or "HLG". Comes
    /// from Jellyfin's stream metadata (services/localRemux.ts) because the
    /// master playlist is served before FFmpeg has parsed the input. Required
    /// by Apple's HLS spec; AVFoundation hard-fails PQ content in a variant
    /// that doesn't declare it (-12927, found by the HDR10 harness run).
    let videoRange: String
    /// SUPPLEMENTAL-CODECS for a backward-compatible Dolby Vision source
    /// ("dvh1.08.06/db1p"), empty otherwise. Additive: CODECS keeps its hvc1
    /// token, so a player ignoring this attribute still gets the HDR10 base.
    let supplementalCodecs: String
    /// RFC 6381 CODECS for the variant (e.g. "hvc1.2.4.L123.B0,mp4a.40.2").
    /// Empty omits the attribute. Required alongside a non-SDR VIDEO-RANGE:
    /// AVFoundation refuses to select a PQ/HLG variant whose codec support it
    /// cannot verify, and with no selectable variant the whole master fails.
    let codecs: String
    /// Source video size, frame rate and peak bit rate, from the same Jellyfin
    /// metadata and for the same reason: Apple's authoring specification
    /// requires RESOLUTION (9.2), FRAME-RATE (9.15), BANDWIDTH (9.13) and
    /// AVERAGE-BANDWIDTH (9.14) on every variant, and this playlist is written
    /// before FFmpeg has opened the input. Zero omits the attribute.
    let width: Int
    let height: Int
    let frameRate: Double
    let bandwidth: Int
    /// Producer read-ahead depth in segments; 0 means the built-in default.
    /// Config-driven from JS so the cushion is tunable without a rebuild.
    let readAheadSegments: Int
    /// Slipstream ladder (memories/CLAUDE-slipstream.md): server transcode
    /// variants, sorted ascending by bandwidth. Empty (every non-gateway
    /// session) keeps the fixed 6s grid untouched. The first rung's playlist
    /// defines the ADOPTED grid; the rest are validated against it and dropped
    /// on a mismatch. Each rung is one EXT-X-STREAM-INF in the master.
    let tiers: [TierConfig]
    /// Resume position. Positive emits EXT-X-START in every media playlist
    /// (RFC 8216 §4.3.5.2, honored by tvOS — probe-verified): AVPlayer opens
    /// at the offset instead of buffering position zero and seeking away, and
    /// its first segment request drives the producer's seek-restart there.
    let startOffsetSeconds: Double
    /// Jellyfin item id, the chapter frame pool's key. Empty keeps frames in the session directory.
    var itemId: String = ""
    /// Live TV: unbounded input on a sliding-window playlist, no seeks. durationSeconds is ignored.
    var isLive: Bool = false
    /// Live segment target (Apple HLS authoring spec 7.5), independent of the VOD grid.
    var liveSegmentSeconds: Double = 6.0
    /// Live window kept on disk and listed in the playlist (AVPlayer's seekable range).
    var liveWindowSeconds: Double = 300.0
    /// Headers the input origin requires (a live manifest's User-Agent); User-Agent maps to FFmpeg's user_agent.
    var httpHeaders: [String: String] = [:]
    /// Live: the input is an origin's HLS playlist, checked for refusal alongside the open.
    var probeOrigin: Bool = false
}

/// One adopted segment of the server tier's playlist: the server's own
/// duration and its verbatim segment URL (relative to the item's HLS root),
/// PlaySessionId included — never recomputed on our side (M1: the server's
/// grid is item-intrinsic and its URLs embed the authoritative runtimeTicks).
struct TierSegment {
    let duration: Double
    let url: String
}

/// One rung of the Slipstream ladder: a server transcode variant. Every rung of
/// an item shares the segment grid (source keyframes, item-intrinsic, M1), so
/// AVPlayer's ABR switches between rungs on aligned boundaries. The master lists
/// the rungs or the on-device copy, never both (see masterPlaylist).
struct TierConfig {
    let playlistUrl: String
    let bandwidth: Int
    let codecs: String
    let width: Int
    let height: Int
    /// This rung rides the "audio-hi" group and its bandwidth carries that group's rate.
    var audioHi: Bool = false
}
