import { closeLiveStream, closeWarmedChannels, isServerLaneChannel, noteOpenFailed, openRecentlyFailed, resolveChannel, warmChannel } from "@/services/jellyfinApi";
import { canRemuxLocally, localRemuxToken, setLiveWindow, startLocalRemux, stopLocalRemux, subscribeEngineFailure, subscribeEngineThroughput } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { adjacentChannelId } from "@/utils/guide";
import { logger } from "@/utils/logger";

/**
 * The channels around the one on screen, and the one owner of their sessions. Neighbours run in
 * the engine with segments already cut, so a flip binds a ready session (measured 0.05-0.10s to
 * ready against 0.6-2.8s cold); the wider ring's server-lane channels are held open on the server.
 */

/** Channels on each side kept cutting segments in the engine. */
const HOT_RADIUS = 1;
/** Channels on each side the server holds open, when the server is their lane. */
const WARM_RADIUS = 10;
/** Hot sessions at once: both neighbours and the channel just left, until a recenter trims it. */
const MAX_HOT = 3;
/** A hot session's window until a player adopts it: disk, not playback, is what it bounds. */
const HOT_WINDOW_SECONDS = 20;
/** What an adopted session widens to, the engine's own live window. */
const PLAYING_WINDOW_SECONDS = 300;
/** How long a channel the engine cannot take stays out of the hot ring. */
const COLD_ONLY_MS = 10 * 60_000;
/** Segments cut before a neighbour counts as ready: measured 0.05-0.10s to ready after two, up to 2.09s after one. */
const READY_SEGMENTS = 2;

export interface HotChannel {
  channelId: string;
  details: JellyfinVideoItem;
  url: string;
  token: string;
}

/** A ring session handed to the player; not ready while it has cut fewer than READY_SEGMENTS. */
export interface RingSession extends HotChannel {
  ready: boolean;
}

interface HotEntry extends HotChannel {
  segmentsCut: number;
  /** Enough segments cut that a player binding now starts at once. */
  ready: boolean;
  unsubscribe: () => void;
}

const hot = new Map<string, HotEntry>();
/** Starts in flight, by channel, with the generation that asked. */
const starting = new Map<string, number>();
/** A flip waiting on a start in flight: the start hands its session here instead of into the ring. */
const claims = new Map<string, (session: RingSession | null) => void>();
const coldUntil = new Map<string, number>();
let generation = 0;
let active = false;
let center: string | null = null;
let wanted = new Set<string>();

/** Channel ids within `radius` steps of `centerId` either way round the ring, the center excluded. */
export function ringAround(ring: { Id: string }[], centerId: string, radius: number): string[] {
  const ids: string[] = [];
  for (const direction of [1, -1] as const) {
    let id: string | null = centerId;
    for (let step = 0; step < radius; step++) {
      id = adjacentChannelId(ring, id, direction);
      if (!id || id === centerId) break;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function coldOnly(channelId: string): boolean {
  const until = coldUntil.get(channelId);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  coldUntil.delete(channelId);
  return false;
}

function release(entry: HotEntry): void {
  entry.unsubscribe();
  void stopLocalRemux(entry.token);
  void closeLiveStream(entry.details.LiveStreamId);
}

/** Readiness from the segments cut, eviction on an engine failure. */
function watch(entry: HotEntry): void {
  const stopThroughput = subscribeEngineThroughput(entry.token, () => {
    entry.segmentsCut += 1;
    if (entry.segmentsCut >= READY_SEGMENTS) entry.ready = true;
  });
  const stopFailure = subscribeEngineFailure(entry.token, (failure) => {
    if (hot.get(entry.channelId) !== entry) return;
    hot.delete(entry.channelId);
    release(entry);
    coldUntil.set(entry.channelId, Date.now() + COLD_ONLY_MS);
    logger.info("Live ring: neighbour's engine failed, left cold", { service: "LiveRing", channel: entry.details.Name, message: failure.message });
  });
  entry.unsubscribe = () => {
    stopThroughput();
    stopFailure();
  };
}

/** Sessions off the ring go; past the cap, the oldest go first. The center is never trimmed. */
function trim(): void {
  for (const [id, entry] of hot) {
    if (id === center || wanted.has(id)) continue;
    hot.delete(id);
    release(entry);
  }
  for (const [id, entry] of hot) {
    if (hot.size <= MAX_HOT) break;
    if (id === center) continue;
    hot.delete(id);
    release(entry);
  }
}

async function heat(channelId: string): Promise<void> {
  const mine = ++generation;
  starting.set(channelId, mine);
  // The center counts: a flip recenters before its player asks, and trim() keeps the center for it.
  const current = () => active && starting.get(channelId) === mine && (wanted.has(channelId) || claims.has(channelId) || center === channelId);
  let details: JellyfinVideoItem | null = null;
  let token: string | null = null;
  try {
    details = await resolveChannel(channelId, undefined, { quiet: true });
    if (!current()) {
      void closeLiveStream(details.LiveStreamId);
      return;
    }
    if (!details.liveStreamUrl || !(await canRemuxLocally(details, { record: false }))) {
      // Nothing for the engine to hold. The warm ring opens it when the server is its lane.
      coldUntil.set(channelId, Date.now() + COLD_ONLY_MS);
      void closeLiveStream(details.LiveStreamId);
      return;
    }
    const url = await startLocalRemux(details, undefined, undefined, { prewarm: true, liveWindowSeconds: HOT_WINDOW_SECONDS });
    token = localRemuxToken(url);
    if (!token || !current()) {
      void stopLocalRemux(token);
      void closeLiveStream(details.LiveStreamId);
      return;
    }
    const claim = claims.get(channelId);
    if (claim) {
      claims.delete(channelId);
      void setLiveWindow(token, PLAYING_WINDOW_SECONDS);
      claim({ channelId, details, url, token, ready: false });
      logger.info("Live ring: flip took a neighbour still starting", { service: "LiveRing", channel: details.Name });
      return;
    }
    const entry: HotEntry = { channelId, details, url, token, segmentsCut: 0, ready: false, unsubscribe: () => {} };
    watch(entry);
    hot.set(channelId, entry);
    trim();
    logger.info("Live ring: neighbour started", { service: "LiveRing", channel: details.Name });
  } catch (error) {
    noteOpenFailed(channelId);
    void stopLocalRemux(token);
    if (details) void closeLiveStream(details.LiveStreamId);
    logger.info("Live ring: neighbour did not open, left out", { service: "LiveRing", channelId, error: String(error) });
  } finally {
    if (starting.get(channelId) === mine) {
      starting.delete(channelId);
      // A flip waiting on a start that handed it nothing opens its own.
      claims.get(channelId)?.(null);
      claims.delete(channelId);
    }
  }
}

/**
 * Move the ring onto `centerId`. Server-lane channels open at once; the engine neighbours start only
 * while the center plays, so a burst of swipes does not start a session per channel passed.
 */
export function recenterLiveRing(ring: { Id: string }[], centerId: string, playing: boolean): void {
  active = true;
  center = centerId;
  wanted = new Set(ringAround(ring, centerId, HOT_RADIUS).filter((id) => !coldOnly(id)));
  trim();
  if (playing) {
    for (const id of wanted) {
      if (!hot.has(id) && !starting.has(id) && !openRecentlyFailed(id)) void heat(id);
    }
  }
  const warm = ringAround(ring, centerId, WARM_RADIUS).filter((id) => isServerLaneChannel(id) && !hot.has(id) && !(playing && wanted.has(id)) && !openRecentlyFailed(id));
  for (const id of warm) void warmChannel(id);
  void closeWarmedChannels(warm);
}

/** Whether a flip to this channel binds a session that has already cut a segment. */
export function isHotChannel(channelId: string): boolean {
  return hot.get(channelId)?.ready === true;
}

/**
 * Hands the ring's session for this channel to the player that plays it, ready or still cutting its
 * first segments, or waits for one still starting; null when the ring has none. The player owns its
 * teardown from here, so a flip never opens the origin a second time.
 */
export function takeRingSession(channelId: string): Promise<RingSession | null> {
  const entry = hot.get(channelId);
  if (entry) {
    hot.delete(channelId);
    entry.unsubscribe();
    void setLiveWindow(entry.token, PLAYING_WINDOW_SECONDS);
    logger.info(entry.ready ? "Live ring: flip bound a hot session" : "Live ring: flip took a neighbour still cutting its first segments", { service: "LiveRing", channel: entry.details.Name });
    return Promise.resolve({ channelId: entry.channelId, details: entry.details, url: entry.url, token: entry.token, ready: entry.ready });
  }
  if (!starting.has(channelId)) return Promise.resolve(null);
  return new Promise((resolve) => {
    claims.get(channelId)?.(null);
    claims.set(channelId, resolve);
  });
}

/** Keeps a channel the player left, still cutting segments, so flipping back is instant. False: stop it. */
export function retainLiveSession(channel: HotChannel): boolean {
  if (!active || hot.has(channel.channelId)) return false;
  const entry: HotEntry = { ...channel, segmentsCut: READY_SEGMENTS, ready: true, unsubscribe: () => {} };
  watch(entry);
  hot.set(channel.channelId, entry);
  trim();
  if (hot.get(channel.channelId) !== entry) return true;
  void setLiveWindow(channel.token, HOT_WINDOW_SECONDS);
  return true;
}

/** The player is gone: every session and every server open the ring holds is closed. */
export async function releaseLiveRing(): Promise<void> {
  active = false;
  center = null;
  wanted = new Set();
  starting.clear();
  for (const claim of claims.values()) claim(null);
  claims.clear();
  generation += 1;
  const entries = [...hot.values()];
  hot.clear();
  for (const entry of entries) release(entry);
  await closeWarmedChannels();
}
