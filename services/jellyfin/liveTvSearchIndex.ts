/**
 * The server's programmes from now to the end of tomorrow with their descriptions, which the
 * server's own search never reads (/Items matches names only; /LiveTv/Programs takes no search
 * term). Built in the background when a Live TV search first needs it, page by page so the JS
 * thread keeps breathing, and rebuilt by a guide refresh or after an hour. A search never waits on it:
 * it answers with what is ready and subscribers re-run once the index lands.
 */
import { foldText } from "@/utils/textFold";
import { guideDays } from "@/utils/guide";
import { logger } from "@/utils/logger";
import type { JellyfinVideosResponse } from "@/types/jellyfin";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS } from "./constants";
import { getAuthHeader, type JellyfinConfig } from "./session";

/** Programmes per page: about 1.1 MB of JSON, measured at 557 bytes a programme. */
const PAGE_SIZE = 2000;
/** The server refreshes its guide on its own schedule, which the app cannot hear. */
const INDEX_TTL_MS = 60 * 60 * 1000;
/** A failed build is not retried before this passes, so a refusing server is not asked every keystroke. */
const FAILURE_BACKOFF_MS = 60 * 1000;

export interface IndexedProgram {
  id: string;
  name: string;
  channelId: string;
  startMs: number;
  endMs: number;
  /** Name, episode title and description, folded once when the page lands. */
  text: string;
}

interface Index {
  key: string;
  builtAt: number;
  programs: IndexedProgram[];
}

let index: Index | null = null;
let building: { key: string; generation: number } | null = null;
let failed: { key: string; at: number } | null = null;
let generation = 0;
let version = 0;
const listeners = new Set<() => void>();

const keyFor = (config: JellyfinConfig) => `${config.server}|${config.userId}`;

/** End of tomorrow, local midnight: what a Live TV search reaches. */
export function liveTvSearchHorizon(nowMs: number): number {
  return guideDays(nowMs, 3)[2];
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function build(config: JellyfinConfig, mine: number): Promise<void> {
  const nowMs = Date.now();
  const programs: IndexedProgram[] = [];
  const seen = new Set<string>();
  for (let startIndex = 0; ; startIndex += PAGE_SIZE) {
    const query = new URLSearchParams({
      userId: config.userId!,
      minEndDate: new Date(nowMs).toISOString(),
      maxStartDate: new Date(liveTvSearchHorizon(nowMs)).toISOString(),
      sortBy: "StartDate",
      fields: "Overview",
      enableImages: "false",
      enableUserData: "false",
      enableTotalRecordCount: "false",
      startIndex: String(startIndex),
      limit: String(PAGE_SIZE),
    });
    const response = await fetchWithTimeout(
      `${config.server}/LiveTv/Programs?${query.toString()}`,
      { method: "GET", headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.NORMAL,
    );
    if (!response.ok) throw new Error(`Live TV programme read failed: ${response.status}`);
    const page = ((await response.json()) as JellyfinVideosResponse).Items ?? [];
    if (mine !== generation) return;
    for (const item of page) {
      const startMs = Date.parse(item.StartDate ?? "");
      const endMs = Date.parse(item.EndDate ?? "");
      if (!item.ChannelId || seen.has(item.Id) || Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      seen.add(item.Id);
      programs.push({ id: item.Id, name: item.Name, channelId: item.ChannelId, startMs, endMs, text: foldText([item.Name, item.EpisodeTitle, item.Overview].filter(Boolean).join(" ")) });
    }
    if (page.length < PAGE_SIZE) break;
    await yieldToUi();
  }
  index = { key: keyFor(config), builtAt: Date.now(), programs };
  version += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * The indexed programmes for this server and user, or null while none is ready. A missing, foreign
 * or expired index starts a build in the background; an expired one still answers until it lands.
 */
export function liveTvSearchIndex(config: JellyfinConfig): IndexedProgram[] | null {
  const key = keyFor(config);
  const current = index?.key === key ? index : null;
  const fresh = !!current && Date.now() - current.builtAt < INDEX_TTL_MS;
  const backingOff = failed?.key === key && Date.now() - failed.at < FAILURE_BACKOFF_MS;
  if (!fresh && !backingOff && building?.key !== key) {
    const mine = ++generation;
    building = { key, generation: mine };
    build(config, mine)
      .then(() => {
        failed = null;
      })
      .catch((error) => {
        if (mine === generation) failed = { key, at: Date.now() };
        logger.warn("Live TV programme index failed", error, { service: "JellyfinAPI" });
      })
      .finally(() => {
        if (building?.generation === mine) building = null;
      });
  }
  return current?.programs ?? null;
}

/** The guide was refreshed: the next search rebuilds from the server's current listings. */
export function invalidateLiveTvSearchIndex(): void {
  generation += 1;
  index = null;
  building = null;
  failed = null;
}

/** Fires each time a fresh index lands, so a search on screen can run again. */
export function subscribeLiveTvSearchIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function liveTvSearchIndexVersion(): number {
  return version;
}
