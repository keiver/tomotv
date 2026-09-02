/**
 * One rule for an item's picture: the server poster where the library has one, else the
 * keyframe the engine has made for it, else nothing. Every surface that shows an item
 * reads it from here, so the grid, the hero, the Up Next card and Now Playing agree.
 */
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { posterFrameIfCached } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/** What the rule reads off an item; every list, detail and queue item carries these. */
export type PosterItem = Pick<JellyfinVideoItem, "Id" | "Type" | "ImageTags"> & { RunTimeTicks?: number };

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
  if (hasPoster(item)) {
    const uri = getPosterUrl(item.Id, height);
    return uri ? { uri, cacheKey: `${item.Id}-${item.ImageTags?.Primary}-${height}` } : undefined;
  }
  const keyframe = frame ?? posterFrameIfCached(item.Id);
  return keyframe ? { uri: keyframe, cacheKey: `${item.Id}-keyframe` } : undefined;
}

/** The picture's URL alone, for consumers that take a string. */
export function posterUri(item: PosterItem, height: number, frame?: string | null): string | null {
  return posterSource(item, height, frame)?.uri ?? null;
}
