/**
 * The `group-title` groups and per-channel tvg-ids of the server's M3U tuners. Jellyfin drops both,
 * so the device streams each playlist through the native module (native/ios/TunerGroups over the
 * engine's playlist loader), which parses it and computes the item id the server gave every entry.
 */
import { cancelTunerGroups, isTunerGroupsAvailable, loadTunerPlaylist, type TunerGroup, type TunerPlaylist } from "@/services/liveSources";
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

const TUNER_GROUPS_TTL_MS = 60 * 60 * 1000;
/** A failed read is not retried before this passes, or every screen mount re-streams the playlists. */
const TUNER_GROUPS_FAILURE_TTL_MS = 5 * 60 * 1000;

const NO_DATA: TunerData = { groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: [], tvgUrlSources: {}, tunerUrls: [], complete: false };
const failedAt = new Map<string, number>();
/** The last successful read per key: a failed refetch serves this instead of nothing. */
const lastGood = new Map<string, TunerData>();
/** Each tuner's last playlist, by read key and tuner URL: a refusing tuner stands in with its own. */
const lastPlaylist = new Map<string, TunerPlaylist>();
let latest: TunerData | null = null;
let requestSeq = 0;
/** Bumped by reset, so a read that outlived a server switch writes nothing back. */
let generation = 0;

/** The most recent successful read, if any: what a screen shows while a refetch fails. */
export function lastKnownTunerData(): TunerData | null {
  return latest;
}

/** Forgets every read; sign-out and server switches call it so nothing crosses servers. */
export function resetTunerCache(): void {
  generation += 1;
  failedAt.clear();
  lastGood.clear();
  lastPlaylist.clear();
  latest = null;
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

/** The server's http(s) M3U tuners read in one pass: groups and tvg-ids together. `revalidate` reads
 *  the tuner list first and drops the cached read when a playlist was added or removed on the server. */
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
        const groups = new Map<string, Set<string>>();
        const tvgById: Record<string, string> = {};
        const tvgNameById: Record<string, string> = {};
        const tvgUrls: string[] = [];
        const tvgUrlSources: Record<string, string[]> = {};
        let lastFailure: unknown = null;
        let failures = 0;
        for (const tuner of tuners) {
          const tunerKey = `${key}|${tuner.Url}`;
          let playlist: TunerPlaylist | undefined;
          try {
            playlist = await loadTunerPlaylist(`tuner-${++requestSeq}`, tuner.Url!, tuner.UserAgent);
            if (gen === generation) lastPlaylist.set(tunerKey, playlist);
          } catch (error) {
            logger.warn("Tuner playlist read failed", error, { service: "TunerGroups" });
            lastFailure = error;
            failures += 1;
            // A refusing tuner (busy streaming) keeps what it last said; the others speak for themselves.
            playlist = lastPlaylist.get(tunerKey);
          }
          if (playlist) {
            for (const group of playlist.groups) {
              const ids = groups.get(group.name) ?? new Set<string>();
              for (const id of group.channelIds) ids.add(id);
              groups.set(group.name, ids);
            }
            for (const channel of playlist.channels) {
              if (channel.tvgId) tvgById[channel.id] = channel.tvgId;
              if (channel.tvgName) tvgNameById[channel.id] = channel.tvgName;
            }
            for (const url of playlist.tvgUrls) {
              if (!/^https?:\/\//i.test(url)) continue;
              if (!tvgUrls.includes(url)) tvgUrls.push(url);
              const sources = (tvgUrlSources[url] ??= []);
              if (!sources.includes(tuner.Url!)) sources.push(tuner.Url!);
            }
          }
        }
        // Every tuner refused (a busy single-connection tuner does, while a channel streams): a
        // failure, never an empty success that would overwrite lastGood and kill the group filter.
        if (tuners.length > 0 && failures === tuners.length) throw lastFailure;
        const data: TunerData = {
          groups: Array.from(groups, ([name, ids]) => ({ name, channelIds: Array.from(ids) })),
          tvgById,
          tvgNameById,
          tvgUrls,
          tvgUrlSources,
          tunerUrls: tuners.map((tuner) => tuner.Url!),
          complete: failures === 0,
        };
        if (gen !== generation) return data;
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
