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
 * Keep the stored payload's position current, whether or not the server took the write.
 *
 * Playback reads a held item off this payload instead of asking the server, so without this
 * a film watched online would resume from wherever it stood the day it was downloaded.
 * Separate from `pendingProgress`, which tracks only what still owes the server a write.
 */
export function recordLocalPosition(itemId: string, positionTicks: number, played: boolean): void {
  const entry = manifestEntry(itemId);
  if (!entry) return;
  patchEntry(itemId, {
    item: { ...entry.item, UserData: { ...entry.item.UserData, PlaybackPositionTicks: Math.round(positionTicks), Played: played } },
  });
}

/**
 * Replay every held position, oldest first. An unreachable server leaves the entry alone and
 * stops the run, so one dead link costs one timeout rather than one per item. A 404 is the
 * other kind of failure: the item is gone, no retry will ever land it, and holding it used to
 * jam every position behind it on every launch for good.
 */
export async function flushOfflinePositions(): Promise<void> {
  const pending = manifestEntries()
    .filter((entry) => entry.pendingProgress)
    .sort((a, b) => (a.pendingProgress?.at ?? 0) - (b.pendingProgress?.at ?? 0));
  if (pending.length === 0) return;

  let dropped = 0;
  for (const entry of pending) {
    const progress = entry.pendingProgress;
    if (!progress) continue;
    const result = await updateUserItemData(entry.itemId, { PlaybackPositionTicks: progress.ticks, Played: progress.played });
    if (result === "unreachable") {
      logger.debug("Offline positions still cannot reach the server", { service: "Downloads", itemId: entry.itemId });
      return;
    }
    if (result === "gone") {
      logger.info("Dropping a held position for an item the server no longer has", { service: "Downloads", itemId: entry.itemId });
      dropped += 1;
    }
    patchEntry(entry.itemId, { pendingProgress: undefined });
  }
  logger.info("Offline resume positions synced", { service: "Downloads", count: pending.length - dropped, dropped });
}
