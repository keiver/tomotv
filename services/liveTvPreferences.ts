/**
 * The viewer's live TV choices: how the channels sort, whether only favorites show, whether the
 * wall keeps sampling, and the favorites themselves. One JSON document in the device's defaults,
 * naming channels by number and name so it outlives any one server.
 */
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const LIVE_TV_PREFERENCES_KEY = "app_live_tv_preferences";

export type ChannelSort = "number" | "name";
export interface ChannelFavorite {
  number?: string;
  name: string;
}
export interface LiveTvPreferences {
  version: 1;
  autoUpdate: boolean;
  favoritesOnly: boolean;
  sort: ChannelSort;
  favorites: ChannelFavorite[];
}
export type ChannelIdentity = Pick<JellyfinItem, "Name" | "ChannelNumber">;

export const DEFAULT_LIVE_TV_PREFERENCES: LiveTvPreferences = { version: 1, autoUpdate: true, favoritesOnly: false, sort: "number", favorites: [] };

let current: LiveTvPreferences | null = null;
const listeners = new Set<() => void>();

/** Every field falls back to its default on its own, so a document from another build still reads. */
export function parseLiveTvPreferences(raw: unknown): LiveTvPreferences {
  const doc = typeof raw === "string" ? safeParse(raw) : raw;
  const source = doc && typeof doc === "object" ? (doc as Partial<LiveTvPreferences>) : {};
  const favorites = Array.isArray(source.favorites)
    ? source.favorites
        .filter((entry): entry is ChannelFavorite => !!entry && typeof entry === "object" && typeof entry.name === "string")
        .map((entry) => ({ ...(typeof entry.number === "string" ? { number: entry.number } : {}), name: entry.name }))
    : [];
  return {
    version: 1,
    autoUpdate: typeof source.autoUpdate === "boolean" ? source.autoUpdate : DEFAULT_LIVE_TV_PREFERENCES.autoUpdate,
    favoritesOnly: typeof source.favoritesOnly === "boolean" ? source.favoritesOnly : DEFAULT_LIVE_TV_PREFERENCES.favoritesOnly,
    sort: source.sort === "name" ? "name" : "number",
    favorites,
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

/** A channel as a favorite names it: its number when the source gives one, and its name. */
export function channelFavorite(channel: ChannelIdentity): ChannelFavorite {
  const number = channel.ChannelNumber?.trim();
  return number ? { number, name: channel.Name } : { name: channel.Name };
}

function favoriteKey(favorite: ChannelFavorite): string {
  return favorite.number ? `${favorite.number}|${favorite.name}` : favorite.name;
}

export function isFavoriteChannel(preferences: LiveTvPreferences, channel: ChannelIdentity): boolean {
  const key = favoriteKey(channelFavorite(channel));
  return preferences.favorites.some((favorite) => favoriteKey(favorite) === key);
}

export function toggleFavoriteChannel(channel: ChannelIdentity): void {
  const preferences = getLiveTvPreferences();
  const key = favoriteKey(channelFavorite(channel));
  const favorites = isFavoriteChannel(preferences, channel) ? preferences.favorites.filter((favorite) => favoriteKey(favorite) !== key) : preferences.favorites.concat(channelFavorite(channel));
  updateLiveTvPreferences({ favorites });
}

/** The channels the favorites name, in the order given. */
export function favoriteChannels<T extends ChannelIdentity>(preferences: Pick<LiveTvPreferences, "favorites">, channels: readonly T[]): T[] {
  const keys = new Set(preferences.favorites.map(favoriteKey));
  return channels.filter((channel) => keys.has(favoriteKey(channelFavorite(channel))));
}

/** The server's sort for a choice: SortName is its channel order, the number then the name. */
export function channelSortParam(sort: ChannelSort): "SortName" | "Name" {
  return sort === "name" ? "Name" : "SortName";
}
