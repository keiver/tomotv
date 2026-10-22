import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useTunerGroups } from "@/hooks/useTunerGroups";
import { toggleFavoriteChannel } from "@/services/channelFavorites";
import { t } from "@/services/i18n";
import type { TunerGroup } from "@/services/jellyfinApi";
import {
  isChannelInGroup,
  isChannelInPlaylistGroup,
  isFavoriteChannel,
  toggleChannelInGroup,
  toggleChannelInPlaylistGroup,
  type ChannelGroup,
  type ChannelIdentity,
} from "@/services/liveTvPreferences";

export type JoinableGroup =
  | { kind: "favorites"; filter: "favorites"; label: string }
  | { kind: "group"; filter: `group:${string}`; label: string; group: ChannelGroup }
  | { kind: "playlist"; filter: `playlist:${string}`; label: string; group: TunerGroup };

/** The groups a channel can join, in the order the guide and a channel's band both list them: Favorites, the viewer's groups, the playlist's. */
export function joinableGroups(groups: readonly ChannelGroup[], playlistGroups: readonly TunerGroup[] | null): JoinableGroup[] {
  return [
    { kind: "favorites", filter: "favorites", label: t("library.favorites") },
    ...groups.map((group) => ({ kind: "group" as const, filter: `group:${group.id}` as const, label: group.name, group })),
    ...(playlistGroups ?? []).map((group) => ({ kind: "playlist" as const, filter: `playlist:${group.name}` as const, label: group.name, group })),
  ];
}

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
  const channelId = channel.Id;
  const choices: ChannelGroupChoice[] = [];
  for (const entry of joinableGroups(preferences.groups, playlistGroups)) {
    const choice = { key: entry.filter, label: entry.label, kind: entry.kind };
    if (entry.kind === "favorites") {
      choices.push({ ...choice, member: isFavoriteChannel(preferences, channel), toggle: () => toggleFavoriteChannel(channel) });
    } else if (entry.kind === "group") {
      const { group } = entry;
      choices.push({ ...choice, member: isChannelInGroup(group, channel), toggle: () => toggleChannelInGroup(group.id, channel) });
    } else if (channelId) {
      // Playlist membership is by item id: a channel named without one has none to edit.
      const { name, channelIds } = entry.group;
      choices.push({
        ...choice,
        member: isChannelInPlaylistGroup(channelIds, preferences.playlistEdits[name], channelId),
        toggle: () => toggleChannelInPlaylistGroup(name, channelIds, channelId),
      });
    }
  }
  return choices;
}
