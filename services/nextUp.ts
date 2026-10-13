import { fetchRecentlyPlayed, fetchRecursiveVideos } from "@/services/jellyfinApi";
import { getPlayedOverrides } from "@/services/playedCache";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

/**
 * Next-up resolution for the Continue Watching row.
 *
 * The resume list only holds items you're PART WAY through: Jellyfin drops an item the moment
 * it crosses the server's MaxResumePct, and never lists one you haven't started. So finishing
 * an episode takes its whole series (or folder) off the row, and the next episode — the thing
 * you actually want to press — is nowhere. This fills that hole by anchoring on the most
 * recently FINISHED item per container and offering the next unplayed one after it.
 *
 * Deliberately not /Shows/NextUp: that endpoint only knows real Series, and homevideos
 * libraries report their episodes as Type "Video" with nothing but a ParentId. The container
 * key here is `SeriesId ?? ParentId`, the same gateless key the binge queue uses, and the
 * candidate list is the same fetchRecursiveVideos call playQueueManager builds queues from,
 * so the card offered is by construction the item the queue would play next.
 */

/** Containers the user dismissed this session (long-press → Remove on a next-up card). */
const dismissedContainers = new Set<string>();

/** The container key both the queue and this module group by. */
export function containerKey(item: JellyfinVideoItem): string | undefined {
  return item.SeriesId ?? item.ParentId;
}

/**
 * Hide a container's next-up card for the rest of the session. There is nothing to clear
 * server-side (the item was never started), so removal is local by definition — the card
 * comes back on next launch, same as it would on any other client.
 */
export function dismissNextUpContainer(containerId: string): void {
  dismissedContainers.add(containerId);
}

/**
 * Drop the dismissed set. Called from clearContentCaches on any credential or server change,
 * alongside every other per-user cache: container ids are the same for every user of a server,
 * so one user's dismissals must not hide another user's next-up cards.
 */
export function clearNextUpDismissals(): void {
  dismissedContainers.clear();
}

/** Played state with this session's overrides applied, so an item finished a minute ago isn't re-offered from a cached list. */
function isPlayed(item: JellyfinVideoItem): boolean {
  const override = getPlayedOverrides().get(item.Id);
  return override ?? !!item.UserData?.Played;
}

/** An item the resume list would already be showing — it owns its own card, we must not duplicate it. */
function isResumable(item: JellyfinVideoItem): boolean {
  return (item.UserData?.PlaybackPositionTicks ?? 0) > 0;
}

/**
 * The first item after the anchor that hasn't been watched. Ordering is fetchRecursiveVideos'
 * SortName ascending, i.e. natural episode/file order — the exact order the binge queue plays.
 * Returns null when the anchor is unknown (item moved or list stale) or the container is finished.
 */
function pickNextAfter(items: JellyfinVideoItem[], anchorId: string): JellyfinVideoItem | null {
  const anchorIndex = items.findIndex((item) => item.Id === anchorId);
  if (anchorIndex < 0) return null;
  for (let i = anchorIndex + 1; i < items.length; i++) {
    const candidate = items[i];
    if (!isPlayed(candidate) && !isResumable(candidate)) return candidate;
  }
  return null;
}

/** A next-up card, with the play that finished the item before it: the time the card ranks by. */
export interface NextUpPick {
  video: JellyfinVideoItem;
  playedAt: string | undefined;
}

/**
 * The row as one list, newest play first: a resume card ranks by its own last play, a next-up
 * card by its anchor's, so the item after the one just finished leads the row. Stable, and a card
 * with no date keeps its place behind the dated ones.
 */
export function byLastPlayed<T extends { video: JellyfinVideoItem; playedAt?: string }>(cards: readonly T[]): T[] {
  const time = (card: T) => {
    const parsed = Date.parse(card.playedAt ?? card.video.UserData?.LastPlayedDate ?? "");
    return Number.isNaN(parsed) ? -Infinity : parsed;
  };
  return [...cards].sort((a, b) => time(b) - time(a));
}

/**
 * Resolve the next-up cards that join the resume cards on the row.
 *
 * @param resumeItems - What the row is already showing. A container with a resumable item
 *   is already represented, so it never gets a second card.
 * @param maxContainers - Cap on containers resolved, and therefore on extra requests. Each
 *   one is a cached fetchRecursiveVideos, normally already warm from building the binge queue.
 */
export async function resolveNextUp(resumeItems: JellyfinVideoItem[], maxContainers = 4): Promise<NextUpPick[]> {
  const recentlyPlayed = await fetchRecentlyPlayed();
  if (!recentlyPlayed || recentlyPlayed.length === 0) return [];

  const represented = new Set<string>();
  for (const item of resumeItems) {
    const key = containerKey(item);
    if (key) represented.add(key);
  }

  // Newest first, one anchor per container: the most recently finished item is the only
  // one that says where in the container the user stopped.
  const anchors: { containerId: string; anchor: JellyfinVideoItem }[] = [];
  const seen = new Set<string>();
  for (const item of recentlyPlayed) {
    const key = containerKey(item);
    if (!key || seen.has(key) || represented.has(key) || dismissedContainers.has(key)) continue;
    seen.add(key);
    anchors.push({ containerId: key, anchor: item });
    if (anchors.length >= maxContainers) break;
  }

  if (anchors.length === 0) return [];

  const picks = await Promise.all(
    anchors.map(async ({ containerId, anchor }) => {
      try {
        // Same call, same cache entry, same ordering as the queue this press will build.
        const siblings = await fetchRecursiveVideos(containerId);
        const next = pickNextAfter(siblings, anchor.Id);
        return next ? { video: next, playedAt: anchor.UserData?.LastPlayedDate } : null;
      } catch (error) {
        // One unreachable container must never sink the row.
        logger.warn("Next-up resolution failed for container", error, { service: "NextUp", containerId });
        return null;
      }
    }),
  );

  const resolved = picks.filter((pick): pick is NextUpPick => pick !== null);

  logger.debug("Next-up resolved", {
    service: "NextUp",
    anchors: anchors.length,
    resolved: resolved.length,
    items: resolved.map(({ video }) => ({ id: video.Id.slice(0, 8), name: video.Name?.slice(0, 24) })),
  });

  return resolved;
}
