/**
 * liveSources.ts
 *
 * Service for the on-device live source module (native/ios/LiveSources): XMLTV guides and M3U
 * playlists parsed natively. Tomo reads a Jellyfin tuner's playlist groups and channel tvg-ids
 * through it, and loads external XMLTV guides into a native store queried by time window.
 */
import { NativeModules, Platform } from "react-native";

const { LiveSources } = NativeModules;

export interface TunerGroup {
  name: string;
  /** Channel item ids in playlist order. */
  channelIds: string[];
}

/** A tuner channel's guide identity: the server's item id and the playlist's tvg-id and tvg-name. */
export interface TunerChannel {
  id: string;
  tvgId: string | null;
  tvgName: string | null;
}

export interface TunerPlaylist {
  groups: TunerGroup[];
  channels: TunerChannel[];
  /** Guide URLs the playlist header declares (x-tvg-url / url-tvg). */
  tvgUrls: string[];
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

export function isLiveSourcesAvailable(): boolean {
  return Platform.OS === "ios" && !!LiveSources?.loadTunerGroups;
}

/**
 * Streams the M3U tuner at `url` natively and resolves its `group-title` groups and per-channel
 * tvg-ids, keyed by the item ids the server gave the entries. `cancelTunerGroups` stops a load.
 */
export async function loadTunerPlaylist(requestId: string, url: string, userAgent?: string): Promise<TunerPlaylist> {
  const result = (await LiveSources.loadTunerGroups({ requestId, url, ...(userAgent ? { userAgent } : {}) })) as { groups?: unknown; channels?: unknown; tvgUrls?: unknown } | null;
  const groups = result?.groups;
  if (!Array.isArray(groups)) throw new Error("The live source module returned no groups.");
  return {
    groups: groups as TunerGroup[],
    channels: Array.isArray(result?.channels) ? (result.channels as TunerChannel[]) : [],
    tvgUrls: Array.isArray(result?.tvgUrls) ? (result.tvgUrls as unknown[]).filter((u): u is string => typeof u === "string") : [],
  };
}

export function cancelTunerGroups(requestId: string): void {
  LiveSources?.cancelLoad?.(requestId);
}

export interface GuideLoadStats {
  channels: number;
  programmes: number;
}

/**
 * Streams the XMLTV at `url` (http(s) or file) into a native store held to the window. `pool` scopes
 * eviction to its own guides; `maxOpen` 0 leaves closing to the caller, which keeps its own use order.
 */
export async function loadGuide(url: string, windowMs: { from: number; to: number }, pool: "external", maxOpen?: number): Promise<{ token: string; stats: GuideLoadStats | null }> {
  const result = (await LiveSources.loadGuide({ url, from: windowMs.from, to: windowMs.to, pool, ...(maxOpen !== undefined ? { maxOpen } : {}) })) as {
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

export interface GuideChannel {
  id: string;
  displayNames: string[];
  icon: string | null;
}

/** The loaded guide's channels in file order, each with its display names. */
export async function guideChannels(token: string): Promise<GuideChannel[]> {
  const channels = (await LiveSources.guideChannels(token)) as unknown;
  return Array.isArray(channels) ? (channels as GuideChannel[]) : [];
}

/** The loaded guide's programmes on the given XMLTV channel ids overlapping the window. */
export async function guideProgrammes(token: string, channelIds: readonly string[], windowMs: { from: number; to: number }): Promise<GuideProgramme[]> {
  const programmes = (await LiveSources.guideProgrammes({ token, channelIds, from: windowMs.from, to: windowMs.to })) as unknown;
  return Array.isArray(programmes) ? (programmes as GuideProgramme[]) : [];
}

export async function closeGuide(token: string): Promise<void> {
  await LiveSources.closeGuide(token);
}
