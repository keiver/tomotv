import { useChannels } from "@/hooks/useChannels";
import { useHealthGeneration } from "@/hooks/useChannelHealth";
import { usePlaylistChannelIds } from "@/hooks/useTunerGroups";
import { healthFor } from "@/services/channelHealth";
import { activeCategory, activeChannelList, type LiveTvPreferences } from "@/services/liveTvPreferences";
import { useMemo } from "react";

/** The Channels wall's list: the picked group's channels in its order, those judged offline left out under Hide offline. */
export function useChannelWall(preferences: LiveTvPreferences) {
  const playlistIds = usePlaylistChannelIds(preferences.filter);
  const category = activeCategory(preferences.filter);
  const channels = useChannels(preferences.sort, category, activeChannelList(preferences), playlistIds, category ? preferences.categoryEdits[category] : undefined);
  const healthGen = useHealthGeneration(preferences.hideOffline);
  const { items } = channels;
  const wall = useMemo(
    () => (preferences.hideOffline ? items.filter((channel) => healthFor(channel.Id) !== "down") : items),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthGen re-filters when any verdict moves
    [items, preferences.hideOffline, healthGen],
  );
  return { ...channels, wall };
}
