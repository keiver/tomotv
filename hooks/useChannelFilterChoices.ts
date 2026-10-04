import { useLiveTvCategories } from "@/hooks/useLiveTvCategories";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useTunerGroups } from "@/hooks/useTunerGroups";
import { t } from "@/services/i18n";
import { lastKnownTunerData } from "@/services/jellyfinApi";
import { activePlaylistGroup, type ChannelFilter, type LiveTvCategory } from "@/services/liveTvPreferences";
import { useMemo } from "react";

export interface ChannelFilterChoice {
  filter: ChannelFilter;
  label: string;
}

export const CATEGORY_LABELS: Record<LiveTvCategory, () => string> = {
  news: () => t("liveTv.catNews"),
  sports: () => t("liveTv.catSports"),
  kids: () => t("liveTv.catKids"),
  movie: () => t("liveTv.catMovies"),
  series: () => t("liveTv.catSeries"),
};

/**
 * All, Favorites, the viewer's groups, the tuner playlists' groups, then the server's non-empty categories.
 * Favorites shows once there is one, or while it is picked; a picked playlist group shows before the groups arrive.
 */
export function useChannelFilterChoices(): ChannelFilterChoice[] {
  const { favorites, groups, filter } = useLiveTvPreferences();
  const categories = useLiveTvCategories();
  const playlistGroups = useTunerGroups();
  return useMemo(() => {
    const choices: ChannelFilterChoice[] = [{ filter: "all", label: t("liveTv.groupAll") }];
    if (favorites.length > 0 || filter === "favorites") choices.push({ filter: "favorites", label: t("library.favorites") });
    for (const group of groups) choices.push({ filter: `group:${group.id}`, label: group.name });
    // The picked group holds its slot until a read of every tuner drops it; a dead pick then resets to All (usePlaylistChannelIds).
    const picked = activePlaylistGroup(filter);
    const unconfirmed = playlistGroups === null || (lastKnownTunerData()?.complete !== true && !playlistGroups.some((group) => group.name === picked));
    if (picked !== null && unconfirmed) choices.push({ filter, label: picked });
    for (const group of playlistGroups ?? []) choices.push({ filter: `playlist:${group.name}`, label: group.name });
    for (const category of categories) choices.push({ filter: `category:${category}`, label: CATEGORY_LABELS[category]() });
    return choices;
  }, [favorites.length, groups, filter, playlistGroups, categories]);
}
