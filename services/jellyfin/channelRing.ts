import { activeCategory, activeChannelList, activePlaylistGroup, channelSortParam, playlistGroupIds, type LiveTvPreferences } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { fetchChannelOrder, fetchChannelsByIds, fetchListedChannels } from "./liveTv";
import { fetchTunerGroups } from "./tunerGroups";

/** The channels the guide and the wall show for these preferences, in that order: what a flip walks. */
export async function fetchChannelRing(preferences: Pick<LiveTvPreferences, "filter" | "sort" | "favorites" | "groups" | "playlistEdits">): Promise<JellyfinItem[]> {
  const list = activeChannelList(preferences);
  if (list) return fetchListedChannels(list);
  const playlist = activePlaylistGroup(preferences.filter);
  if (playlist !== null) {
    const groups = await fetchTunerGroups();
    return fetchChannelsByIds(playlistGroupIds(groups.find((group) => group.name === playlist)?.channelIds ?? [], preferences.playlistEdits[playlist]));
  }
  const category = activeCategory(preferences.filter);
  return fetchChannelOrder({ sortBy: channelSortParam(preferences.sort), ...(category ? { category } : {}) });
}
