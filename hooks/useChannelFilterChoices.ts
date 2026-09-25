import { useLiveTvCategories } from "@/hooks/useLiveTvCategories";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import type { ChannelFilter, LiveTvCategory } from "@/services/liveTvPreferences";
import { useMemo } from "react";

export interface ChannelFilterChoice {
  filter: ChannelFilter;
  label: string;
}

const CATEGORY_LABELS: Record<LiveTvCategory, () => string> = {
  news: () => t("liveTv.catNews"),
  sports: () => t("liveTv.catSports"),
  kids: () => t("liveTv.catKids"),
  movie: () => t("liveTv.catMovies"),
  series: () => t("liveTv.catSeries"),
};

/** Favorites, All, the viewer's groups, then the server's non-empty categories. Favorites shows once there is one, or while it is picked. */
export function useChannelFilterChoices(): ChannelFilterChoice[] {
  const { favorites, groups, filter } = useLiveTvPreferences();
  const categories = useLiveTvCategories();
  return useMemo(() => {
    const choices: ChannelFilterChoice[] = [];
    if (favorites.length > 0 || filter === "favorites") choices.push({ filter: "favorites", label: t("library.favorites") });
    choices.push({ filter: "all", label: t("liveTv.groupAll") });
    for (const group of groups) choices.push({ filter: `group:${group.id}`, label: group.name });
    for (const category of categories) choices.push({ filter: `category:${category}`, label: CATEGORY_LABELS[category]() });
    return choices;
  }, [favorites.length, groups, filter, categories]);
}
