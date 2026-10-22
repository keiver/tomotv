import { useCategoryChannelIds } from "@/hooks/useCategoryChannelIds";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useTunerGroups } from "@/hooks/useTunerGroups";
import { toggleFavoriteChannel } from "@/services/channelFavorites";
import {
  isChannelInGroup,
  isChannelInPlaylistGroup,
  isFavoriteChannel,
  toggleChannelInCategory,
  toggleChannelInGroup,
  toggleChannelInPlaylistGroup,
  type ChannelIdentity,
} from "@/services/liveTvPreferences";
import { joinableGroups, listedCategories, type JoinableGroup } from "@/utils/channelGroups";

export interface ChannelGroupChoice {
  key: string;
  label: string;
  kind: JoinableGroup["kind"];
  member: boolean;
  toggle: () => void;
}

/** Every group the guide lists that a channel can join, with the channel's membership of each. */
export function useChannelGroupChoices(channel: ChannelIdentity): ChannelGroupChoice[] {
  const preferences = useLiveTvPreferences();
  const playlistGroups = useTunerGroups();
  const categoryIds = useCategoryChannelIds();
  const channelId = channel.Id;
  const choices: ChannelGroupChoice[] = [];
  for (const entry of joinableGroups(preferences.groups, playlistGroups, listedCategories(categoryIds, preferences.categoryEdits))) {
    const choice = { key: entry.filter, label: entry.label, kind: entry.kind };
    if (entry.kind === "favorites") {
      choices.push({ ...choice, member: isFavoriteChannel(preferences, channel), toggle: () => toggleFavoriteChannel(channel) });
    } else if (entry.kind === "group") {
      const { group } = entry;
      choices.push({ ...choice, member: isChannelInGroup(group, channel), toggle: () => toggleChannelInGroup(group.id, channel) });
    } else if (!channelId) {
      // Playlist and category membership is by item id: a channel named without one has none to edit.
      continue;
    } else if (entry.kind === "playlist") {
      const { name, channelIds } = entry.group;
      choices.push({
        ...choice,
        member: isChannelInPlaylistGroup(channelIds, preferences.playlistEdits[name], channelId),
        toggle: () => toggleChannelInPlaylistGroup(name, channelIds, channelId),
      });
    } else {
      const { category } = entry;
      const serverIds = categoryIds[category];
      // Listed from the viewer's edits before the server's ids arrive: no cell until membership can be read.
      if (!serverIds) continue;
      choices.push({
        ...choice,
        member: isChannelInPlaylistGroup(serverIds, preferences.categoryEdits[category], channelId),
        toggle: () => toggleChannelInCategory(category, serverIds, channelId),
      });
    }
  }
  return choices;
}
