/**
 * One rule for an item's picture: the server poster where the library has one, else the
 * keyframe the engine has made for it, else nothing. Every surface that shows an item
 * reads it from here, so the grid, the hero, the Up Next card and Now Playing agree.
 */
import { STANDALONE_VIDEO_TYPES } from "@/services/jellyfin/constants";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { posterFrameIfCached } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/** The kinds the engine can open for a frame; photos, audio and folders never ask. */
const POSTER_FRAME_TYPES = new Set<string>([...STANDALONE_VIDEO_TYPES, "Episode"]);

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
export function posterSource(item: PosterItem, height: number, frame?: string | null): PosterSource | undefined {
  if (hasPoster(item)) return serverPoster(item.Id, item.ImageTags?.Primary, height);
  const keyframe = frame ?? posterFrameIfCached(item.Id);
  return keyframe ? { uri: keyframe, cacheKey: `${item.Id}-keyframe` } : undefined;
}

function serverPoster(itemId: string, tag: string | undefined, height: number): PosterSource | undefined {
  const uri = getPosterUrl(itemId, height);
  return uri ? { uri, cacheKey: `${itemId}-${tag}-${height}` } : undefined;
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
