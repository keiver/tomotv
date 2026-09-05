/**
 * Writing per-user item state: favorite and played toggles, plus the no-HTTP played
 * marker the playback reporter uses once the server has already been told.
 *
 * Each write updates the local cache, fires the matching subscriber event so the toggled
 * card repaints in place, then evicts the cached reads the write invalidates.
 */
import { markFavorite } from "@/services/favoritesCache";
import { markPlayed } from "@/services/playedCache";
import { invalidateByPrefix } from "@/services/requestCache";
import { retryWithBackoff } from "@/utils/retry";
import { API_TIMEOUTS } from "./constants";
import { notifyFavoriteChange, notifyPlayedChange } from "./events";
import { invalidateFavoriteReads, invalidatePlayedReads } from "./cacheKeys";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getCachedConfig, getConfig, throwRequestError } from "./session";

/**
 * Record a played-state change without an HTTP call: override map + subscriber repaint,
 * plus dropping cached played/unplayed-filtered listings (a just-finished item must not
 * resurface from a cached "Unplayed" view). Used by the playback reporter, where the
 * server has already been updated by the Stopped report itself.
 */
export function markItemPlayed(itemId: string, played: boolean): void {
  markPlayed(itemId, played);
  notifyPlayedChange(itemId, played);
  if (getCachedConfig().userId) invalidateByPrefix(`filtered:${getCachedConfig().userId}:`);
}

/**
 * Mark or unmark an item as favorite for the current user.
 * POST adds, DELETE removes (same endpoint). Notifies favorite subscribers on success.
 */
export async function setVideoFavorite(itemId: string, favorite: boolean): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  await retryWithBackoff(
    async () => {
      const url = `${config.server}/UserFavoriteItems/${itemId}?userId=${config.userId}`;

      const response = await fetchWithTimeout(
        url,
        {
          method: favorite ? "POST" : "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
        },
        API_TIMEOUTS.NORMAL,
      );

      if (!response.ok) {
        throwRequestError(response, `Failed to ${favorite ? "mark" : "unmark"} favorite: ${response.status}`);
      }
    },
    { maxAttempts: 3 },
  );

  // Keep the favorites cache correct, then let subscribers repaint the toggled card in place.
  markFavorite(itemId, favorite);
  notifyFavoriteChange(itemId, favorite);
  invalidateFavoriteReads(config.userId, itemId);
}

/**
 * Mark or unmark an item as played for the current user.
 * POST adds, DELETE removes (same endpoint). Notifies played subscribers on success.
 * NOTE: DELETE also resets PlaybackPositionTicks — Jellyfin has no "unwatch without
 * clearing resume" path, the same trade-off clearResumePosition already makes.
 */
export async function setVideoPlayed(itemId: string, played: boolean): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  await retryWithBackoff(
    async () => {
      const url = `${config.server}/UserPlayedItems/${itemId}?userId=${config.userId}`;

      const response = await fetchWithTimeout(
        url,
        {
          method: played ? "POST" : "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
        },
        API_TIMEOUTS.NORMAL,
      );

      if (!response.ok) {
        throwRequestError(response, `Failed to ${played ? "mark" : "unmark"} played: ${response.status}`);
      }
    },
    { maxAttempts: 3 },
  );

  // Keep the played overrides correct, then let subscribers repaint the toggled card in place.
  markPlayed(itemId, played);
  notifyPlayedChange(itemId, played);
  invalidatePlayedReads(config.userId, itemId, played);
}
