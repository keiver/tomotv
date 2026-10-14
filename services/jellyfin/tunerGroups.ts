/**
 * The server's M3U tuners, parsed on this device: Jellyfin drops `group-title` and the tvg keys and
 * ingests big playlists over hours, so the device streams each playlist itself (native TunerGroups
 * over the engine's playlist loader), computes the item id the server gives every entry, and feeds
 * the @keiver/tomo-live channel table every list surface reads.
 */
import {
  allPlaylistChannelIds,
  playlistChannelById,
  playlistGroupList,
  playlistOriginKey,
  playlistSourceStatuses,
  playlistTvgUrls,
  playlistTvgUrlSources,
  resetPlaylistChannels,
  syncPlaylistSources,
  type PlaylistChannel,
  type PlaylistChannelSource,
  type PlaylistRows,
} from "@keiver/tomo-live";
import { cachedPlaylistFile, onPlaylistFileRefreshed } from "@/services/guideFileCache";
import type { GuideChannelRequest } from "@/utils/guideMatch";
import { cancelTunerGroups, isTunerGroupsAvailable, loadTunerPlaylist, releaseTunerPlaylist, tunerPlaylistRows, type TunerGroup, type TunerRow } from "@/services/liveSources";
import { cachedRequest, invalidateByPrefix, invalidateRequest } from "@/services/requestCache";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";

export type { TunerGroup };

export interface TunerData {
  /** Every group across the tuners, in playlist order; same-named groups merge. */
  groups: TunerGroup[];
  /** tvg-id by channel item id, for matching an XMLTV guide. */
  tvgById: Record<string, string>;
  /** tvg-name by channel item id, the guide's second matching key. */
  tvgNameById: Record<string, string>;
  /** http(s) guide URLs the playlists declare (x-tvg-url / url-tvg), deduped in order. */
  tvgUrls: string[];
  /** The tuner playlist URLs that declare each guide URL. */
  tvgUrlSources: Record<string, string[]>;
  /** The playlist URLs this read covered, in the server's order. */
  tunerUrls: string[];
  /** Every tuner answered: only then may a group missing from `groups` be treated as gone. */
  complete: boolean;
}

interface TunerHost {
  Type?: string;
  Url?: string;
  UserAgent?: string;
}

const LOOPBACK_ORIGIN = /^(https?:\/\/)(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/?#]|$)/i;

/** A tuner the server reads on its own loopback is at the server's host for this device. */
function reachableTunerUrl(tunerUrl: string, server: string): string {
  const host = /^https?:\/\/([^/?#:]+|\[[^\]]+\])/i.exec(server)?.[1];
  return host ? tunerUrl.replace(LOOPBACK_ORIGIN, `$1${host}`) : tunerUrl;
}

const TUNER_GROUPS_TTL_MS = 60 * 60 * 1000;
/** A failed read is not retried before this passes, or every screen mount re-streams the playlists. */
const TUNER_GROUPS_FAILURE_TTL_MS = 5 * 60 * 1000;
/** Entries per native call when paging a loaded playlist's rows out of the store: each call's
 *  JSI conversion and JS object materialization stay bounded, whatever the playlist's size. */
const ROW_PAGE = 1000;

const NO_DATA: TunerData = { groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: [], tvgUrlSources: {}, tunerUrls: [], complete: false };
const failedAt = new Map<string, number>();
/** The last successful read per key: a failed refetch serves this instead of nothing. */
const lastGood = new Map<string, TunerData>();
let latest: TunerData | null = null;
let requestSeq = 0;
/** Bumped by reset, so a read that outlived a server switch writes nothing back. */
let generation = 0;
let settled = false;

/** The most recent successful read, if any: what a screen shows while a refetch fails. */
export function lastKnownTunerData(): TunerData | null {
  return latest;
}

/** Whether a read has finished for this sign-in: until then the channel table says nothing about what is pending. */
export function tunerDataSettled(): boolean {
  return settled;
}

/** Forgets every read and the channel table; sign-out and server switches call it so nothing crosses servers. */
export function resetTunerCache(): void {
  generation += 1;
  settled = false;
  failedAt.clear();
  lastGood.clear();
  latest = null;
  Object.assign(requestsCache, { data: null, lineup: null, requests: [], names: {} });
  resetPlaylistChannels();
}

interface ListingProvider {
  Type?: string;
  Path?: string;
}

/** The server's Live TV config as the device reads it: http(s) M3U tuners it can stream itself,
 *  and the http(s) XMLTV listing providers it can parse itself, no setup on the device. */
async function readLiveTvConfig(config: Awaited<ReturnType<typeof getConfig>>): Promise<{ tuners: TunerHost[]; guideUrls: string[] }> {
  const response = await fetchWithTimeout(
    `${config.server}/System/Configuration/livetv`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.NORMAL,
  );
  if (!response.ok) throwRequestError(response, `Failed to read the Live TV configuration: ${response.status}`);
  const json = (await response.json()) as { TunerHosts?: TunerHost[]; ListingProviders?: ListingProvider[] };
  return {
    tuners: (json.TunerHosts ?? []).filter((tuner) => tuner.Type?.toLowerCase() === "m3u" && /^https?:\/\//i.test(tuner.Url ?? "")),
    guideUrls: (json.ListingProviders ?? [])
      .filter((provider) => provider.Type?.toLowerCase() === "xmltv" && /^https?:\/\//i.test(provider.Path ?? ""))
      .map((provider) => reachableTunerUrl(provider.Path!, config.server)),
  };
}

/** The tuner's own User-Agent rides every stream it lists, as the server sends it; an entry's own wins. */
function channelRow(row: TunerRow, userAgent: string | undefined): PlaylistChannel {
  const ownAgent = Object.keys(row.headers).some((name) => name.toLowerCase() === "user-agent");
  return {
    id: row.id,
    name: row.name,
    number: row.number,
    logoUrl: row.logo,
    streamUrl: row.url,
    headers: userAgent && !ownAgent ? { ...row.headers, "user-agent": userAgent } : row.headers,
    originKey: playlistOriginKey(row.url),
    groups: row.groups,
    tvgId: row.tvgId,
    tvgName: row.tvgName,
    radio: row.radio,
    drm: row.drm,
  };
}

// A playlist download owed while playback held the link has landed: the next read streams it again.
onPlaylistFileRefreshed(() => invalidateByPrefix("tunerGroups:"));

/** Streams one tuner playlist natively and pages its channel rows out of the retained store. */
async function loadTunerRows(source: PlaylistChannelSource, userAgent: string | undefined): Promise<PlaylistRows> {
  const fetchUrl = await cachedPlaylistFile(source.fetchUrl ?? source.url, undefined, userAgent ? { headers: { "User-Agent": userAgent } } : undefined);
  const requestId = `tuner-${++requestSeq}`;
  const playlist = await loadTunerPlaylist(requestId, source.url, userAgent, fetchUrl);
  try {
    const rows: PlaylistChannel[] = [];
    for (let offset = 0; offset < playlist.entryCount; offset += ROW_PAGE) {
      for (const row of await tunerPlaylistRows(requestId, { offset, limit: ROW_PAGE })) rows.push(channelRow(row, userAgent));
    }
    return { rows, tvgUrls: playlist.tvgUrls.filter((url) => /^https?:\/\//i.test(url)) };
  } finally {
    releaseTunerPlaylist(requestId).catch(() => {});
  }
}

/** The channel table's statuses say every source landed at least once and none is failing. */
function tableComplete(tunerUrls: readonly string[]): boolean {
  const statuses = playlistSourceStatuses();
  return tunerUrls.every((url) => {
    const status = statuses[url];
    return !!status && status.state === "ready" && status.loadedAt !== null;
  });
}

/** TunerData as the guide and group surfaces read it, derived from the channel table.
 *  `serverGuideUrls` are the server's own XMLTV providers, listed after the playlists' declared guides. */
function deriveTunerData(tunerUrls: string[], serverGuideUrls: string[] = []): TunerData {
  const tvgById: Record<string, string> = {};
  const tvgNameById: Record<string, string> = {};
  for (const id of allPlaylistChannelIds()) {
    const row = playlistChannelById(id);
    if (!row) continue;
    if (row.tvgId) tvgById[id] = row.tvgId;
    if (row.tvgName) tvgNameById[id] = row.tvgName;
  }
  return {
    groups: playlistGroupList(),
    tvgById,
    tvgNameById,
    tvgUrls: [...new Set([...playlistTvgUrls(), ...serverGuideUrls])],
    tvgUrlSources: playlistTvgUrlSources(),
    tunerUrls,
    complete: tableComplete(tunerUrls),
  };
}

/** The server's http(s) M3U tuners read in one pass: the channel table, groups and tvg keys together.
 *  `revalidate` reads the tuner list first and drops the cached read when a playlist was added or removed. */
export async function fetchTunerData(options: { revalidate?: boolean } = {}): Promise<TunerData> {
  const gen = generation;
  try {
    return await readTunerData(options);
  } finally {
    if (gen === generation) settled = true;
  }
}

async function readTunerData(options: { revalidate?: boolean }): Promise<TunerData> {
  if (!isTunerGroupsAvailable()) return NO_DATA;
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const key = `tunerGroups:${config.server}:${config.userId}`;
  const known = lastGood.get(key);
  if (options.revalidate && known) {
    const read = await readLiveTvConfig(config).catch(() => null);
    if (read && read.tuners.map((tuner) => tuner.Url).join("\n") !== known.tunerUrls.join("\n")) {
      invalidateRequest(key);
      failedAt.delete(key);
    }
  }
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < TUNER_GROUPS_FAILURE_TTL_MS) return lastGood.get(key) ?? NO_DATA;
  const gen = generation;
  try {
    const data = await cachedRequest(
      key,
      async () => {
        const { tuners, guideUrls } = await readLiveTvConfig(config);
        // A reset during the config read: these tuners are another sign-in's and must not reach the table.
        if (gen !== generation) return { ...NO_DATA, tunerUrls: tuners.map((tuner) => tuner.Url!) };
        const failures = new Map<string, unknown>();
        const sources: PlaylistChannelSource[] = tuners.map((tuner) => ({
          key: tuner.Url!,
          url: tuner.Url!,
          fetchUrl: reachableTunerUrl(tuner.Url!, config.server),
          loadRows: async (source) => {
            try {
              return await loadTunerRows(source, tuner.UserAgent);
            } catch (error) {
              failures.set(source.key, error);
              throw error;
            }
          },
        }));
        // This cache is the freshness gate: a read that got here re-streams every playlist.
        await syncPlaylistSources(sources, { force: true });
        const tunerUrls = tuners.map((tuner) => tuner.Url!);
        if (gen !== generation) return deriveTunerData(tunerUrls, guideUrls);
        const data = deriveTunerData(tunerUrls, guideUrls);
        // Every tuner refused and nothing is tabled: a failure, never an empty success that would
        // overwrite lastGood and kill the group filter.
        // Read off the table's statuses: a load another read started fails into that read's `failures`, not this one's.
        const statuses = playlistSourceStatuses();
        if (tuners.length > 0 && tunerUrls.every((url) => statuses[url]?.state === "error") && allPlaylistChannelIds().length === 0) {
          throw failures.values().next().value ?? new Error("Every tuner playlist failed to load.");
        }
        // A partial read is retried after the failure window, like a failed one.
        if (data.complete) failedAt.delete(key);
        else failedAt.set(key, Date.now());
        lastGood.set(key, data);
        latest = data;
        return data;
      },
      TUNER_GROUPS_TTL_MS,
    );
    if (!data.complete) invalidateRequest(key);
    return data;
  } catch (error) {
    if (gen !== generation) throw error;
    failedAt.set(key, Date.now());
    const kept = lastGood.get(key);
    if (kept) {
      logger.warn("Tuner config read failed, serving the last good groups", error, { service: "TunerGroups" });
      return kept;
    }
    throw error;
  }
}

/** The last (table, lineup) pair's request list: both inputs are cached objects, so identity holds between queries. */
const requestsCache = { data: null as object | null, lineup: null as object | null, requests: [] as GuideChannelRequest[], names: {} as Record<string, string> };

/**
 * The guide-match requests for every channel the table or the lineup knows, with the lineup's names.
 * Built once per (table, lineup) identity, never per query: search calls this on each keystroke, and
 * the guide layer's match memo keys on the returned array staying one object.
 */
export function guideChannelRequests(
  data: Pick<TunerData, "tvgById" | "tvgNameById">,
  lineup: readonly { Id: string; Name?: string | null }[],
): { requests: GuideChannelRequest[]; names: Record<string, string> } {
  if (requestsCache.data === data && requestsCache.lineup === lineup) return { requests: requestsCache.requests, names: requestsCache.names };
  const names: Record<string, string> = {};
  for (const channel of lineup) if (channel.Name) names[channel.Id] = channel.Name;
  const ids = new Set([...Object.keys(data.tvgById), ...Object.keys(data.tvgNameById), ...Object.keys(names)]);
  const requests: GuideChannelRequest[] = [...ids].map((channelId) => ({
    channelId,
    tvgId: data.tvgById[channelId],
    tvgName: data.tvgNameById[channelId],
    name: names[channelId] ?? data.tvgNameById[channelId] ?? "",
  }));
  Object.assign(requestsCache, { data, lineup, requests, names });
  return { requests, names };
}

export async function fetchTunerGroups(): Promise<TunerGroup[]> {
  return (await fetchTunerData()).groups;
}

export { cancelTunerGroups };
