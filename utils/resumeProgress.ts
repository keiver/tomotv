import { JellyfinVideoItem } from "@/types/jellyfin";

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
