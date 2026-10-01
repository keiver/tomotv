/**
 * Request-cache key construction and the eviction rules that keep cached reads honest
 * after a user-data write. Kept apart from the read functions themselves so the
 * "what does this write invalidate" decisions live in one place.
 *
 * Leaf module: only requestCache, the folder cache and the event bus. No session dependency:
 * every caller already has the userId in hand at the point it writes.
 */
import { patchFolderCacheItem } from "@/services/folderContentsCache";
import { invalidateByPrefix } from "@/services/requestCache";
import { LibraryFilters } from "@/types/jellyfin";
import { notifyItemRemoved, notifyRecordingsChange, notifyResumeChange } from "./events";

/**
 * Stable cache-key fragment for a LibraryFilters selection. Read functions cache their mapped
 * result keyed by folder + this fragment so a filtered listing never collides with the unfiltered
 * one (or with a differently-filtered one). Ordering is normalized so equivalent selections match.
 */
export function filtersCacheKey(filters?: LibraryFilters): string {
  if (!filters) return "none";
  const parts = [
    filters.favorite ? "fav" : "",
    filters.played ? "played" : "",
    filters.unplayed ? "unplayed" : "",
    filters.shuffle ? "shuffle" : "",
    filters.genres.length ? `g=${[...filters.genres].sort().join("|")}` : "",
    filters.artistIds.length ? `a=${[...filters.artistIds].sort().join(",")}` : "",
    filters.years.length ? `y=${[...filters.years].sort((a, b) => a - b).join(",")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("&") : "none";
}

/**
 * Evict cached reads whose contents change when an item's played / resume position changes:
 * the Continue Watching list, the recently-played anchors the row derives next-up from, that
 * item's own detail, and every listing (each row carries its UserData resume ticks).
 * `positionTicks` is the value the app wrote; omitted when the server decided it (Stopped).
 */
export function invalidateResumeAndItem(userId: string, itemId: string, positionTicks?: number): void {
  if (!userId) return;
  invalidateByPrefix(`resume:${userId}:`);
  invalidateByPrefix(`recentPlayed:${userId}:`);
  invalidateByPrefix(`details:${userId}:${itemId}`);
  invalidateByPrefix(`folder:${userId}:`);
  invalidateByPrefix(`playlist:${userId}:`);
  invalidateByPrefix(`filtered:${userId}:`);
  patchFolderCacheItem(itemId, positionTicks == null ? null : { PlaybackPositionTicks: positionTicks });
  notifyResumeChange(itemId, positionTicks);
}

/**
 * Evict every cached read that could still list a deleted item, then tell visible lists to
 * drop its card and the Continue Watching row to reload.
 */
export function invalidateItemRemoved(userId: string, itemId: string): void {
  if (!userId) return;
  invalidateByPrefix(`resume:${userId}:`);
  invalidateByPrefix(`recentPlayed:${userId}:`);
  invalidateByPrefix(`details:${userId}:${itemId}`);
  invalidateByPrefix(`folder:${userId}:`);
  invalidateByPrefix(`playlist:${userId}:`);
  invalidateByPrefix(`filtered:${userId}:`);
  invalidateByPrefix(`latest:${userId}:`);
  invalidateByPrefix(`recursive:${userId}:`);
  invalidateByPrefix(`recursivesized:${userId}:`);
  invalidateByPrefix(`recursivephotos:${userId}:`);
  invalidateByPrefix(`items:${userId}:`);
  invalidateByPrefix(`playlistAll:${userId}:`);
  invalidateByPrefix(`viewLeaves:${userId}:`);
  invalidateByPrefix(`folderpreview:${userId}:`);
  invalidateByPrefix(`viewcount:${userId}:`);
  invalidateByPrefix(`search:${userId}:`);
  patchFolderCacheItem(itemId, null);
  notifyItemRemoved(itemId);
  notifyResumeChange();
}

/**
 * Evict cached reads whose contents change when a timer write starts or stops a recording:
 * the recordings folders (a first recording creates one) and every listing that could carry
 * the new item, then tell the recordings screens to refetch. `recordingItemId` is the
 * recording an info panel stopped, whose own detail goes stale with the timer.
 */
export function invalidateRecordingReads(userId: string, recordingItemId?: string): void {
  if (!userId) return;
  if (recordingItemId) invalidateByPrefix(`details:${userId}:${recordingItemId}`);
  invalidateByPrefix("recordingFolders:");
  invalidateByPrefix(`folder:${userId}:`);
  invalidateByPrefix(`filtered:${userId}:`);
  invalidateByPrefix(`latest:${userId}:`);
  invalidateByPrefix(`items:${userId}:`);
  invalidateByPrefix(`recursive:${userId}:`);
  notifyRecordingsChange();
}

/**
 * Evict cached reads whose contents change when an item's favorite state changes: that item's
 * detail, plus every browse and play-queue set (favorite-filtered listings add/drop the item).
 * Hearts on the unfiltered browse repaint from favoritesCache, so those need no refetch.
 */
export function invalidateFavoriteReads(userId: string, itemId: string): void {
  if (!userId) return;
  invalidateByPrefix(`details:${userId}:${itemId}`);
  invalidateByPrefix(`folder:${userId}:`);
  invalidateByPrefix(`filtered:${userId}:`);
}

/**
 * Evict cached reads whose contents change when an item's played state changes. Marking moves
 * the resume point too: DELETE /UserPlayedItems resets it to 0, POST leaves it to the server.
 */
export function invalidatePlayedReads(userId: string, itemId: string, played: boolean): void {
  if (!userId) return;
  invalidateResumeAndItem(userId, itemId, played ? undefined : 0);
  // The authoritative played set backing the library-root browse (fetchViewRootFiltered).
  invalidateByPrefix(`playedIds:${userId}`);
}
