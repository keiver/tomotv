import { activeCategory, activeChannelList, activePlaylistGroup, channelSortParam, playlistGroupIds, type LiveTvPreferences } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { fetchChannelOrder, fetchChannelsByIds, fetchListedChannels } from "./liveTv";
import { fetchTunerGroups } from "./tunerGroups";

/** The channels the guide and the wall show for these preferences, in that order: what a flip walks. */
export async function fetchChannelRing(preferences: Pick<LiveTvPreferences, "filter" | "sort" | "favorites" | "groups" | "playlistEdits" | "categoryEdits">): Promise<JellyfinItem[]> {
  const list = activeChannelList(preferences);
  if (list) return fetchListedChannels(list);
  const playlist = activePlaylistGroup(preferences.filter);
  if (playlist !== null) {
    const groups = await fetchTunerGroups();
    return fetchChannelsByIds(playlistGroupIds(groups.find((group) => group.name === playlist)?.channelIds ?? [], preferences.playlistEdits[playlist]));
  }
  const category = activeCategory(preferences.filter);
  const lineup = await fetchChannelOrder({ sortBy: channelSortParam(preferences.sort), ...(category ? { category } : {}) });
  if (!category) return lineup;
  const byId = new Map(lineup.map((channel) => [channel.Id, channel]));
  const ids = playlistGroupIds(
    lineup.map((channel) => channel.Id),
    preferences.categoryEdits[category],
  );
  // Channels the viewer added are read by id: a flip names its neighbour.
  for (const channel of await fetchChannelsByIds(ids.filter((id) => !byId.has(id)))) byId.set(channel.Id, channel);
  return ids.flatMap((id) => byId.get(id) ?? []);
}
