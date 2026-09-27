/**
 * Origin health per live channel, for the rows the sampler is showing: one small playlist read,
 * down only on proof (an HTTP error status twice, or a body that is no manifest). A thrown
 * network error changes nothing: the engine reads origins through its own HTTP, which redeems
 * some of them (TLS-broken hosts measured serving live playlists). Server-carried channels are
 * never opened and stay unknown.
 */
import { resolveChannelOrigin } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { AppState } from "react-native";

export type ChannelHealth = "up" | "down" | "unknown";

/** A healthy channel is trusted this long before another look. */
export const HEALTH_RECHECK_MS = 30 * 60_000;
/** A down channel waits this long, doubling per conclusive failure, up to the cap. */
export const HEALTH_DOWN_RETRY_MS = 10 * 60_000;
export const HEALTH_DOWN_RETRY_CAP_MS = 60 * 60_000;
/** A first strike rechecks this soon; the second makes the verdict. */
export const HEALTH_STRIKE_RETRY_MS = 60_000;
export const HEALTH_STRIKES = 2;
export const HEALTH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 3;

interface Entry {
  verdict: ChannelHealth;
  /** When the last conclusive answer landed; 0 before any. */
  at: number;
  strikes: number;
  checking: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();
/** Bumped on every verdict change, for list filters that watch all channels at once. */
let generation = 0;
/** Bumped by clear, so a check that outlived a server switch writes nothing back. */
let epoch = 0;
let viewable: string[] = [];
let checking = 0;
/** Wakes the pump for the next due recheck; nothing viewable, nothing armed. */
let timer: ReturnType<typeof setTimeout> | null = null;

function entry(channelId: string): Entry {
  let found = entries.get(channelId);
  if (!found) {
    found = { verdict: "unknown", at: 0, strikes: 0, checking: false };
    entries.set(channelId, found);
  }
  return found;
}

function notify(channelId: string): void {
  generation += 1;
  for (const listener of listeners.get(channelId) ?? []) listener();
  for (const listener of anyListeners) listener();
}

/** When the channel's entry is worth another look. */
function dueAt(item: Entry): number {
  if (item.strikes > 0 && item.verdict !== "down") return item.at + HEALTH_STRIKE_RETRY_MS;
  if (item.verdict === "up") return item.at + HEALTH_RECHECK_MS;
  if (item.verdict === "down") return item.at + Math.min(HEALTH_DOWN_RETRY_MS * 2 ** (item.strikes - HEALTH_STRIKES), HEALTH_DOWN_RETRY_CAP_MS);
  // Never looked at 0; an inconclusive look holds its answer a while, never a tight re-ask loop.
  return item.at === 0 ? 0 : item.at + HEALTH_DOWN_RETRY_MS;
}

type Look = { conclusive: "up" } | { conclusive: "strike"; why: string } | { conclusive: "none" };

/** One read of the origin playlist, classified; never throws. */
async function look(channelId: string): Promise<Look> {
  let origin;
  try {
    origin = await resolveChannelOrigin(channelId);
  } catch {
    return { conclusive: "none" };
  }
  if (!origin) return { conclusive: "none" };
  try {
    const response = await fetch(origin.url, { headers: origin.headers ?? {}, signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return { conclusive: "strike", why: `http ${response.status}` };
    const body = (await response.text()).slice(0, 4096).trimStart();
    if (body.startsWith("#EXTM3U") || body.includes("<MPD")) return { conclusive: "up" };
    return { conclusive: "strike", why: "no manifest" };
  } catch {
    // RN's fetch folds DNS, TLS and timeouts into one error; none of them proves the origin dead.
    return { conclusive: "none" };
  }
}

/** Arms the pump for the earliest recheck among the rows in view. */
function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (viewable.length === 0) return;
  const now = Date.now();
  let earliest = Infinity;
  for (const channelId of viewable) {
    const item = entry(channelId);
    if (!item.checking) earliest = Math.min(earliest, dueAt(item));
  }
  if (earliest === Infinity) return;
  timer = setTimeout(
    () => {
      timer = null;
      pump();
    },
    Math.max(1_000, earliest - now),
  );
}

function pump(): void {
  if (AppState.currentState === "background") return;
  const now = Date.now();
  schedule();
  for (const channelId of viewable) {
    if (checking >= CONCURRENCY) return;
    const item = entry(channelId);
    if (item.checking || now < dueAt(item)) continue;
    item.checking = true;
    checking += 1;
    const gen = epoch;
    void look(channelId)
      .then((result) => {
        if (gen !== epoch) return;
        item.checking = false;
        if (result.conclusive === "none") {
          // Inconclusive: whatever was known stands, and the clock moves so it is not re-asked at once.
          item.at = now;
          return;
        }
        const was = item.verdict;
        if (result.conclusive === "up") {
          item.verdict = "up";
          item.strikes = 0;
        } else {
          item.strikes += 1;
          if (item.strikes >= HEALTH_STRIKES) item.verdict = "down";
          logger.debug("Channel health strike", { service: "ChannelHealth", channelId, why: result.why, strikes: item.strikes });
        }
        item.at = Date.now();
        if (item.verdict !== was) notify(channelId);
      })
      .finally(() => {
        if (gen === epoch) checking = Math.max(0, checking - 1);
        pump();
      });
  }
}

/** The sampler's rows in view; checks follow them. Called by liveFrames with its viewable set. */
export function setHealthViewable(channelIds: string[]): void {
  viewable = channelIds;
  pump();
}

/** A burst just came off this channel: it is alive, whatever a playlist read said. */
export function noteChannelAlive(channelId: string): void {
  const item = entry(channelId);
  const was = item.verdict;
  item.verdict = "up";
  item.strikes = 0;
  item.at = Date.now();
  if (was !== "up") notify(channelId);
}

export function healthFor(channelId: string): ChannelHealth {
  return entries.get(channelId)?.verdict ?? "unknown";
}

export function subscribeChannelHealth(channelId: string, listener: () => void): () => void {
  let set = listeners.get(channelId);
  if (!set) {
    set = new Set();
    listeners.set(channelId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(channelId);
  };
}

/** For list filters: bumped on every verdict change anywhere. */
export function healthGeneration(): number {
  return generation;
}

export function subscribeHealthGeneration(listener: () => void): () => void {
  anyListeners.add(listener);
  return () => anyListeners.delete(listener);
}

/** Channel ids repeat across servers: a switch drops every verdict. */
export function clearChannelHealth(): void {
  epoch += 1;
  checking = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  const cleared = [...entries.keys()];
  entries.clear();
  for (const channelId of cleared) notify(channelId);
}
