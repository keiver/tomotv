/**
 * localRemux.ts
 *
 * Service for the on-device remux engine (native/ios/LocalRemuxer).
 *
 * The engine reads the original file straight from Jellyfin, rewraps the video
 * and one audio track into fMP4 HLS on the device, and serves it over loopback
 * HTTP. AVPlayer plays that with its native transport controls, so a file the
 * server would otherwise transcode plays at original quality with no server
 * transcode session at all.
 *
 * Only containers matter here, never pixels: the video stream is copied
 * verbatim, so the engine is limited to codecs AVPlayer can decode natively
 * (see REMUXABLE_CODECS). Anything else still goes through the server.
 */

import { NativeModules, Platform } from "react-native";
import { getVideoStreamUrl, getSubtitleUrl, isImageBasedSubtitleCodec, JELLYFIN_TIME } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

const { LocalRemuxer } = NativeModules;

/** Video codecs AVPlayer decodes natively, so the remuxer can stream-copy them. */
const REMUXABLE_CODECS = ["h264", "avc", "hevc", "h265", "hvc1", "hev1"];
/** Same, but only on hardware that reports AV1 decode support at runtime. */
const AV1_CODECS = ["av1", "av01"];

/**
 * Audio codecs the remuxer can carry into fMP4. The audio stream is copied
 * verbatim, so anything outside this list stays on the server path (which
 * downmixes it to AAC) for one of two reasons:
 *
 *  - AVPlayer cannot decode it at all: DTS, TrueHD, Opus, Vorbis.
 *  - AC3/EAC3: AVPlayer plays these happily, but FFmpeg's mp4 muxer cannot
 *    write their dac3/dec3 box before it has seen a packet, and its usual
 *    workaround (delay_moov) folds the first fragment into the moov as a bare
 *    mdat, which is not a valid HLS media segment. Supporting them needs
 *    either an AAC encode pass or ffmpeg's own hls muxer, which the MPVKit
 *    build does not include.
 */
const REMUXABLE_AUDIO_CODECS = ["aac", "mp4a", "alac", "mp3"];

/** Cached capability probe; AV1 decode is hardware-dependent (never on Apple TV). */
let av1Supported: boolean | null = null;

export function isLocalRemuxAvailable(): boolean {
  return Platform.OS === "ios" && !!LocalRemuxer?.startRemux;
}

async function supportsAV1(): Promise<boolean> {
  if (av1Supported !== null) return av1Supported;
  if (!isLocalRemuxAvailable()) {
    av1Supported = false;
    return false;
  }
  try {
    av1Supported = (await LocalRemuxer.isAV1HardwareDecodeSupported()) === true;
  } catch {
    av1Supported = false;
  }
  return av1Supported;
}

/**
 * Whether this item can play through the local remux engine.
 *
 * Deliberately narrow. Multi-audio files keep the server path so the seamless
 * track switching in multiAudioLoader.ts is untouched, and burn-in files need
 * the server to render subtitles into the picture.
 */
export async function canRemuxLocally(videoItem: JellyfinVideoItem | null, hasBurnInSubtitle: boolean): Promise<boolean> {
  if (!isLocalRemuxAvailable() || !videoItem?.MediaStreams || hasBurnInSubtitle) {
    return false;
  }

  const videoStream = videoItem.MediaStreams.find((stream) => stream.Type === "Video");
  const codec = videoStream?.Codec?.toLowerCase();
  if (!codec) return false;

  const audioTracks = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio");
  if (audioTracks.length > 1) return false;

  // The audio stream is copied as-is, so a codec AVPlayer can't decode (DTS,
  // TrueHD, Opus, Vorbis) has to stay on the server path even though the video
  // itself would remux fine.
  const audioCodec = audioTracks[0]?.Codec?.toLowerCase();
  if (audioCodec && !REMUXABLE_AUDIO_CODECS.some((known) => audioCodec.includes(known))) {
    return false;
  }

  if (!videoItem.RunTimeTicks || videoItem.RunTimeTicks <= 0) return false;

  if (REMUXABLE_CODECS.some((known) => codec.includes(known))) return true;
  if (AV1_CODECS.some((known) => codec.includes(known))) return await supportsAV1();
  return false;
}

/**
 * Start a remux session and return the loopback HLS URL for the player.
 * Throws when the native module is unavailable or the session cannot start;
 * callers fall back to the server transcode path.
 */
export async function startLocalRemux(videoItem: JellyfinVideoItem): Promise<string> {
  if (!isLocalRemuxAvailable()) {
    throw new Error("Local remux native module not available on this platform");
  }

  // Same untouched original file the direct-play path uses; FFmpeg reads it
  // with byte ranges, so seeking never re-downloads from the start.
  const inputUrl = getVideoStreamUrl(videoItem.Id, videoItem);
  const durationSeconds = (videoItem.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;

  const audioStream = videoItem.MediaStreams?.find((stream) => stream.Type === "Audio");
  // Text subtitles ride along as HLS renditions served straight from Jellyfin;
  // image-based ones can't (they'd need burn-in, which excludes this path).
  const subtitles = (videoItem.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined && !isImageBasedSubtitleCodec(stream.Codec))
    .map((stream) => ({
      index: stream.Index as number,
      name: stream.DisplayTitle || stream.Language || `Subtitle ${stream.Index}`,
      language: stream.Language || "und",
      vttUrl: getSubtitleUrl(videoItem.Id, stream.Index as number, "vtt"),
      isDefault: stream.IsDefault === true,
    }))
    .filter((sub) => sub.vttUrl.length > 0);

  const url: string = await LocalRemuxer.startRemux({
    inputUrl,
    audioStreamIndex: audioStream?.Index ?? -1,
    durationSeconds,
    subtitles,
  });

  logger.info("Local remux session started", {
    service: "LocalRemux",
    itemId: videoItem.Id,
    durationSeconds: Math.round(durationSeconds),
    audioStreamIndex: audioStream?.Index ?? -1,
    subtitleCount: subtitles.length,
  });

  return url;
}

/** Tear down the active session (idempotent). */
export async function stopLocalRemux(): Promise<void> {
  if (!isLocalRemuxAvailable()) return;
  try {
    await LocalRemuxer.stopRemux();
  } catch (error) {
    logger.warn("Failed to stop local remux session", error, { service: "LocalRemux" });
  }
}
