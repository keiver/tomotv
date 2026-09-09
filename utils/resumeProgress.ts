import { JELLYFIN_TIME } from "@/services/jellyfin/constants";
import { JellyfinVideoItem } from "@/types/jellyfin";

// The native position observer's interval (AudioQueuePlayer.swift), so the last tick of a
// track lands a second short of its end.
const POSITION_TICK_SECONDS = 1;

/**
 * Resume fraction (0-1) for a card's progress bar, or undefined when the card owes none.
 * Played items are excluded: Jellyfin keeps the last position on an item marked watched,
 * which would leave a permanent bar under the checkmark.
 */
export function cardResumeProgress(item: Pick<JellyfinVideoItem, "RunTimeTicks" | "UserData">): number | undefined {
  const positionTicks = item.UserData?.PlaybackPositionTicks ?? 0;
  if (positionTicks <= 0 || item.UserData?.Played) return undefined;
  if (item.RunTimeTicks > 0) return positionTicks / item.RunTimeTicks;
  // Runtime-less kinds (live/strm): the server's own percentage is the only measure.
  const percent = item.UserData?.PlayedPercentage;
  return percent != null ? percent / 100 : undefined;
}

/** Position of the playing track as a 0 to 1 fraction of its runtime. */
export function queueTrackProgress(track: Pick<JellyfinVideoItem, "RunTimeTicks">, positionSeconds: number): number {
  const durationSeconds = (track.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;
  if (durationSeconds <= 0) return 0;
  // Full for the last tick, which is the closest to the end the observer ever reports.
  if (positionSeconds > 0 && durationSeconds - positionSeconds <= POSITION_TICK_SECONDS) return 1;
  return Math.min(Math.max(positionSeconds / durationSeconds, 0), 1);
}
