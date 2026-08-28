/**
 * Building the two playback URLs: the direct-play /stream endpoint and the HLS
 * master.m3u8 the server may stream-copy or re-encode, shaped by the user's quality
 * preset and the item's subtitle/audio layout.
 */
import { localMediaUri } from "@/services/downloads/localSource";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { JELLYFIN_TIME, QualityPreset, TRANSCODING } from "./constants";
import { getCachedConfig, getQualitySettings } from "./session";
import { isImageBasedSubtitleCodec } from "./subtitles";

/**
 * Slipstream: the server tier's media playlist URL for the loopback gateway
 * (memories/CLAUDE-slipstream.md). main.m3u8, not master: the engine adopts
 * its segment list as the session grid and uses its segment URLs verbatim.
 * TS container + h264/aac at the tier bitrate; the engine rewraps to fMP4.
 */
export function getTierPlaylistUrl(itemId: string, videoItem: JellyfinVideoItem | null | undefined, preset: QualityPreset, playSessionId: string): string {
  const config = getCachedConfig();
  if (!config.server || !config.apiKey) return "";
  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;
  return (
    `${config.server}/Videos/${itemId}/main.m3u8?` +
    `ApiKey=${config.apiKey}&MediaSourceId=${mediaSourceId}` +
    `&VideoCodec=h264&AudioCodec=aac` +
    `&VideoBitrate=${preset.bitrate}&AudioBitrate=128000` +
    (preset.width ? `&MaxWidth=${preset.width}` : "") +
    `&SegmentContainer=ts&SegmentLength=6&MinSegments=1` +
    `&BreakOnNonKeyFrames=false&TranscodingMaxAudioChannels=2` +
    `&PlaySessionId=${playSessionId}`
  );
}

/**
 * Slipstream audio-lo: Jellyfin's audio-only HLS of ONE track of a video item
 * (route verified against server source: no item-type guard, `-vn -acodec …`).
 * main.m3u8, NEVER master.m3u8 — the master route NREs server-side for video
 * items with text subtitles (DynamicHlsHelper, null VideoRequest).
 * `copy` ships the original bits for codecs AVPlayer decodes; everything else
 * becomes server FLAC at the source channel count — the rung mirrors the
 * engine group's codec family so a variant switch stays inside AVPlayer's
 * sanctioned switching envelope (WWDC20 10158).
 */
export function getAudioRenditionUrl(
  itemId: string,
  videoItem: JellyfinVideoItem | null | undefined,
  audioStreamIndex: number,
  audioCodec: "copy" | "flac",
  channels: number,
  playSessionId: string,
): string {
  const config = getCachedConfig();
  if (!config.server || !config.apiKey) return "";
  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;
  return (
    `${config.server}/Audio/${itemId}/main.m3u8?` +
    `ApiKey=${config.apiKey}&MediaSourceId=${mediaSourceId}` +
    `&AudioCodec=${audioCodec}&AudioStreamIndex=${audioStreamIndex}` +
    (audioCodec === "flac" ? `&TranscodingMaxAudioChannels=${channels}` : "") +
    `&SegmentContainer=mp4&SegmentLength=6&PlaySessionId=${playSessionId}`
  );
}

/**
 * The server's copy of the original file: /Videos/{id}/stream?Static=true, which supports
 * HTTP range requests and therefore seeking. Empty string until config is loaded.
 *
 * Callers that must reach the server whatever is on disk use this one. The download manager is
 * the only such caller: routing it through getVideoStreamUrl below would make a download of an
 * item read its own partial file.
 */
export function getRemoteVideoStreamUrl(itemId: string, videoItem?: JellyfinVideoItem | null): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    logger.warn("getVideoStreamUrl called before config loaded", { service: "JellyfinAPI" });
    return "";
  }

  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;
  const url = `${getCachedConfig().server}/Videos/${itemId}/stream` + `?Static=true` + `&MediaSourceId=${mediaSourceId}` + `&ApiKey=${getCachedConfig().apiKey}`;

  logger.debug("Generated direct play stream URL", {
    service: "JellyfinAPI",
    server: getCachedConfig().server,
    itemId,
    mediaSourceId,
  });

  return url;
}

/**
 * What playback plays: the downloaded file when the item is complete on disk, the server
 * otherwise. One override reaches both consumers, the native audio queue
 * (audioPlayerManager.toTrack) and the remux engine (startLocalRemux's inputUrl), because both
 * build their source through here.
 */
export function getVideoStreamUrl(itemId: string, videoItem?: JellyfinVideoItem | null): string {
  const local = localMediaUri(itemId);
  if (local) {
    logger.info("Playing a downloaded file", { service: "JellyfinAPI", itemId });
    return local;
  }
  return getRemoteVideoStreamUrl(itemId, videoItem);
}

/**
 * Get HLS transcoding URL with configurable quality
 *
 * Uses master.m3u8 HLS endpoint with stream copy (remux) allowed: when the
 * source video is H.264/HEVC within the preset's caps, the server repackages
 * the original bits into fMP4 HLS segments instead of re-encoding, so an
 * H.264-in-MKV file plays at original quality with near-zero server CPU.
 * Sources the server can't copy (AV1, VP9, over-cap bitrate, burn-in
 * subtitles) fall back to an H.264/AAC encode capped by the quality preset.
 * Subtitles are included as togglable WebVTT tracks using SubtitleMethod=Hls.
 * All subtitle tracks (external .srt and embedded streams) are available via native controls.
 * Quality settings are loaded from user preferences.
 *
 * Segment container depends on the subtitle layout. Sessions carrying WebVTT
 * subtitle renditions use MPEG-TS: Jellyfin stamps every HLS WebVTT segment
 * with X-TIMESTAMP-MAP=MPEGTS:900000 (10s), which matches the mpegts muxer's
 * 10s PTS base but runs 10s late against fMP4 segments starting at 0. HEVC is
 * fMP4-only in HLS, so those sessions also pin the video target to H.264.
 * Everything else (no subs, or burn-in) stays fMP4 so HEVC can stream-copy.
 *
 * @param itemId - The video item ID
 * @param videoItem - Optional video item with MediaStreams for subtitle detection
 * @param burnInSubtitleIndex - Optional subtitle stream index to burn into the video (SubtitleMethod=Encode, for image-based formats like PGS)
 * @param presetOverride - Session-scoped preset from the adaptive controller (Auto mode /
 *   starvation fallback); absent = the stored quality setting, exactly as before
 */
export async function getTranscodingStreamUrl(
  itemId: string,
  videoItem?: JellyfinVideoItem | null,
  audioStreamIndex?: number,
  startTimeTicks?: number,
  burnInSubtitleIndex?: number,
  playSessionId?: string,
  presetOverride?: QualityPreset,
): Promise<string> {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    logger.warn("getTranscodingStreamUrl called before config loaded", { service: "JellyfinAPI" });
    throw new Error("Configuration not loaded. Please wait for app to initialize.");
  }

  // Get user's quality preferences
  const quality = presetOverride ?? (await getQualitySettings());

  // Get MediaSourceId from video details if available, fallback to itemId
  // This is important for playlist items where MediaSourceId may differ from item Id
  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;

  // Capped presets keep today's compatibility contract (H.264-target encode,
  // stereo AAC) and only stream-copy sources already inside their caps. The
  // uncapped "Original" preset also admits AC3/EAC3 and 5.1 audio, which
  // AVPlayer plays natively in HLS, so surround tracks copy instead of
  // downmixing.
  const capped = quality.width !== undefined;

  // ALL subtitle tracks (external .srt files AND embedded streams). When any
  // TEXT track rides along as a WebVTT rendition (SubtitleMethod=Hls below),
  // the session must use MPEG-TS segments and an H.264 target — see the doc
  // comment. Keyed on text tracks specifically, not on getBurnInSubtitleStream
  // having declined: only text tracks materialize as renditions, and deriving
  // this from another function's contract is how the 2026-08-07 gate bug
  // happened.
  const subtitleStreams = (videoItem?.MediaStreams ?? []).filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined);
  const hlsTextSubs = burnInSubtitleIndex === undefined && subtitleStreams.some((stream) => !isImageBasedSubtitleCodec(stream.Codec));

  // Use HLS master.m3u8 endpoint; the server decides copy vs encode per stream
  let url =
    `${getCachedConfig().server}/Videos/${itemId}/master.m3u8?` +
    `ApiKey=${getCachedConfig().apiKey}` +
    `&MediaSourceId=${mediaSourceId}` +
    `&VideoCodec=${hlsTextSubs ? "h264" : "h264,hevc"}` +
    `&AudioCodec=${capped ? "aac" : "aac,ac3,eac3"}` +
    `&VideoBitrate=${quality.bitrate}` +
    `&AudioBitrate=${TRANSCODING.AUDIO_BITRATE}` + // 192kbps AAC when audio must encode
    (capped ? `&MaxWidth=${quality.width}` + `&MaxHeight=${quality.height}` + `&VideoLevel=${quality.level}` : ``) +
    `&TranscodingMaxAudioChannels=${capped ? TRANSCODING.MAX_AUDIO_CHANNELS : TRANSCODING.SURROUND_AUDIO_CHANNELS}` +
    `&SegmentContainer=${hlsTextSubs ? "ts" : "mp4"}` + // ts aligns WebVTT's 10s timestamp map; fMP4 needed for HEVC otherwise
    `&MinSegments=1` +
    `&SegmentLength=6` + // Apple's target duration; shorter first segment = faster time-to-ready on slow servers
    `&BreakOnNonKeyFrames=false` + // Force keyframes at segment boundaries
    `&EnableAutoStreamCopy=true` +
    // Burning in subtitles renders them into the frames, which rules out
    // copying the source video stream
    `&AllowVideoStreamCopy=${burnInSubtitleIndex === undefined ? "true" : "false"}`;

  // Burn-in path: image-based subtitles (PGS/DVDSUB) cannot be delivered as WebVTT,
  // so the server renders the selected track into the video frames instead
  if (burnInSubtitleIndex !== undefined) {
    url += `&SubtitleStreamIndex=${burnInSubtitleIndex}` + `&SubtitleMethod=Encode`;

    logger.info("Transcoding with burned-in subtitle", {
      service: "JellyfinAPI",
      itemId,
      mediaSourceId,
      subtitleStreamIndex: burnInSubtitleIndex,
      quality: quality.label,
      bitrate: `${quality.bitrate / 1000000}Mbps`,
      server: getCachedConfig().server,
    });
  }

  // Check for subtitles (both external and embedded) and include them as HLS tracks
  // Skipped when burning in: SubtitleMethod is single-valued and already set to Encode
  if (videoItem && videoItem.MediaStreams) {
    if (burnInSubtitleIndex !== undefined) {
      // Burn-in already configured above; no WebVTT tracks in this session
    } else if (subtitleStreams.length > 0) {
      // Use SubtitleMethod=Hls to include all subtitles as separate WebVTT streams
      // DO NOT set SubtitleStreamIndex - this includes ALL subtitle tracks
      url += `&SubtitleMethod=Hls`;

      const externalCount = subtitleStreams.filter((s) => s.IsExternal).length;
      const embeddedCount = subtitleStreams.length - externalCount;

      logger.info("Transcoding with HLS subtitle tracks", {
        service: "JellyfinAPI",
        itemId,
        mediaSourceId,
        subtitleCount: subtitleStreams.length,
        externalSubtitles: externalCount,
        embeddedSubtitles: embeddedCount,
        languages: subtitleStreams.map((s) => s.Language || "und").join(", "),
        quality: quality.label,
        bitrate: `${quality.bitrate / 1000000}Mbps`,
        server: getCachedConfig().server,
      });
    } else {
      logger.info("Transcoding without subtitles", {
        service: "JellyfinAPI",
        itemId,
        mediaSourceId,
        quality: quality.label,
        bitrate: `${quality.bitrate / 1000000}Mbps`,
        server: getCachedConfig().server,
      });
    }

    // Include ALL audio tracks in HLS manifest
    const audioStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio" && stream.Index !== undefined);

    if (audioStreams.length > 1) {
      logger.info("Multiple audio tracks available", {
        service: "JellyfinAPI",
        itemId,
        audioTrackCount: audioStreams.length,
        languages: audioStreams.map((s) => s.Language || "und").join(", "),
      });
    }
  }

  // If specific audio track requested, only serve that track
  if (audioStreamIndex !== undefined) {
    url += `&AudioStreamIndex=${audioStreamIndex}`;
    logger.info("Transcoding with specific audio track", {
      service: "JellyfinAPI",
      itemId,
      audioStreamIndex,
    });
  }

  // If resuming from a seek crash, start transcoding from the given position
  if (startTimeTicks !== undefined && startTimeTicks > 0) {
    url += `&StartTimeTicks=${Math.round(startTimeTicks)}`;
    logger.info("Transcoding with StartTimeTicks (seek recovery)", {
      service: "JellyfinAPI",
      itemId,
      startTimeTicks,
      startTimeSeconds: startTimeTicks / JELLYFIN_TIME.TICKS_PER_SECOND,
    });
  }

  // Tie the server's transcode session to the playback reports (Sessions/Playing*)
  // so the server can clean up the HLS session when Stopped is reported
  if (playSessionId) {
    url += `&PlaySessionId=${playSessionId}`;
  }

  // The access token never reaches logs: the key sits in the first 150 chars, so the preview
  // leaks it as readily as the full URL would. Matches both the current ApiKey spelling and the
  // legacy api_key one, so an older URL built elsewhere still gets stripped.
  const redactedUrl = url.replace(/[Aa]pi_?[Kk]ey=[^&]+/, "ApiKey=[redacted]");

  logger.debug("Generated transcoding stream URL", {
    service: "JellyfinAPI",
    server: getCachedConfig().server,
    itemId,
    urlPreview: redactedUrl.substring(0, 150) + "...",
  });

  // Log full URL for debugging (helps inspect HLS manifest for multi-audio/subtitle tracks)
  logger.info("Full HLS transcoding URL generated", {
    service: "JellyfinAPI",
    itemId,
    fullUrl: redactedUrl,
  });

  return url;
}
