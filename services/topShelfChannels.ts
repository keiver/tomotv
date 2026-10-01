/**
 * The Apple TV Top Shelf's live channel row. The extension cannot read the app's defaults, so the
 * channels the shelf shows are written to the keychain it already reads its credentials from.
 */
import { CATEGORY_LABELS } from "@/hooks/useChannelFilterChoices";
import { t } from "@/services/i18n";
import { fetchChannelCategories, fetchChannels, fetchChannelsByIds, fetchListedChannels, getConfig, lastKnownTunerData, subscribeAuthChange } from "@/services/jellyfinApi";
import { getLiveTvAvailability, subscribeLiveTvAvailability } from "@/services/liveTvAvailability";
import {
  activePlaylistGroup,
  channelSortParam,
  getLiveTvPreferences,
  subscribeLiveTvPreferences,
  type ChannelFavorite,
  type LiveTvCategory,
  type LiveTvPreferences,
} from "@/services/liveTvPreferences";
import type { TunerGroup } from "@/services/liveSources";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";

export const TOP_SHELF_CHANNELS_KEY = "topshelf_live_channels";
export const TOP_SHELF_CHANNEL_LIMIT = 10;
/** Preference edits arrive in bursts (a favorite toggled, a group renamed); one write follows them. */
const SYNC_DEBOUNCE_MS = 1_500;

export type TopShelfSource =
  | { kind: "list"; title: string; list: ChannelFavorite[] }
  | { kind: "ids"; title: string; ids: string[] }
  | { kind: "category"; title: string; category: LiveTvCategory }
  | { kind: "all"; title: string };

/** The picked channel filter when it has channels, else Favorites, Movies, then every channel. */
export function topShelfSource(
  preferences: Pick<LiveTvPreferences, "filter" | "favorites" | "groups">,
  categories: readonly LiveTvCategory[],
  playlistGroups: readonly TunerGroup[] | null,
): TopShelfSource {
  const { filter, favorites, groups } = preferences;
  if (filter === "favorites" && favorites.length > 0) return { kind: "list", title: t("library.favorites"), list: favorites };
  if (filter.startsWith("group:")) {
    const group = groups.find((entry) => `group:${entry.id}` === filter);
    if (group && group.channels.length > 0) return { kind: "list", title: group.name, list: group.channels };
  }
  const playlist = activePlaylistGroup(filter);
  if (playlist !== null) {
    const group = playlistGroups?.find((entry) => entry.name === playlist);
    if (group && group.channelIds.length > 0) return { kind: "ids", title: group.name, ids: group.channelIds };
  }
  if (filter.startsWith("category:")) {
    const category = filter.slice("category:".length) as LiveTvCategory;
    if (categories.includes(category)) return { kind: "category", title: CATEGORY_LABELS[category](), category };
  }
  if (favorites.length > 0) return { kind: "list", title: t("library.favorites"), list: favorites };
  if (categories.includes("movie")) return { kind: "category", title: CATEGORY_LABELS.movie(), category: "movie" };
  return { kind: "all", title: t("liveTv.title") };
}

async function sourceChannelIds(source: TopShelfSource, preferences: LiveTvPreferences): Promise<string[]> {
  const sortBy = channelSortParam(preferences.sort);
  switch (source.kind) {
    case "list":
      return (await fetchListedChannels(source.list.slice(0, TOP_SHELF_CHANNEL_LIMIT))).map((channel) => channel.Id);
    case "ids":
      return (await fetchChannelsByIds(source.ids.slice(0, TOP_SHELF_CHANNEL_LIMIT))).map((channel) => channel.Id);
    case "category":
      return (await fetchChannels({ limit: TOP_SHELF_CHANNEL_LIMIT, sortBy, category: source.category })).items.map((channel) => channel.Id);
    case "all":
      return (await fetchChannels({ limit: TOP_SHELF_CHANNEL_LIMIT, sortBy })).items.map((channel) => channel.Id);
  }
}

/** What the keychain holds; undefined until read once, so a launch that changes nothing reloads nothing. */
let lastWritten: string | null | undefined;

async function write(value: string | null): Promise<void> {
  if (lastWritten === undefined) lastWritten = await SecureStore.getItemAsync(TOP_SHELF_CHANNELS_KEY);
  if (value === lastWritten) return;
  if (value === null) await SecureStore.deleteItemAsync(TOP_SHELF_CHANNELS_KEY);
  else await SecureStore.setItemAsync(TOP_SHELF_CHANNELS_KEY, value);
  lastWritten = value;
  NativeModules.TopShelfReload?.contentDidChange();
}

export async function syncTopShelfChannels(): Promise<void> {
  const config = await getConfig();
  if (!config.server || !config.userId || !getLiveTvAvailability()) {
    await write(null);
    return;
  }
  const preferences = getLiveTvPreferences();
  // A picked playlist group is unknown until the tuners are read: the row written last stands until then.
  if (activePlaylistGroup(preferences.filter) !== null && lastKnownTunerData() === null) return;
  const categories = await fetchChannelCategories().catch(() => [] as LiveTvCategory[]);
  const source = topShelfSource(preferences, categories, lastKnownTunerData()?.groups ?? null);
  const ids = (await sourceChannelIds(source, preferences)).slice(0, TOP_SHELF_CHANNEL_LIMIT);
  await write(ids.length > 0 ? JSON.stringify({ server: config.server, userId: config.userId, title: source.title, ids }) : null);
}

let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncTopShelfChannels().catch((error) => logger.warn("Top Shelf channels sync failed", error, { service: "TopShelfChannels" }));
  }, SYNC_DEBOUNCE_MS);
}

/** The preferences the row reads; edits to any other (sort aside) fetch nothing. */
function rowInputs(): string {
  const { filter, favorites, groups, sort } = getLiveTvPreferences();
  return JSON.stringify([filter, favorites, groups, sort]);
}

/** Apple TV only: keeps the row in step with the channel filter, sign-ins and Live TV availability. */
export function startTopShelfChannelSync(): void {
  if (!Platform.isTV) return;
  let inputs = rowInputs();
  subscribeLiveTvPreferences(() => {
    const next = rowInputs();
    if (next === inputs) return;
    inputs = next;
    schedule();
  });
  subscribeLiveTvAvailability(schedule);
  subscribeAuthChange(schedule);
  schedule();
}
