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
 * Audio codecs the engine can carry. AAC/ALAC/MP3 are copied verbatim;
 * everything else here is decoded and re-encoded to AAC on device
 * (native/ios/LocalRemuxer/AudioTranscoder.swift), which is what lets AC3,
 * DTS and TrueHD files play locally at all — AVPlayer cannot decode them, and
 * the mp4 muxer cannot even write AC3's dac3 box without first seeing a packet.
 *
 * Anything not listed has no decoder in the linked FFmpeg build and stays on
 * the server path.
 */
const REMUXABLE_AUDIO_CODECS = [
  // copied through untouched
  "aac",
  "mp4a",
  "alac",
  "mp3",
  // decoded and re-encoded to AAC on device
  "ac3",
  "ac-3",
  "eac3",
  "ec-3",
  "dts",
  "dca",
  "truehd",
  "mlp",
  "opus",
  "vorbis",
  "flac",
  "pcm",
];

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

  // Audio is either copied or re-encoded to AAC on device; only codecs the
  // linked FFmpeg has no decoder for stay on the server path. Multi-track
  // files are fine: each extra track becomes its own HLS audio rendition, so
  // switching still works and still costs the server nothing.
  const audioTracks = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio");
  const everyTrackCarriable = audioTracks.every((track) => {
    const audioCodec = track.Codec?.toLowerCase();
    return !audioCodec || REMUXABLE_AUDIO_CODECS.some((known) => audioCodec.includes(known));
  });
  if (!everyTrackCarriable) return false;

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

  // Default track first: it is muxed with the video, the rest become
  // selectable audio-only renditions.
  const audioTracks = (videoItem.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Audio" && stream.Index !== undefined)
    .map((stream) => ({
      index: stream.Index as number,
      name: stream.DisplayTitle || stream.Language || `Audio ${stream.Index}`,
      language: stream.Language || "und",
      isDefault: stream.IsDefault === true,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
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
    audioTracks,
    durationSeconds,
    subtitles,
  });

  logger.info("Local remux session started", {
    service: "LocalRemux",
    itemId: videoItem.Id,
    durationSeconds: Math.round(durationSeconds),
    audioTrackCount: audioTracks.length,
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
