/**
 * Choosing subtitle tracks and addressing them.
 *
 * The split that matters: image-based tracks (PGS/DVDSUB) have no AVPlayer renderer and
 * can only reach the screen by server-side burn-in; text tracks are delivered as
 * selectable WebVTT renditions and must NOT be burned in.
 */
import { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { getCachedConfig } from "./session";

/**
 * Check if a subtitle codec is image-based (bitmap subtitles)
 * Image-based formats cannot be converted to WebVTT by Jellyfin, so they are
 * silently dropped from HLS manifests and must be burned into the video instead.
 * Matches the server's MediaStream.IsTextSubtitleStream classification.
 */
export function isImageBasedSubtitleCodec(codec: string | undefined): boolean {
  if (!codec) {
    return false;
  }
  const codecLower = codec.toLowerCase();
  if (codecLower === "sup" || codecLower === "sub") {
    return true; // Raw PGS (.sup) / VobSub (.sub) streams
  }
  return (
    codecLower.includes("pgs") || // pgssub, hdmv_pgs_subtitle (Blu-ray)
    codecLower.includes("dvdsub") ||
    codecLower.includes("dvd_subtitle") || // DVD subtitles (ffprobe name)
    codecLower.includes("vobsub") ||
    codecLower.includes("dvbsub") ||
    codecLower.includes("dvb_subtitle") || // DVB broadcast subtitles
    codecLower.includes("xsub") // DivX subtitles
  );
}

/**
 * Pick the subtitle stream to burn into the video during transcoding
 * Returns a candidate only when the item has subtitle streams and ALL of them
 * are image-based (PGS/DVDSUB). Mixed files keep the SubtitleMethod=Hls path so
 * text tracks stay selectable in the native player controls.
 * Priority: IsDefault > IsForced > first stream.
 */
export function getBurnInSubtitleStream(videoItem: JellyfinVideoItem | null): JellyfinMediaStream | null {
  if (!videoItem || !videoItem.MediaStreams) {
    return null;
  }

  const subtitleStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined);

  if (subtitleStreams.length === 0) {
    return null;
  }

  // ONLY image-based subtitles burn in. AVPlayer has no bitmap-subtitle renderer, so PGS/DVDSUB
  // can never reach the screen any other way (see lessons-learned: "Jellyfin Silently Drops
  // Image-Based Subtitles From HLS Manifests").
  //
  // Forced TEXT subtitles used to burn in too, on the belief that AVPlayer on tvOS cannot select
  // HLS text renditions. It can: the local remux engine serves every text track as exactly that
  // kind of rendition (Remuxer.swift subtitlePlaylist) and they are selectable on device. Burning
  // them in cost direct play AND stream copy, because burn-in forces AllowVideoStreamCopy=false.
  const allImageBased = subtitleStreams.every((stream) => isImageBasedSubtitleCodec(stream.Codec));

  const candidate = allImageBased
    ? subtitleStreams.find((stream) => stream.IsDefault) || subtitleStreams.find((stream) => stream.IsForced) || subtitleStreams[0]
    : // Mixed file: the text tracks stay selectable as HLS renditions. A forced
      // IMAGE track still burns in — it carries essential dialogue AVPlayer
      // cannot render at all. A forced TEXT track does not: it renders fine.
      subtitleStreams.find((stream) => stream.IsForced && isImageBasedSubtitleCodec(stream.Codec)) || null;

  if (!candidate) {
    return null;
  }

  // A candidate, not a decision. Callers compute this before the playback mode
  // is chosen, and the on-device engine wins for most of these files now and
  // draws the bitmaps itself, so burn-in never happens. Saying "selected for
  // burn-in" on every localRemux load read as though the server were about to
  // re-encode the picture.
  logger.info("Burn-in candidate (used only if the server path wins)", {
    service: "Subtitles",
    itemId: videoItem.Id,
    streamIndex: candidate.Index,
    codec: candidate.Codec,
    language: candidate.Language || "und",
    isDefault: candidate.IsDefault || false,
    isForced: candidate.IsForced || false,
    imageBased: isImageBasedSubtitleCodec(candidate.Codec),
    totalSubtitles: subtitleStreams.length,
  });

  return candidate;
}

/**
 * Text (non-image) subtitle streams: the ones deliverable to AVPlayer as
 * selectable WebVTT renditions. Image-based tracks are excluded because they
 * can only reach the screen by server-side burn-in (see getBurnInSubtitleStream).
 *
 * Both external sidecars (.srt next to the file) and embedded text streams
 * count. Keying on IsExternal alone used to miss embedded tracks, which left an
 * MP4 carrying one on direct play with nothing on screen unless the codec
 * happened to be mov_text.
 */
export function getTextSubtitleStreams(videoItem: JellyfinVideoItem | null): JellyfinMediaStream[] {
  if (!videoItem || !videoItem.MediaStreams) {
    return [];
  }

  const streams = videoItem.MediaStreams.filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined && !isImageBasedSubtitleCodec(stream.Codec));

  for (const stream of streams) {
    logger.debug("Found text subtitle", {
      service: "Subtitles",
      index: stream.Index,
      label: stream.DisplayTitle || stream.Language || "Unknown",
      language: stream.Language || "und",
      codec: stream.Codec,
      external: stream.IsExternal === true,
    });
  }

  return streams;
}

/**
 * The server's conversion of one subtitle stream. Empty when the config is not loaded yet.
 *
 * Path is `/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}` and the
 * extension is required. Jellyfin sets MediaSourceId to the item id for a single-file item,
 * which is every item the app selects: nothing here picks an alternate version.
 */
export function getRemoteSubtitleUrl(itemId: string, streamIndex: number, format: string = "vtt"): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Videos/${itemId}/${itemId}/Subtitles/${streamIndex}/Stream.${format}?ApiKey=${getCachedConfig().apiKey}`;
}

/** Kept as the name the rest of the app calls. Always the server: see getRemoteSubtitleUrl. */
export const getSubtitleUrl = getRemoteSubtitleUrl;
