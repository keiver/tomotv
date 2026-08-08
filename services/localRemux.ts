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
 * Codecs AVPlayer decodes natively (REMUXABLE_CODECS) are copied verbatim.
 * Codecs it cannot decode at all (TRANSCODABLE_VIDEO_CODECS) are decoded in
 * software and re-encoded to H.264 by VideoToolbox on the way through
 * (native/ios/LocalRemuxer/VideoTranscoder.swift), gated by resolution, bit
 * depth and interlacing below. Anything else still goes through the server.
 */

import { NativeModules, Platform } from "react-native";
import { REMUXABLE_CODECS } from "@/constants/codecs";
import { getVideoStreamUrl, getSubtitleUrl, isImageBasedSubtitleCodec, JELLYFIN_TIME } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

const { LocalRemuxer } = NativeModules;
/** Same, but only on hardware that reports AV1 decode support at runtime. */
const AV1_CODECS = ["av1", "av01"];

/**
 * Video codecs AVPlayer cannot decode but the on-device engine can transcode
 * to H.264 (software decode + VideoToolbox encode). Every entry was verified
 * REGISTERED in the linked FFmpeg build via av_codec_iterate — not by symbol:
 * the archive contains object files for codecs that were never enabled
 * (msmpeg4v1-3 are in there as wmv1/wmv2 dependencies but
 * avcodec_find_decoder returns NULL for them, so DivX 3 stays on the server
 * path). Substring matching covers family variants (h263p/i, wmv1/2/3,
 * vp6/vp6f/vp6a, rv10-40, mpeg1video). Theora, DV and Cinepak are not in the
 * build and are deliberately absent.
 */
const TRANSCODABLE_VIDEO_CODECS = ["vp8", "vp9", "vp7", "mpeg1video", "mpeg1", "mpeg2video", "mpeg2", "mpeg4", "wmv", "vc1", "h263", "flv1", "rv10", "rv20", "rv30", "rv40", "vp6", "svq3"];

/**
 * On-device transcode is only attempted below this pixel count. The Apple TV
 * measured 7.63x realtime at 2048x858 (1.76 Mpx); 4K extrapolates to ~1.6x,
 * too close to the stall line, and 8K failed outright. 2_100_000 admits
 * 1920x1080 and the measured file, excludes 4K.
 */
const TRANSCODE_MAX_PIXELS = 2_100_000;

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
  // decoded and re-encoded to AAC on device. MP3 is here rather than copied:
  // Apple HLS allows MP3 audio only in MPEG-TS segments, and AVPlayer refuses
  // fMP4 with an .mp3 sample entry outright ("Cannot Open").
  "mp3",
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
  // companions of the transcodable video codecs, decoders verified registered
  // via av_codec_iterate: MPEG-2 content carries MP2, WMV carries WMA
  // (v1/v2/Pro/Lossless all match "wma"), RealMedia carries Cook, 3GP carries
  // AMR ("amr" matches amrnb/amrwb). RealAudio sipr/atrac have no decoder in
  // the build and correctly stay excluded.
  "mp2",
  "wma",
  "cook",
  "amr",
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
 * Whether this item can play through the local remux engine — either
 * stream-copied (H.264/HEVC, gated AV1) or transcoded on device
 * (TRANSCODABLE_VIDEO_CODECS under the resolution/bit-depth/interlace gates).
 * Burn-in files keep the server path: it has to render subtitles into the
 * picture.
 *
 * These gates are a fast heuristic over Jellyfin metadata; the native layer
 * re-checks the decoder's actual pixel format and field order at session
 * start, and a failure there falls back to the server transcode. A wrong gate
 * costs seconds, never a dead playback.
 */
export async function canRemuxLocally(videoItem: JellyfinVideoItem | null, hasBurnInSubtitle: boolean): Promise<boolean> {
  if (!isLocalRemuxAvailable() || !videoItem?.MediaStreams || hasBurnInSubtitle) {
    return false;
  }

  const videoStream = videoItem.MediaStreams.find((stream) => stream.Type === "Video");
  if (!videoStream?.Codec) return false;
  const codec = videoStream.Codec.toLowerCase();

  // Audio is either copied or re-encoded to AAC on device; only codecs the
  // linked FFmpeg has no decoder for stay on the server path. Multi-track
  // files are fine: each extra track becomes its own HLS audio rendition, so
  // switching still works and still costs the server nothing.
  //
  // Prefix match, not substring: family variants still match ("pcm_s16le",
  // "wmav2", "mp4a.40.2"), but unrelated codecs that merely CONTAIN an entry
  // ("atrac3" contains "ac3") no longer slip through.
  const audioTracks = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio");
  const everyTrackCarriable = audioTracks.every((track) => {
    const audioCodec = track.Codec?.toLowerCase();
    return !audioCodec || REMUXABLE_AUDIO_CODECS.some((known) => audioCodec.startsWith(known));
  });
  if (!everyTrackCarriable) return false;

  if (!videoItem.RunTimeTicks || videoItem.RunTimeTicks <= 0) return false;

  // Prefix match everywhere, same reason as the audio list: family variants
  // match ("hvc1", "wmv3", "vp6f"), codecs that merely CONTAIN an entry do not
  // ("msmpeg4v3" contains "mpeg4" but has no registered decoder).
  if (REMUXABLE_CODECS.some((known) => codec.startsWith(known))) return true;
  if (AV1_CODECS.some((known) => codec.startsWith(known))) return await supportsAV1();

  // Exotic codecs: decoded and re-encoded to H.264 on device. Three gates,
  // each driven by a hard constraint, not taste:
  // - pixel count: measured Apple TV throughput headroom (TRANSCODE_MAX_PIXELS)
  // - bit depth: h264_videotoolbox accepts 8-bit yuv420p/nv12 only, and no
  //   libswscale is linked to convert
  // - interlacing: no deinterlacer in the build; the server path has one
  if (TRANSCODABLE_VIDEO_CODECS.some((known) => codec.startsWith(known))) {
    const width = videoStream.Width ?? 0;
    const height = videoStream.Height ?? 0;
    if (width <= 0 || height <= 0 || width * height > TRANSCODE_MAX_PIXELS) return false;
    if ((videoStream.BitDepth ?? 8) > 8) return false;
    if (videoStream.IsInterlaced === true) return false;
    return true;
  }

  return false;
}

/**
 * Start a remux session and return the loopback HLS URL for the player.
 * Throws when the native module is unavailable or the session cannot start;
 * callers fall back to the server transcode path.
 */
export async function startLocalRemux(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number): Promise<string> {
  if (!isLocalRemuxAvailable()) {
    throw new Error("Local remux native module not available on this platform");
  }

  // Same untouched original file the direct-play path uses; FFmpeg reads it
  // with byte ranges, so seeking never re-downloads from the start.
  const inputUrl = getVideoStreamUrl(videoItem.Id, videoItem);
  const durationSeconds = (videoItem.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;

  // Position 0 is muxed with the video and marked DEFAULT=YES in the master
  // playlist, the rest become selectable audio-only renditions. A user-selected
  // track (audio switch restart) outranks Jellyfin's default — ordering is the
  // only channel to the native side, so putting it first IS the selection.
  const audioTracks = (videoItem.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Audio" && stream.Index !== undefined)
    .map((stream) => ({
      index: stream.Index as number,
      name: stream.DisplayTitle || stream.Language || `Audio ${stream.Index}`,
      language: stream.Language || "und",
      isDefault: stream.IsDefault === true,
    }))
    .sort((a, b) => Number(b.index === preferredAudioStreamIndex) - Number(a.index === preferredAudioStreamIndex) || Number(b.isDefault) - Number(a.isDefault));
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
      // Forced tracks used to be burned into the picture. They are renditions
      // now, so the flag has to reach the master playlist as FORCED=YES or
      // AVFoundation will never present one on its own.
      isForced: stream.IsForced === true,
    }))
    .filter((sub) => sub.vttUrl.length > 0);

  // HLS VIDEO-RANGE for the master playlist. Apple's spec requires it and
  // AVFoundation hard-rejects PQ (HDR10/DoVi-with-PQ) content in a variant
  // that doesn't declare it (-12927). Jellyfin's VideoRangeType is the source:
  // HDR10/HDR10+/DOVI are PQ-transfer, HLG is HLG, everything else SDR.
  const videoStreamMeta = (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Video");
  const rangeType = (videoStreamMeta?.VideoRangeType || videoStreamMeta?.VideoRange || "SDR").toUpperCase();
  const videoRange = rangeType.includes("HLG") ? "HLG" : rangeType.includes("HDR") || rangeType.includes("DOVI") || rangeType.includes("PQ") ? "PQ" : "SDR";

  // CODECS accompanies a non-SDR VIDEO-RANGE only: AVFoundation refuses to
  // select an HDR variant whose codec support it cannot verify, while SDR
  // variants have provably never needed the attribute here. Only HEVC carries
  // HDR through the remux path (Main 10 = profile_idc 2), so the string is
  // the Apple-documented hvc1 form with the stream's level, plus the AAC the
  // engine always outputs.
  const codecs = videoRange === "SDR" ? "" : `hvc1.2.4.L${videoStreamMeta?.Level && videoStreamMeta.Level > 0 ? videoStreamMeta.Level : 123}.B0,mp4a.40.2`;

  const url: string = await LocalRemuxer.startRemux({
    inputUrl,
    audioTracks,
    durationSeconds,
    subtitles,
    videoRange,
    codecs,
  });

  // The token is the path segment of the master URL (…/<token>/master.m3u8). It is
  // this caller's ownership handle: stopLocalRemux passes it so a late teardown can
  // never kill a session a newer start owns (native stopRemux no-ops on mismatch).
  activeToken = url.split("/").at(-2) ?? null;

  logger.info("Local remux session started", {
    service: "LocalRemux",
    itemId: videoItem.Id,
    durationSeconds: Math.round(durationSeconds),
    audioTrackCount: audioTracks.length,
    subtitleCount: subtitles.length,
  });

  return url;
}

/** Token of the session this JS runtime started last; null when none is live. */
let activeToken: string | null = null;

/** Tear down the session this runtime started (idempotent; no-op if superseded). */
export async function stopLocalRemux(): Promise<void> {
  if (!isLocalRemuxAvailable()) return;
  const token = activeToken;
  if (!token) return;
  activeToken = null;
  try {
    await LocalRemuxer.stopRemux(token);
  } catch (error) {
    logger.warn("Failed to stop local remux session", error, { service: "LocalRemux" });
  }
}
