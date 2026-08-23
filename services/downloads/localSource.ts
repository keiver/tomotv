/**
 * localSource.ts
 *
 * What playback asks the downloads layer: is there a file for this item, and where.
 *
 * Deliberately synchronous and dependency-light. `getVideoStreamUrl` is a synchronous URL
 * builder called from the audio queue and the remux engine, so this reads the manifest already
 * in memory (hydrated at launch by app/_layout.tsx) rather than touching the filesystem.
 */

import { manifestEntry, readyFileUri } from "./manifest";

/** The downloaded media file, or null when the item is not on disk and complete. */
export function localMediaUri(itemId: string): string | null {
  return readyFileUri(itemId);
}

/**
 * The cached poster. Kept separate from the media check: artwork is fetched as soon as an item
 * is queued, so it is usable while the media is still transferring.
 */
export function localArtworkUri(itemId: string): string | null {
  return manifestEntry(itemId)?.artworkUri ?? null;
}
