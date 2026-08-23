/**
 * offlineProgress.ts
 *
 * Resume positions for downloaded items played with no server to tell.
 *
 * Jellyfin owns resume state, so a track finished on the train would otherwise start over at
 * home. When a UserData write fails and the item is one of ours, the position is kept in the
 * manifest entry and replayed on the next foreground that reaches the server. Only downloads
 * are recorded: an item that was streaming had a server a moment ago, and its failure is a
 * blip rather than an offline session.
 */

import { updateUserItemData } from "@/services/jellyfin/playback";
import { logger } from "@/utils/logger";
import { manifestEntries, manifestEntry, patchEntry } from "./manifest";

/** Keep the newest position for an item; the server only stores one anyway. */
export function recordOfflinePosition(itemId: string, positionTicks: number, played: boolean): void {
  if (!manifestEntry(itemId)) return;
  patchEntry(itemId, { pendingProgress: { ticks: Math.round(positionTicks), played, at: Date.now() } });
}

/**
 * Replay every held position, oldest first. A write that fails leaves its entry alone, so the
 * next flush tries again; there is no attempt counter because the only cause is the server
 * being away, and that resolves on its own.
 */
export async function flushOfflinePositions(): Promise<void> {
  const pending = manifestEntries()
    .filter((entry) => entry.pendingProgress)
    .sort((a, b) => (a.pendingProgress?.at ?? 0) - (b.pendingProgress?.at ?? 0));
  if (pending.length === 0) return;

  for (const entry of pending) {
    const progress = entry.pendingProgress;
    if (!progress) continue;
    const ok = await updateUserItemData(entry.itemId, { PlaybackPositionTicks: progress.ticks, Played: progress.played });
    if (ok === false) {
      logger.debug("Offline positions still cannot reach the server", { service: "Downloads", itemId: entry.itemId });
      return;
    }
    patchEntry(entry.itemId, { pendingProgress: undefined });
  }
  logger.info("Offline resume positions synced", { service: "Downloads", count: pending.length });
}
