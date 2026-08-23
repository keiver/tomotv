/**
 * localSource.ts
 *
 * What playback asks the downloads layer: is there a file for this item, and where.
 *
 * Deliberately synchronous and dependency-light. `getVideoStreamUrl` is a synchronous URL
 * builder called from the audio queue and the remux engine, so this reads the manifest already
 * in memory (hydrated at launch by app/_layout.tsx) rather than touching the filesystem.
 */

import type { JellyfinVideoItem } from "@/types/jellyfin";
import { manifestEntries, manifestEntry, readyFileUri } from "./manifest";

/** The downloaded media file, or null when the item is not on disk and complete. */
export function localMediaUri(itemId: string): string | null {
  return readyFileUri(itemId);
}

/**
 * The item payload stored when it was downloaded, for a completed download only. It is what
 * `/Items/{id}/PlaybackInfo` and `/Items/{id}` returned at the time, so playback can run on it
 * when the server cannot be reached.
 */
export function downloadedItem(itemId: string): JellyfinVideoItem | null {
  const entry = manifestEntry(itemId);
  return entry?.state === "ready" ? entry.item : null;
}

/** Everything playable offline, newest request first. The Downloads screen's whole list. */
export function downloadedItems(): JellyfinVideoItem[] {
  return manifestEntries()
    .filter((entry) => entry.state === "ready")
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((entry) => entry.item);
}

/**
 * The cached poster. Kept separate from the media check: artwork is fetched as soon as an item
 * is queued, so it is usable while the media is still transferring.
 */
export function localArtworkUri(itemId: string): string | null {
  return manifestEntry(itemId)?.artworkUri ?? null;
}
