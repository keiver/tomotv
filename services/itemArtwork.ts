/**
 * One rule for an item's picture: the server poster where the library has one, else the
 * keyframe the engine has made for it, else nothing. Every surface that shows an item
 * reads it from here, so the grid, the hero, the Up Next card and Now Playing agree.
 */
import { STANDALONE_VIDEO_TYPES } from "@/services/jellyfin/constants";
import { getCachedConfig, getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { posterFrameGeneration, posterFrameIfCached, posterFrameRevision } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/** The kinds the engine can open for a frame; photos, audio and folders never ask. */
const POSTER_FRAME_TYPES = new Set<string>([...STANDALONE_VIDEO_TYPES, "Episode"]);

/** Which server a picture answers for. Ids repeat across servers, expo-image's disk cache
 *  outlives the process, and the generation below is process state that opens at zero. */
function serverTag(): string {
  const server = getCachedConfig().server;
  let hash = 0;
  for (let index = 0; index < server.length; index += 1) hash = (hash * 31 + server.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

/** What the rule reads off an item; every list, detail and queue item carries these. */
export type PosterItem = Pick<JellyfinVideoItem, "Id" | "Type" | "ImageTags"> & { RunTimeTicks?: number };

/** An item the engine should make a keyframe for: a video the server left without a poster. */
export function wantsPosterFrame(item: Pick<JellyfinVideoItem, "Type" | "ImageTags">): boolean {
  return !hasPoster(item) && POSTER_FRAME_TYPES.has(item.Type);
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
  const keyframe = frame ?? posterFrameIfCached(item.Id);
  // The pool path repeats across servers and across a decode, so the server, the generation and
  // the revision are what part one picture from the next.
  return keyframe ? { uri: keyframe, cacheKey: `${serverTag()}-${item.Id}-keyframe-${posterFrameGeneration()}.${revision}` } : undefined;
}

function serverPoster(itemId: string, tag: string | undefined, height: number): PosterSource | undefined {
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
