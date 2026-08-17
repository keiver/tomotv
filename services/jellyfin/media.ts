/**
 * Pure decisions about a media item: can AVPlayer decode it as-is, is it audio-only,
 * must it go through the HLS endpoint, and how long is it.
 *
 * Leaf module: no config, no network, no other jellyfin module. Every function here is
 * a pure function of the item it's handed, which is why they're trivially testable.
 */
import { REMUXABLE_CODECS } from "@/constants/codecs";
import { logger } from "@/utils/logger";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { JELLYFIN_TIME } from "./constants";

/**
 * Can AVPlayer decode this video codec natively (direct play / stream copy)?
 * Delegates to the single registry in constants/codecs.ts (REMUXABLE_CODECS):
 * H.264 (h264/avc*) and HEVC (hevc/h265/hvc1/hev1). Everything else returns
 * false and is routed downstream, where the local remux engine transcodes what
 * it can on device (including AV1 behind its hardware probe) and the server
 * handles the rest. Prefix (not substring) matching, per the codec-matching
 * lesson: unrelated codecs that merely contain an entry must not slip through.
 */
export function isCodecSupported(codec: string): boolean {
  const codecLower = codec.toLowerCase();
  return REMUXABLE_CODECS.some((known) => codecLower.startsWith(known));
}

/**
 * Audio codecs AVPlayer opens on its own, and the containers it will open them
 * in. Both halves matter: AVPlayer decodes Vorbis in nothing, and it refuses an
 * Ogg container whatever is inside it.
 *
 * Anything outside these lists is a file the engine has to rewrap. That used to
 * mean a server transcode, because audio-only items never reached the engine at
 * all — which is why T54 and T55 were written to expect a direct-play attempt
 * that fails and retries on the server.
 */
const AVPLAYER_AUDIO_CODECS = ["aac", "mp4a", "alac", "mp3", "flac", "pcm"];
const AVPLAYER_AUDIO_CONTAINERS = ["mp3", "m4a", "mp4", "mov", "aac", "adts", "wav", "wave", "aiff", "aif", "caf", "flac"];

/**
 * Does this audio-only item need the engine to be playable?
 *
 * Container is ffprobe's `format_name`, a comma-separated list of demuxer
 * aliases ("mov,mp4,m4a,3gp,3g2,mj2"), so any token matching is a match — the
 * same rule needsTranscoding applies to video containers.
 */
export function audioNeedsRewrap(videoItem: JellyfinVideoItem | null): boolean {
  const audioStream = videoItem?.MediaStreams?.find((stream) => stream.Type === "Audio");
  if (!audioStream?.Codec) return false;

  const codec = audioStream.Codec.toLowerCase();
  const codecPlayable = AVPLAYER_AUDIO_CODECS.some((known) => codec.startsWith(known));

  const container = videoItem?.MediaSources?.[0]?.Container?.toLowerCase();
  const containerPlayable = container ? container.split(",").some((name) => AVPLAYER_AUDIO_CONTAINERS.includes(name.trim())) : true;

  return !codecPlayable || !containerPlayable;
}

/**
 * Check if item is audio-only (no video stream)
 * Audio-only files should be handled differently or filtered out
 */
export function isAudioOnly(videoItem: JellyfinVideoItem | null): boolean {
  if (!videoItem || !videoItem.MediaStreams) {
    return false;
  }

  // Check if there's a video stream
  const hasVideo = videoItem.MediaStreams.some((stream) => stream.Type === "Video");
  const hasAudio = videoItem.MediaStreams.some((stream) => stream.Type === "Audio");

  // Audio-only: has audio but no video
  return !hasVideo && hasAudio;
}

/**
 * Route decision at tap time: does this item belong in the native audio queue
 * player instead of the video player? Music-library items carry Type "Audio";
 * the stream check additionally catches audio-only files sitting in video
 * libraries. Items without MediaStreams (some search responses) fall back to
 * the Type check alone.
 */
export function isAudioItem(item: JellyfinVideoItem | null): boolean {
  if (!item) return false;
  return item.Type === "Audio" || isAudioOnly(item);
}

/**
 * Check if video must go through the HLS endpoint instead of direct play.
 * Returns false when AVPlayer can play the file as-is (H.264/HEVC in MP4/MOV).
 * Returns true otherwise; the HLS endpoint then stream-copies (remuxes)
 * H.264/HEVC out of foreign containers like MKV and only re-encodes what
 * AVPlayer genuinely can't decode (see getTranscodingStreamUrl).
 */
export function needsTranscoding(videoItem: JellyfinVideoItem | null): boolean {
  if (!videoItem || !videoItem.MediaStreams) {
    return false; // Default to direct play if no info available
  }

  // Find the video stream
  const videoStream = videoItem.MediaStreams.find((stream) => stream.Type === "Video");

  if (!videoStream || !videoStream.Codec) {
    return false; // No video stream info, try direct play
  }

  const supported = isCodecSupported(videoStream.Codec);

  // Check container format: AVPlayer only supports MP4/MOV/M4V containers
  const container = videoItem.MediaSources?.[0]?.Container?.toLowerCase();
  const avplayerContainers = ["mp4", "mov", "m4v"];
  // Container is ffprobe's format_name: comma-separated demuxer aliases
  // (e.g., "mov,mp4,m4a,3gp,3g2,mj2" for QuickTime/MP4 family).
  // Check if ANY token matches, consistent with jellyfin-web's includesAny().
  const unsupportedContainer = container ? !container.split(",").some((c) => avplayerContainers.includes(c.trim())) : false;

  logger.debug("Codec/container check result", {
    service: "CodecCheck",
    codec: videoStream.Codec,
    container: container || "unknown",
    codecSupported: supported,
    unsupportedContainer,
  });

  return !supported || unsupportedContainer;
}

/**
 * Format duration from RunTimeTicks to readable format
 * RunTimeTicks are in 100-nanosecond intervals
 * @param ticks - RunTimeTicks from Jellyfin
 * @returns Formatted string like "1h 23m" or "45m"
 */
export function formatDuration(ticks: number): string {
  const totalSeconds = ticks / JELLYFIN_TIME.TICKS_PER_SECOND;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}
