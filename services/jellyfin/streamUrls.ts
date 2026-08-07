/**
 * Building the two playback URLs: the direct-play /stream endpoint and the HLS
 * master.m3u8 the server may stream-copy or re-encode, shaped by the user's quality
 * preset and the item's subtitle/audio layout.
 */
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { JELLYFIN_TIME, TRANSCODING } from "./constants";
import { getCachedConfig, getQualitySettings } from "./session";

/**
 * Get video stream URL for a specific item
 * Uses /Videos/{id}/stream?Static=true for proper HTTP range support (seeking)
 * Returns empty string if config not yet loaded
 * @param itemId - The video item ID
 * @param videoItem - Optional video item for extracting MediaSourceId
 */
export function getVideoStreamUrl(itemId: string, videoItem?: JellyfinVideoItem | null): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    logger.warn("getVideoStreamUrl called before config loaded", { service: "JellyfinAPI" });
    return "";
  }

  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;
  const url = `${getCachedConfig().server}/Videos/${itemId}/stream` + `?Static=true` + `&MediaSourceId=${mediaSourceId}` + `&api_key=${getCachedConfig().apiKey}`;

  logger.debug("Generated direct play stream URL", {
    service: "JellyfinAPI",
    server: getCachedConfig().server,
    itemId,
    mediaSourceId,
  });

  return url;
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
 * Segments are fMP4 (SegmentContainer=mp4): Apple's HLS spec requires fMP4
 * for HEVC, and AVPlayer handles it for H.264 equally well.
 *
 * @param itemId - The video item ID
 * @param videoItem - Optional video item with MediaStreams for subtitle detection
 * @param burnInSubtitleIndex - Optional subtitle stream index to burn into the video (SubtitleMethod=Encode, for image-based formats like PGS)
 */
export async function getTranscodingStreamUrl(
  itemId: string,
  videoItem?: JellyfinVideoItem | null,
  audioStreamIndex?: number,
  startTimeTicks?: number,
  burnInSubtitleIndex?: number,
  playSessionId?: string,
): Promise<string> {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    logger.warn("getTranscodingStreamUrl called before config loaded", { service: "JellyfinAPI" });
    throw new Error("Configuration not loaded. Please wait for app to initialize.");
  }

  // Get user's quality preferences
  const quality = await getQualitySettings();

  // Get MediaSourceId from video details if available, fallback to itemId
  // This is important for playlist items where MediaSourceId may differ from item Id
  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;

  // Capped presets keep today's compatibility contract (H.264-target encode,
  // stereo AAC) and only stream-copy sources already inside their caps. The
  // uncapped "Original" preset also admits AC3/EAC3 and 5.1 audio, which
  // AVPlayer plays natively in HLS, so surround tracks copy instead of
  // downmixing.
  const capped = quality.width !== undefined;

  // Use HLS master.m3u8 endpoint; the server decides copy vs encode per stream
  let url =
    `${getCachedConfig().server}/Videos/${itemId}/master.m3u8?` +
    `api_key=${getCachedConfig().apiKey}` +
    `&MediaSourceId=${mediaSourceId}` +
    `&VideoCodec=h264,hevc` +
    `&AudioCodec=${capped ? "aac" : "aac,ac3,eac3"}` +
    `&VideoBitrate=${quality.bitrate}` +
    `&AudioBitrate=${TRANSCODING.AUDIO_BITRATE}` + // 192kbps AAC when audio must encode
    (capped ? `&MaxWidth=${quality.width}` + `&MaxHeight=${quality.height}` + `&VideoLevel=${quality.level}` : ``) +
    `&TranscodingMaxAudioChannels=${capped ? TRANSCODING.MAX_AUDIO_CHANNELS : TRANSCODING.SURROUND_AUDIO_CHANNELS}` +
    `&SegmentContainer=mp4` + // fMP4: required for HEVC in HLS
    `&MinSegments=1` +
    `&SegmentLength=10` + // 10 second segments (was 8)
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
    // Include ALL subtitle tracks (external .srt files AND embedded subtitles)
    // Previously only included IsExternal=true, which missed embedded subtitle streams
    const subtitleStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined);

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

  logger.debug("Generated transcoding stream URL", {
    service: "JellyfinAPI",
    server: getCachedConfig().server,
    itemId,
    urlPreview: url.substring(0, 150) + "...",
  });

  // Log full URL for debugging (helps inspect HLS manifest for multi-audio/subtitle tracks)
  logger.info("Full HLS transcoding URL generated", {
    service: "JellyfinAPI",
    itemId,
    fullUrl: url,
  });

  return url;
}
