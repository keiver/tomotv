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

export interface TunerPlaylist {
  groups: TunerGroup[];
  channels: TunerChannel[];
  /** Guide URLs the playlist header declares (x-tvg-url / url-tvg). */
  tvgUrls: string[];
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
  const result = (await TunerGroups.loadTunerGroups({ requestId, url, fetchUrl, ...(userAgent ? { userAgent } : {}) })) as { groups?: unknown; channels?: unknown; tvgUrls?: unknown } | null;
  const groups = result?.groups;
  if (!Array.isArray(groups)) throw new Error("The tuner groups module returned no groups.");
  return {
    groups: groups as TunerGroup[],
    channels: Array.isArray(result?.channels) ? (result.channels as TunerChannel[]) : [],
    tvgUrls: Array.isArray(result?.tvgUrls) ? (result.tvgUrls as unknown[]).filter((u): u is string => typeof u === "string") : [],
  };
}

export function cancelTunerGroups(requestId: string): void {
  TunerGroups?.cancelLoad?.(requestId);
}
