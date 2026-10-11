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
import { cachedPlaylistFile } from "@/services/guideFileCache";
import { cancelTunerGroups, isTunerGroupsAvailable, loadTunerPlaylist, releaseTunerPlaylist, tunerPlaylistRows, type TunerGroup, type TunerRow } from "@/services/liveSources";
import { cachedRequest, invalidateRequest } from "@/services/requestCache";
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

/** The most recent successful read, if any: what a screen shows while a refetch fails. */
export function lastKnownTunerData(): TunerData | null {
  return latest;
}

/** Forgets every read and the channel table; sign-out and server switches call it so nothing crosses servers. */
export function resetTunerCache(): void {
  generation += 1;
  failedAt.clear();
  lastGood.clear();
  latest = null;
  resetPlaylistChannels();
}

/** The server's M3U tuners the device can stream itself: http(s) ones only. */
async function readTuners(config: Awaited<ReturnType<typeof getConfig>>): Promise<TunerHost[]> {
  const response = await fetchWithTimeout(
    `${config.server}/System/Configuration/livetv`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.NORMAL,
  );
  if (!response.ok) throwRequestError(response, `Failed to read the Live TV configuration: ${response.status}`);
  const json = (await response.json()) as { TunerHosts?: TunerHost[] };
  return (json.TunerHosts ?? []).filter((tuner) => tuner.Type?.toLowerCase() === "m3u" && /^https?:\/\//i.test(tuner.Url ?? ""));
}

function channelRow(row: TunerRow): PlaylistChannel {
  return {
    id: row.id,
    name: row.name,
    number: row.number,
    logoUrl: row.logo,
    streamUrl: row.url,
    headers: row.headers,
    originKey: playlistOriginKey(row.url),
    groups: row.groups,
    tvgId: row.tvgId,
    tvgName: row.tvgName,
    radio: row.radio,
    drm: row.drm,
  };
}

/** Streams one tuner playlist natively and pages its channel rows out of the retained store. */
async function loadTunerRows(source: PlaylistChannelSource, userAgent: string | undefined): Promise<PlaylistRows> {
  // The disk cache cannot send a tuner's User-Agent, so such a playlist is fetched natively instead.
  const fetchUrl = userAgent ? (source.fetchUrl ?? source.url) : await cachedPlaylistFile(source.fetchUrl ?? source.url);
  const requestId = `tuner-${++requestSeq}`;
  const playlist = await loadTunerPlaylist(requestId, source.url, userAgent, fetchUrl);
  try {
    const rows: PlaylistChannel[] = [];
    for (let offset = 0; offset < playlist.entryCount; offset += ROW_PAGE) {
      for (const row of await tunerPlaylistRows(requestId, { offset, limit: ROW_PAGE })) rows.push(channelRow(row));
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

/** TunerData as the guide and group surfaces read it, derived from the channel table. */
function deriveTunerData(tunerUrls: string[]): TunerData {
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
    tvgUrls: playlistTvgUrls(),
    tvgUrlSources: playlistTvgUrlSources(),
    tunerUrls,
    complete: tableComplete(tunerUrls),
  };
}

/** The server's http(s) M3U tuners read in one pass: the channel table, groups and tvg keys together.
 *  `revalidate` reads the tuner list first and drops the cached read when a playlist was added or removed. */
export async function fetchTunerData(options: { revalidate?: boolean } = {}): Promise<TunerData> {
  if (!isTunerGroupsAvailable()) return NO_DATA;
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const key = `tunerGroups:${config.server}:${config.userId}`;
  const known = lastGood.get(key);
  if (options.revalidate && known) {
    const tuners = await readTuners(config).catch(() => null);
    if (tuners && tuners.map((tuner) => tuner.Url).join("\n") !== known.tunerUrls.join("\n")) {
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
        const tuners = await readTuners(config);
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
        if (gen !== generation) return deriveTunerData(tunerUrls);
        const data = deriveTunerData(tunerUrls);
        // Every tuner refused and nothing is tabled: a failure, never an empty success that would
        // overwrite lastGood and kill the group filter.
        if (tuners.length > 0 && failures.size === tuners.length && allPlaylistChannelIds().length === 0) throw failures.values().next().value;
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

export async function fetchTunerGroups(): Promise<TunerGroup[]> {
  return (await fetchTunerData()).groups;
}

export { cancelTunerGroups };
