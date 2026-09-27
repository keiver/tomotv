/**
 * Channel health, fed entirely by the frame sampler's own outcomes: a burst marks a channel
 * alive, and an origin open refused with an HTTP error status strikes it, twice for a down
 * verdict. Nothing here touches the network, so health never competes with a grab for the
 * link or a provider's connection slot. Server-carried channels stay unknown.
 */
import { logger } from "@/utils/logger";

export type ChannelHealth = "up" | "down" | "unknown";

/** Conclusive origin refusals before the verdict. */
export const HEALTH_STRIKES = 2;
/** The origin's own words prove death: an HTTP error status in the open failure. */
const DEFINITIVE = /\b[45]\d\d\b/;

interface Entry {
  verdict: ChannelHealth;
  strikes: number;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();
/** Bumped on every verdict change, for list filters that watch all channels at once. */
let generation = 0;

function entry(channelId: string): Entry {
  let found = entries.get(channelId);
  if (!found) {
    found = { verdict: "unknown", strikes: 0 };
    entries.set(channelId, found);
  }
  return found;
}

function notify(channelId: string): void {
  generation += 1;
  for (const listener of listeners.get(channelId) ?? []) listener();
  for (const listener of anyListeners) listener();
}

/** A burst just came off this channel: it is alive, whatever earlier opens said. */
export function noteChannelAlive(channelId: string): void {
  const item = entry(channelId);
  const was = item.verdict;
  item.verdict = "up";
  item.strikes = 0;
  if (was !== "up") notify(channelId);
}

/** A grab's origin open was refused; only the origin's own HTTP error words count. */
export function noteChannelOpenFailure(channelId: string, failure?: string): void {
  if (!failure || !DEFINITIVE.test(failure)) return;
  const item = entry(channelId);
  item.strikes += 1;
  if (item.strikes >= HEALTH_STRIKES && item.verdict !== "down") {
    item.verdict = "down";
    logger.debug("Channel judged down by its origin", { service: "ChannelHealth", channelId, failure });
    notify(channelId);
  }
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
  const cleared = [...entries.keys()];
  entries.clear();
  for (const channelId of cleared) notify(channelId);
}
