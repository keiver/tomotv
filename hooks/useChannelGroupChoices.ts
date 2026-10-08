import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useTunerGroups } from "@/hooks/useTunerGroups";
import { toggleFavoriteChannel } from "@/services/channelFavorites";
import { t } from "@/services/i18n";
import { isChannelInGroup, isChannelInPlaylistGroup, isFavoriteChannel, toggleChannelInGroup, toggleChannelInPlaylistGroup, type ChannelIdentity } from "@/services/liveTvPreferences";

export interface ChannelGroupChoice {
  key: string;
  label: string;
  kind: "favorites" | "group" | "playlist";
  member: boolean;
  toggle: () => void;
}

/** Every group the guide lists that a channel can join, in the guide's order: Favorites, the viewer's groups, the playlist's. */
export function useChannelGroupChoices(channel: ChannelIdentity): ChannelGroupChoice[] {
  const preferences = useLiveTvPreferences();
  const playlistGroups = useTunerGroups();
  const channelId = channel.Id;
  const choices: ChannelGroupChoice[] = [
    { key: "favorites", label: t("library.favorites"), kind: "favorites", member: isFavoriteChannel(preferences, channel), toggle: () => toggleFavoriteChannel(channel) },
    ...preferences.groups.map((group) => ({
      key: `group:${group.id}`,
      label: group.name,
      kind: "group" as const,
      member: isChannelInGroup(group, channel),
      toggle: () => toggleChannelInGroup(group.id, channel),
    })),
  ];
  // Playlist membership is by item id: a channel named without one has none to edit.
  if (channelId) {
    for (const group of playlistGroups ?? []) {
      choices.push({
        key: `playlist:${group.name}`,
        label: group.name,
        kind: "playlist",
        member: isChannelInPlaylistGroup(group.channelIds, preferences.playlistEdits[group.name], channelId),
        toggle: () => toggleChannelInPlaylistGroup(group.name, group.channelIds, channelId),
      });
    }
  }
  return choices;
}
