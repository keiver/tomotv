import { useCategoryChannelIds } from "@/hooks/useCategoryChannelIds";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useTunerGroups } from "@/hooks/useTunerGroups";
import { t } from "@/services/i18n";
import { lastKnownTunerData } from "@/services/jellyfinApi";
import { activePlaylistGroup, type ChannelFilter } from "@/services/liveTvPreferences";
import { joinableGroups, listedCategories } from "@/utils/channelGroups";
import { useMemo } from "react";

export interface ChannelFilterChoice {
  filter: ChannelFilter;
  label: string;
}

/**
 * All, Favorites, the viewer's groups, the tuner playlists' groups, then the categories holding a channel.
 * Favorites shows once there is one, or while it is picked; a picked playlist group shows before the groups arrive.
 */
export function useChannelFilterChoices(): ChannelFilterChoice[] {
  const { favorites, groups, filter, categoryEdits } = useLiveTvPreferences();
  const categoryIds = useCategoryChannelIds();
  const playlistGroups = useTunerGroups();
  return useMemo(() => {
    const choices: ChannelFilterChoice[] = [{ filter: "all", label: t("liveTv.groupAll") }];
    const showFavorites = favorites.length > 0 || filter === "favorites";
    const joinable = joinableGroups(groups, playlistGroups, listedCategories(categoryIds, categoryEdits));
    for (const group of joinable) {
      if (group.kind !== "favorites" || showFavorites) choices.push({ filter: group.filter, label: group.label });
    }
    // The picked group holds its slot, ahead of the playlist's groups, until a read of every tuner drops it; a dead pick then resets to All (usePlaylistChannelIds).
    const picked = activePlaylistGroup(filter);
    const unconfirmed = playlistGroups === null || (lastKnownTunerData()?.complete !== true && !playlistGroups.some((group) => group.name === picked));
    if (picked !== null && unconfirmed) {
      const firstServerGroup = choices.findIndex((choice) => choice.filter.startsWith("playlist:") || choice.filter.startsWith("category:"));
      choices.splice(firstServerGroup < 0 ? choices.length : firstServerGroup, 0, { filter, label: picked });
    }
    return choices;
  }, [favorites.length, groups, filter, playlistGroups, categoryIds, categoryEdits]);
}
