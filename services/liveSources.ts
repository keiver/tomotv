/**
 * liveSources.ts
 *
 * Tomo's side of the live source module (@keiver/tomo-engine, ios/LiveSources): the XMLTV guide
 * API is the package's, re-exported here; the Jellyfin tuner playlist read is Tomo's own native
 * module (native/ios/TunerGroups) over the engine's playlist loader.
 */
import { NativeModules, Platform } from "react-native";

export { closeGuide, guideChannels, guideProgrammes, isLiveSourcesAvailable, loadGuide, type GuideChannel, type GuideLoadStats, type GuideProgramme } from "@keiver/tomo-engine";

const { TunerGroups } = NativeModules;

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

/** Everything the device needs to list and tune a tuner channel without the server's item. */
export interface TunerRow {
  id: string;
  name: string;
  number: string | null;
  logo: string | null;
  /** The stream URL, pipe headers stripped. */
  url: string;
  headers: Record<string, string>;
  groups: string[];
  tvgId: string | null;
  tvgName: string | null;
  radio: boolean;
  drm: boolean;
}

export interface TunerPlaylist {
  groups: TunerGroup[];
  channels: TunerChannel[];
  /** Guide URLs the playlist header declares (x-tvg-url / url-tvg). */
  tvgUrls: string[];
  /** Raw entries in the retained store, the offsets `tunerPlaylistRows` pages over. */
  entryCount: number;
}

export function isTunerGroupsAvailable(): boolean {
  return Platform.OS === "ios" && !!TunerGroups?.loadTunerGroups;
}

/**
 * Streams the M3U tuner at `url` natively and resolves its `group-title` groups and per-channel
 * tvg-ids, keyed by the item ids the server gave the entries. `fetchUrl` is where this device reads
 * it when that differs from the stored `url` the ids hash. `cancelTunerGroups` stops a load.
 */
export async function loadTunerPlaylist(requestId: string, url: string, userAgent?: string, fetchUrl: string = url): Promise<TunerPlaylist> {
  const result = (await TunerGroups.loadTunerGroups({ requestId, url, fetchUrl, ...(userAgent ? { userAgent } : {}) })) as {
    groups?: unknown;
    channels?: unknown;
    tvgUrls?: unknown;
    entryCount?: unknown;
  } | null;
  const groups = result?.groups;
  if (!Array.isArray(groups)) throw new Error("The tuner groups module returned no groups.");
  return {
    groups: groups as TunerGroup[],
    channels: Array.isArray(result?.channels) ? (result.channels as TunerChannel[]) : [],
    tvgUrls: Array.isArray(result?.tvgUrls) ? (result.tvgUrls as unknown[]).filter((u): u is string => typeof u === "string") : [],
    entryCount: typeof result?.entryCount === "number" ? result.entryCount : 0,
  };
}

/** A page of the loaded playlist's channel rows; shorter than `limit` where entries are not channels. */
export async function tunerPlaylistRows(requestId: string, page: { offset: number; limit: number }): Promise<TunerRow[]> {
  const rows = (await TunerGroups.tunerRows({ requestId, offset: page.offset, limit: page.limit })) as unknown;
  return Array.isArray(rows) ? (rows as TunerRow[]) : [];
}

/** Frees the store `loadTunerPlaylist` held for row paging. */
export async function releaseTunerPlaylist(requestId: string): Promise<void> {
  await TunerGroups?.releaseTunerPlaylist?.(requestId);
}

export function cancelTunerGroups(requestId: string): void {
  TunerGroups?.cancelLoad?.(requestId);
}
