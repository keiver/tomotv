import { t } from "@/services/i18n";
import type { TunerGroup } from "@/services/jellyfinApi";
import { LIVE_TV_CATEGORIES, type ChannelGroup, type LiveTvCategory, type PlaylistEdit } from "@/services/liveTvPreferences";

export const CATEGORY_LABELS: Record<LiveTvCategory, () => string> = {
  news: () => t("liveTv.catNews"),
  sports: () => t("liveTv.catSports"),
  kids: () => t("liveTv.catKids"),
  movie: () => t("liveTv.catMovies"),
  series: () => t("liveTv.catSeries"),
};

export type JoinableGroup =
  | { kind: "favorites"; filter: "favorites"; label: string }
  | { kind: "group"; filter: `group:${string}`; label: string; group: ChannelGroup }
  | { kind: "playlist"; filter: `playlist:${string}`; label: string; group: TunerGroup }
  | { kind: "category"; filter: `category:${LiveTvCategory}`; label: string; category: LiveTvCategory };

/** The categories the server or the viewer put a channel in; one the viewer emptied stays, so it can be filled again. */
export function listedCategories(serverIds: Partial<Record<LiveTvCategory, readonly string[]>>, edits: Partial<Record<LiveTvCategory, PlaylistEdit>>): LiveTvCategory[] {
  return LIVE_TV_CATEGORIES.filter((category) => (serverIds[category]?.length ?? 0) > 0 || (edits[category]?.added.length ?? 0) > 0);
}

/** The groups a channel can join, in the order the guide and a channel's band both list them: Favorites, the viewer's groups, the playlist's, the categories. */
export function joinableGroups(groups: readonly ChannelGroup[], playlistGroups: readonly TunerGroup[] | null, categories: readonly LiveTvCategory[]): JoinableGroup[] {
  return [
    { kind: "favorites", filter: "favorites", label: t("library.favorites") },
    ...groups.map((group) => ({ kind: "group" as const, filter: `group:${group.id}` as const, label: group.name, group })),
    ...(playlistGroups ?? []).map((group) => ({ kind: "playlist" as const, filter: `playlist:${group.name}` as const, label: group.name, group })),
    ...categories.map((category) => ({ kind: "category" as const, filter: `category:${category}` as const, label: CATEGORY_LABELS[category](), category })),
  ];
}
