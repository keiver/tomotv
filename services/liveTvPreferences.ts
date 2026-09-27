/**
 * The viewer's live TV choices: how the channels sort, which channels show, whether the wall keeps
 * sampling, the favorites and the named groups. One JSON document in the device's defaults,
 * naming channels by number and name so it outlives any one server.
 */
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const LIVE_TV_PREFERENCES_KEY = "app_live_tv_preferences";

export type ChannelSort = "number" | "name";
/** A listed channel: number and name identify it on any server; the id fetches it without scanning the catalog. */
export interface ChannelFavorite {
  id?: string;
  number?: string;
  name: string;
}
/** The server's channel flags, each set when any programme in the channel's guide carries it. */
export const LIVE_TV_CATEGORIES = ["news", "sports", "kids", "movie", "series"] as const;
export type LiveTvCategory = (typeof LIVE_TV_CATEGORIES)[number];
export interface ChannelGroup {
  id: string;
  name: string;
  channels: ChannelFavorite[];
}
/** Which channels the guide and the wall show. A playlist group is named by its tuner `group-title`. */
export type ChannelFilter = "all" | "favorites" | `category:${LiveTvCategory}` | `group:${string}` | `playlist:${string}`;
/** How long a manual recording (a channel without guide data) runs before it stops itself. */
export const RECORDING_MINUTES_OPTIONS = [30, 45, 60, 120, 180] as const;
export type RecordingMinutes = (typeof RECORDING_MINUTES_OPTIONS)[number];
export interface LiveTvPreferences {
  version: 1;
  autoUpdate: boolean;
  filter: ChannelFilter;
  sort: ChannelSort;
  favorites: ChannelFavorite[];
  groups: ChannelGroup[];
  /** XMLTV URL for channels the server has no guide for (iptv-org/epg output ids); empty is off. */
  guideUrl: string;
  recordingMinutes: RecordingMinutes;
  /** Guide and wall leave out channels whose health check concluded down; unchecked ones stay. */
  hideOffline: boolean;
  /** Bare channels hunt hosted per-country guides for their listings; on unless turned off. */
  autoGuide: boolean;
}
export type ChannelIdentity = Pick<JellyfinItem, "Name" | "ChannelNumber"> & { Id?: string };

export const DEFAULT_LIVE_TV_PREFERENCES: LiveTvPreferences = {
  version: 1,
  autoUpdate: true,
  filter: "all",
  sort: "number",
  favorites: [],
  groups: [],
  guideUrl: "",
  recordingMinutes: 120,
  hideOffline: false,
  autoGuide: true,
};

let current: LiveTvPreferences | null = null;
const listeners = new Set<() => void>();

function parseChannelList(raw: unknown): ChannelFavorite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is ChannelFavorite => !!entry && typeof entry === "object" && typeof entry.name === "string")
    .map((entry) => ({ ...(typeof entry.id === "string" ? { id: entry.id } : {}), ...(typeof entry.number === "string" ? { number: entry.number } : {}), name: entry.name }));
}

function parseGroups(raw: unknown): ChannelGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is ChannelGroup => !!entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.name === "string")
    .map((entry) => ({ id: entry.id, name: entry.name, channels: parseChannelList(entry.channels) }));
}

/** A filter naming a group that no longer exists, or a category the server has no flag for, shows everything. */
function parseFilter(raw: unknown, legacyFavoritesOnly: unknown, groups: readonly ChannelGroup[]): ChannelFilter {
  if (raw === undefined) return legacyFavoritesOnly === true ? "favorites" : "all";
  if (raw === "all" || raw === "favorites") return raw;
  if (typeof raw !== "string") return "all";
  if (raw.startsWith("category:")) {
    const category = raw.slice("category:".length);
    return (LIVE_TV_CATEGORIES as readonly string[]).includes(category) ? (raw as ChannelFilter) : "all";
  }
  if (raw.startsWith("group:")) return groups.some((group) => `group:${group.id}` === raw) ? (raw as ChannelFilter) : "all";
  if (raw.startsWith("playlist:")) return raw.length > "playlist:".length ? (raw as ChannelFilter) : "all";
  return "all";
}

/** A typed guide URL as the loader reads it: a bare host gets https, since only http(s) survives a relaunch. */
export function normalizeGuideUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Every field falls back to its default on its own, so a document from another build still reads. */
export function parseLiveTvPreferences(raw: unknown): LiveTvPreferences {
  const doc = typeof raw === "string" ? safeParse(raw) : raw;
  const source = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  const groups = parseGroups(source.groups);
  return {
    version: 1,
    autoUpdate: typeof source.autoUpdate === "boolean" ? source.autoUpdate : DEFAULT_LIVE_TV_PREFERENCES.autoUpdate,
    filter: parseFilter(source.filter, source.favoritesOnly, groups),
    sort: source.sort === "name" ? "name" : "number",
    favorites: parseChannelList(source.favorites),
    groups,
    guideUrl: typeof source.guideUrl === "string" && /^https?:\/\//i.test(source.guideUrl) ? source.guideUrl : "",
    recordingMinutes: (RECORDING_MINUTES_OPTIONS as readonly number[]).includes(source.recordingMinutes as number)
      ? (source.recordingMinutes as RecordingMinutes)
      : DEFAULT_LIVE_TV_PREFERENCES.recordingMinutes,
    hideOffline: typeof source.hideOffline === "boolean" ? source.hideOffline : DEFAULT_LIVE_TV_PREFERENCES.hideOffline,
    autoGuide: typeof source.autoGuide === "boolean" ? source.autoGuide : DEFAULT_LIVE_TV_PREFERENCES.autoGuide,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getLiveTvPreferences(): LiveTvPreferences {
  if (!current) current = parseLiveTvPreferences(Settings.get(LIVE_TV_PREFERENCES_KEY));
  return current;
}

export function updateLiveTvPreferences(patch: Partial<Omit<LiveTvPreferences, "version">>): void {
  current = { ...getLiveTvPreferences(), ...patch };
  try {
    Settings.set({ [LIVE_TV_PREFERENCES_KEY]: JSON.stringify(current) });
  } catch (error) {
    logger.warn("Live TV preferences write failed", error, { service: "LiveTvPreferences" });
  }
  for (const listener of listeners) listener();
}

export function subscribeLiveTvPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A channel as a list names it: its id, its number when the source gives one, and its name. */
export function channelFavorite(channel: ChannelIdentity): ChannelFavorite {
  const number = channel.ChannelNumber?.trim();
  return { ...(channel.Id ? { id: channel.Id } : {}), ...(number ? { number } : {}), name: channel.Name };
}

/** The key a list matches by: number and name, never the id, which repeats across servers. */
export function channelListKey(channel: ChannelIdentity): string {
  return favoriteKey(channelFavorite(channel));
}

export function favoriteKey(favorite: ChannelFavorite): string {
  return favorite.number ? `${favorite.number}|${favorite.name}` : favorite.name;
}

function listHas(list: readonly ChannelFavorite[], channel: ChannelIdentity): boolean {
  const key = favoriteKey(channelFavorite(channel));
  return list.some((entry) => favoriteKey(entry) === key);
}

function listToggled(list: readonly ChannelFavorite[], channel: ChannelIdentity): ChannelFavorite[] {
  const key = favoriteKey(channelFavorite(channel));
  return listHas(list, channel) ? list.filter((entry) => favoriteKey(entry) !== key) : list.concat(channelFavorite(channel));
}

export function isFavoriteChannel(preferences: LiveTvPreferences, channel: ChannelIdentity): boolean {
  return listHas(preferences.favorites, channel);
}

export function toggleFavoriteChannel(channel: ChannelIdentity): void {
  updateLiveTvPreferences({ favorites: listToggled(getLiveTvPreferences().favorites, channel) });
}

/** The channels a list names, in the order given. */
export function channelsInList<T extends ChannelIdentity>(list: readonly ChannelFavorite[], channels: readonly T[]): T[] {
  const keys = new Set(list.map(favoriteKey));
  return channels.filter((channel) => keys.has(favoriteKey(channelFavorite(channel))));
}

/** The list the filter holds the channels to: the favorites or a group's channels; null for everything else. */
export function activeChannelList(preferences: Pick<LiveTvPreferences, "filter" | "favorites" | "groups">): ChannelFavorite[] | null {
  if (preferences.filter === "favorites") return preferences.favorites;
  if (preferences.filter.startsWith("group:")) return preferences.groups.find((group) => `group:${group.id}` === preferences.filter)?.channels ?? null;
  return null;
}

/** The server flag the filter asks for, or null. */
export function activeCategory(filter: ChannelFilter): LiveTvCategory | null {
  return filter.startsWith("category:") ? (filter.slice("category:".length) as LiveTvCategory) : null;
}

/** The playlist group the filter names, or null. */
export function activePlaylistGroup(filter: ChannelFilter): string | null {
  return filter.startsWith("playlist:") ? filter.slice("playlist:".length) : null;
}

export function isChannelInGroup(group: ChannelGroup, channel: ChannelIdentity): boolean {
  return listHas(group.channels, channel);
}

export function toggleChannelInGroup(groupId: string, channel: ChannelIdentity): void {
  const groups = getLiveTvPreferences().groups.map((group) => (group.id === groupId ? { ...group, channels: listToggled(group.channels, channel) } : group));
  updateLiveTvPreferences({ groups });
}

/** A new empty group, returned so the caller can add the channel it was made for. */
export function createGroup(name: string): ChannelGroup {
  const group: ChannelGroup = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), channels: [] };
  updateLiveTvPreferences({ groups: getLiveTvPreferences().groups.concat(group) });
  return group;
}

export function renameGroup(groupId: string, name: string): void {
  updateLiveTvPreferences({ groups: getLiveTvPreferences().groups.map((group) => (group.id === groupId ? { ...group, name: name.trim() } : group)) });
}

/** Deleting the group on screen shows everything again. */
export function deleteGroup(groupId: string): void {
  const preferences = getLiveTvPreferences();
  updateLiveTvPreferences({
    groups: preferences.groups.filter((group) => group.id !== groupId),
    ...(preferences.filter === `group:${groupId}` ? { filter: "all" as const } : {}),
  });
}

/** The server's sort for a choice: SortName is its channel order, the number then the name. */
export function channelSortParam(sort: ChannelSort): "SortName" | "Name" {
  return sort === "name" ? "Name" : "SortName";
}
