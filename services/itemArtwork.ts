/**
 * One rule for an item's picture: the server poster where the library has one, else the
 * keyframe the engine has made for it, else nothing. Every surface that shows an item
 * reads it from here, so the grid, the hero, the Up Next card and Now Playing agree.
 */
import { STANDALONE_VIDEO_TYPES } from "@/services/jellyfin/constants";
import { getCachedConfig, getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { posterFrameGeneration, posterFrameIfCached, posterFrameRevision } from "@/services/localRemux";
import { getUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/** The kinds the engine can open for a frame; photos, audio and folders never ask. */
const POSTER_FRAME_TYPES = new Set<string>([...STANDALONE_VIDEO_TYPES, "Episode", "Recording"]);

/** Which server a picture answers for. Ids repeat across servers, expo-image's disk cache
 *  outlives the process, and the generation below is process state that opens at zero. */
function serverTag(): string {
  const server = getCachedConfig().server;
  let hash = 0;
  for (let index = 0; index < server.length; index += 1) hash = (hash * 31 + server.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

/** What the rule reads off an item; every list, detail and queue item carries these. */
export type PosterItem = Pick<JellyfinVideoItem, "Id" | "Type" | "ImageTags" | "MediaStreams"> & { RunTimeTicks?: number; ChannelId?: string };

/**
 * True only where the streams prove there is no picture to grab: a MusicVideo row that is
 * really an audio file. Absent or empty streams answer false, so an item fetched without
 * them keeps asking.
 */
function audioOnly(item: Pick<JellyfinVideoItem, "MediaStreams">): boolean {
  const streams = item.MediaStreams;
  if (!Array.isArray(streams) || streams.length === 0) return false;
  return !streams.some((stream) => stream.Type === "Video");
}

/**
 * An item the engine should make a keyframe for: a video the server left without a poster,
 * while Settings shows device generated posters. An audio-only file is excluded, or every card
 * for one opens the file over HTTP and probes it for a video stream it does not have, three
 * times a launch (POSTER_FRAME_ATTEMPTS).
 */
export function wantsPosterFrame(item: Pick<JellyfinVideoItem, "Type" | "ImageTags" | "MediaStreams">): boolean {
  return getUiPreferences().devicePosters && !hasPoster(item) && POSTER_FRAME_TYPES.has(item.Type) && !audioOnly(item);
}

export interface PosterSource {
  uri: string;
  cacheKey: string;
}

/**
 * The picture as expo-image takes it, keyed for the cache by item and image tag so a
 * changed server image invalidates and a token change does not. `frame` is a keyframe the
 * caller already holds; without it the engine's settled answer is used.
 */
export function posterSource(item: PosterItem, height: number, frame?: string | null, revision: number = posterFrameRevision(item.Id)): PosterSource | undefined {
  if (hasPoster(item)) return serverPoster(item.Id, item.ImageTags?.Primary, height);
  // A programme found by search wears its channel's logo.
  if (item.Type === "Program" && item.ChannelId) return serverPoster(item.ChannelId, "channel", height);
  if (!getUiPreferences().devicePosters) return undefined;
  const keyframe = frame ?? posterFrameIfCached(item.Id);
  // The pool path repeats across servers and across a decode, so the server, the generation and
  // the revision are what part one picture from the next.
  return keyframe ? { uri: keyframe, cacheKey: `${serverTag()}-${item.Id}-keyframe-${posterFrameGeneration()}.${revision}` } : undefined;
}

/** The server's Primary image keyed by its tag, so a replaced image misses expo-image's cache. */
export function serverPoster(itemId: string, tag: string | undefined, height: number): PosterSource | undefined {
  const uri = getPosterUrl(itemId, height);
  return uri ? { uri, cacheKey: `${serverTag()}-${itemId}-${tag}-${height}` } : undefined;
}

export type FolderPosterItem = Pick<JellyfinVideoItem, "Id" | "ImageTags" | "SeriesId" | "SeriesPrimaryImageTag">;

/** What the server gives a folder: its own poster, else for a season the series poster. */
export function folderPosterSource(folder: FolderPosterItem, height: number): PosterSource | undefined {
  if (hasPoster(folder)) return serverPoster(folder.Id, folder.ImageTags?.Primary, height);
  if (folder.SeriesId && folder.SeriesPrimaryImageTag) return serverPoster(folder.SeriesId, folder.SeriesPrimaryImageTag, height);
  return undefined;
}

/** The picture's URL alone, for consumers that take a string. */
export function posterUri(item: PosterItem, height: number, frame?: string | null): string | null {
  return posterSource(item, height, frame)?.uri ?? null;
}

const HERO_MAX_UPSCALE = 3;

/**
 * The info hero's art at its own ratio inside a fixed `width` x `area`: a taller picture full width, its foot
 * past the area; a wider one covers the area, sides cropped. A logo stays whole; a tiny one stops at 3x.
 */
export function heroArtFrame(width: number, area: number, imageWidth: number, imageHeight: number, logo = false): { width: number; height: number } {
  if (imageWidth * HERO_MAX_UPSCALE < width && imageWidth >= imageHeight) {
    const scale = Math.min(HERO_MAX_UPSCALE, area / imageHeight);
    return { width: imageWidth * scale, height: imageHeight * scale };
  }
  const height = (width * imageHeight) / imageWidth;
  if (height < area && !logo) return { width: (area * imageWidth) / imageHeight, height: area };
  return { width, height };
}
