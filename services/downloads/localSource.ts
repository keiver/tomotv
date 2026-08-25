/**
 * localSource.ts
 *
 * What playback asks the downloads layer: is there a file for this item, and where.
 *
 * Deliberately synchronous and dependency-light. `getVideoStreamUrl` is a synchronous URL
 * builder called from the audio queue and the remux engine, so this reads the manifest already
 * in memory (hydrated at launch by app/_layout.tsx). The one filesystem touch is a stat per
 * lookup, which is what keeps a path from an older container out of the player.
 */

import type { JellyfinVideoItem } from "@/types/jellyfin";
import { manifestEntries, manifestEntry, readyFileUri } from "./manifest";
import { artworkFile, subtitleFile } from "./paths";

/** The downloaded media file, or null when the item is not on disk and complete. */
export function localMediaUri(itemId: string): string | null {
  return readyFileUri(itemId);
}

/**
 * Playback reads this item from disk. There is no link to measure and no tier to declare, so
 * every network-derived decision has to stand down: a session for a held file carries no server
 * URL at all.
 */
export function playsFromDisk(itemId: string): boolean {
  return localMediaUri(itemId) !== null;
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
 * A text subtitle track saved with the download. Text renditions are the one part of a session
 * the engine hands AVPlayer as a URL rather than serving itself, so without this a held file
 * plays with no subtitles at all.
 */
export function localSubtitleUri(itemId: string, streamIndex: number): string | null {
  if (manifestEntry(itemId)?.state !== "ready") return null;
  const file = subtitleFile(itemId, streamIndex);
  return file.exists ? file.uri : null;
}

/**
 * The cached poster. Kept separate from the media check: artwork is fetched as soon as an item
 * is queued, so it is usable while the media is still transferring.
 */
export function localArtworkUri(itemId: string): string | null {
  if (!manifestEntry(itemId)?.artworkUri) return null;
  // Same container rule as the media: the recorded URI is a claim, the file is the answer.
  const file = artworkFile(itemId);
  return file.exists ? file.uri : null;
}
