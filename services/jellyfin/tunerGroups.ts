/**
 * The `group-title` groups and per-channel tvg-ids of the server's M3U tuners. Jellyfin drops both,
 * so the device streams each playlist through the native module (native/ios/LiveSources), which
 * parses it and computes the item id the server gave every entry.
 */
import { cancelTunerGroups, isLiveSourcesAvailable, loadTunerPlaylist, type TunerGroup } from "@/services/liveSources";
import { cachedRequest } from "@/services/requestCache";
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
  /** http(s) guide URLs the playlists declare (x-tvg-url / url-tvg), deduped in order. */
  tvgUrls: string[];
}

interface TunerHost {
  Type?: string;
  Url?: string;
  UserAgent?: string;
}

const TUNER_GROUPS_TTL_MS = 60 * 60 * 1000;
/** A failed read is not retried before this passes, or every screen mount re-streams the playlists. */
const TUNER_GROUPS_FAILURE_TTL_MS = 5 * 60 * 1000;

const NO_DATA: TunerData = { groups: [], tvgById: {}, tvgUrls: [] };
const failedAt = new Map<string, number>();
/** The last successful read per key: a failed refetch serves this instead of nothing. */
const lastGood = new Map<string, TunerData>();
let latest: TunerData | null = null;
let requestSeq = 0;

/** The most recent successful read, if any: what a screen shows while a refetch fails. */
export function lastKnownTunerData(): TunerData | null {
  return latest;
}

/** Forgets every read; sign-out and server switches call it so nothing crosses servers. */
export function resetTunerCache(): void {
  failedAt.clear();
  lastGood.clear();
  latest = null;
}

/** The server's http(s) M3U tuners read in one pass: groups and tvg-ids together. */
export async function fetchTunerData(): Promise<TunerData> {
  if (!isLiveSourcesAvailable()) return NO_DATA;
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const key = `tunerGroups:${config.server}:${config.userId}`;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < TUNER_GROUPS_FAILURE_TTL_MS) return lastGood.get(key) ?? NO_DATA;
  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await fetchWithTimeout(
          `${config.server}/System/Configuration/livetv`,
          { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
          API_TIMEOUTS.NORMAL,
        );
        if (!response.ok) throwRequestError(response, `Failed to read the Live TV configuration: ${response.status}`);
        const json = (await response.json()) as { TunerHosts?: TunerHost[] };
        const tuners = (json.TunerHosts ?? []).filter((tuner) => tuner.Type?.toLowerCase() === "m3u" && /^https?:\/\//i.test(tuner.Url ?? ""));
        const groups = new Map<string, Set<string>>();
        const tvgById: Record<string, string> = {};
        const tvgUrls: string[] = [];
        let lastFailure: unknown = null;
        let failures = 0;
        for (const tuner of tuners) {
          try {
            const playlist = await loadTunerPlaylist(`tuner-${++requestSeq}`, tuner.Url!, tuner.UserAgent);
            for (const group of playlist.groups) {
              const ids = groups.get(group.name) ?? new Set<string>();
              for (const id of group.channelIds) ids.add(id);
              groups.set(group.name, ids);
            }
            for (const channel of playlist.channels) tvgById[channel.id] = channel.tvgId;
            for (const url of playlist.tvgUrls) if (/^https?:\/\//i.test(url) && !tvgUrls.includes(url)) tvgUrls.push(url);
          } catch (error) {
            logger.warn("Tuner playlist read failed", error, { service: "TunerGroups" });
            lastFailure = error;
            failures += 1;
          }
        }
        // Every tuner refused (a busy single-connection tuner does, while a channel streams): a
        // failure, never an empty success that would overwrite lastGood and kill the group filter.
        if (tuners.length > 0 && failures === tuners.length) throw lastFailure;
        failedAt.delete(key);
        const data = { groups: Array.from(groups, ([name, ids]) => ({ name, channelIds: Array.from(ids) })), tvgById, tvgUrls };
        lastGood.set(key, data);
        latest = data;
        return data;
      },
      TUNER_GROUPS_TTL_MS,
    );
  } catch (error) {
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
