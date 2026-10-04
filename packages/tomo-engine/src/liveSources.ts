import { Platform } from "react-native";

import { liveSourcesModule } from "./native";

export function isLiveSourcesAvailable(): boolean {
  return Platform.OS === "ios" && !!liveSourcesModule()?.loadGuide;
}

/** What one native load cost: time to first byte and in all, bytes on the wire and inflated, memory around it. */
export interface LoadStats {
  firstByteMs: number;
  totalMs: number;
  workMs: number;
  networkBytes: number;
  inflatedBytes: number;
  footprintBeforeBytes: number;
  peakFootprintBytes: number;
  footprintAfterBytes: number;
}

export interface GuideLoadStats {
  channels: number;
  programmes: number;
}

export interface GuideProgramme {
  /** The XMLTV channel id. */
  channel: string;
  /** Epoch milliseconds. */
  start: number;
  stop: number | null;
  title: string;
  subTitle: string | null;
  desc: string | null;
  categories: string[];
  icon: string | null;
}

export interface GuideChannel {
  id: string;
  displayNames: string[];
  icon: string | null;
}

/**
 * Streams the XMLTV at `url` (http(s) or file) into a native store held to the window. `pool` scopes
 * eviction to its own guides; `maxOpen` 0 leaves closing to the caller, which keeps its own use order.
 */
export async function loadGuide(url: string, windowMs: { from: number; to: number }, pool: "external", maxOpen?: number): Promise<{ token: string; stats: GuideLoadStats | null }> {
  const result = (await liveSourcesModule().loadGuide({ url, from: windowMs.from, to: windowMs.to, pool, ...(maxOpen !== undefined ? { maxOpen } : {}) })) as {
    token?: unknown;
    stats?: { channels?: unknown; programmes?: unknown };
  } | null;
  if (typeof result?.token !== "string") throw new Error("The live source module returned no guide.");
  const stats = result.stats;
  return {
    token: result.token,
    stats: typeof stats?.channels === "number" && typeof stats?.programmes === "number" ? { channels: stats.channels, programmes: stats.programmes } : null,
  };
}

/** The loaded guide's channels in file order, each with its display names. */
export async function guideChannels(token: string): Promise<GuideChannel[]> {
  const channels = (await liveSourcesModule().guideChannels(token)) as unknown;
  return Array.isArray(channels) ? (channels as GuideChannel[]) : [];
}

/** The loaded guide's programmes on the given XMLTV channel ids overlapping the window. */
export async function guideProgrammes(token: string, channelIds: readonly string[], windowMs: { from: number; to: number }): Promise<GuideProgramme[]> {
  const programmes = (await liveSourcesModule().guideProgrammes({ token, channelIds, from: windowMs.from, to: windowMs.to })) as unknown;
  return Array.isArray(programmes) ? (programmes as GuideProgramme[]) : [];
}

export async function closeGuide(token: string): Promise<void> {
  await liveSourcesModule().closeGuide(token);
}

/** The `catchup`, `catchup-source` and `catchup-days` attributes of a playlist header or entry. */
export interface PlaylistCatchup {
  type: string | null;
  source: string | null;
  days: number | null;
}

/** The `#EXTM3U` line's attributes. */
export interface PlaylistHeader {
  /** Guide URLs the header declares (x-tvg-url / url-tvg). */
  tvgUrls: string[];
  tvgShift: number | null;
  catchup: PlaylistCatchup | null;
  attrs: Record<string, string>;
}

export interface PlaylistGroup {
  name: string;
  count: number;
}

/** One playlist entry as M3uParser reads it, stored natively and paged out on request. */
export interface PlaylistEntry {
  name: string;
  url: string;
  /** The raw #EXTINF line. */
  line: string;
  hasExtInf: boolean;
  tvgId: string | null;
  tvgName: string | null;
  tvgLogo: string | null;
  tvgChno: string | null;
  groups: string[];
  tvgShift: number | null;
  radio: boolean;
  catchup: PlaylistCatchup | null;
  /** HTTP headers from #EXTVLCOPT lines and `url|Header=value` suffixes. */
  headers: Record<string, string>;
  kodiProps: Record<string, string>;
  drm: boolean;
  attrs: Record<string, string>;
}

export interface PlaylistLoadStats extends LoadStats {
  entries: number;
  groups: number;
}

/**
 * Streams the M3U at `url` into a native store and resolves its token, header and load stats.
 * Entries are paged with playlistEntries; closePlaylist releases the store.
 */
export async function loadPlaylist(url: string, headers: Record<string, string> = {}): Promise<{ token: string; header: PlaylistHeader; stats: PlaylistLoadStats }> {
  const result = (await liveSourcesModule().loadPlaylist({ url, headers })) as { token?: unknown; header?: PlaylistHeader; stats?: PlaylistLoadStats } | null;
  if (typeof result?.token !== "string" || !result.header || !result.stats) throw new Error("The live source module returned no playlist.");
  return { token: result.token, header: result.header, stats: result.stats };
}

/** The playlist's `group-title` groups in first-seen order, with their entry counts. */
export async function playlistGroups(token: string): Promise<PlaylistGroup[]> {
  const groups = (await liveSourcesModule().playlistGroups(token)) as unknown;
  return Array.isArray(groups) ? (groups as PlaylistGroup[]) : [];
}

/** A page of entries in playlist order, of one group when `group` is given. */
export async function playlistEntries(token: string, page: { offset: number; limit: number; group?: string }): Promise<PlaylistEntry[]> {
  const entries = (await liveSourcesModule().playlistEntries({ token, offset: page.offset, limit: page.limit, ...(page.group !== undefined ? { group: page.group } : {}) })) as unknown;
  return Array.isArray(entries) ? (entries as PlaylistEntry[]) : [];
}

export async function closePlaylist(token: string): Promise<void> {
  await liveSourcesModule().closePlaylist(token);
}
