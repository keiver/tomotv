/**
 * A burst of frames for every channel card in view, one channel at a time. A manifest channel is
 * read at its origin; a channel the server carries is opened on the server for the burst and closed
 * right after, since an open the server counts outlives any app that dies and writes the channel to
 * the server's disk while it lasts. Stands down while the screen is away, the app is in the
 * background or playback holds the link.
 */
import { closeLiveStream, openChannel, openRecentlyFailed, resolveChannelOrigin, type ChannelOrigin } from "@/services/jellyfinApi";
import { isLocalRemuxAvailable } from "@/services/localRemux";
import { isPlaybackHeld, onPlaybackHoldReleased, onPlaybackHoldTaken } from "@/services/playbackHold";
import { logger } from "@/utils/logger";
import { AppState, NativeModules } from "react-native";

const { LocalRemuxer } = NativeModules;

/** A channel is asked again this soon after its picture moved; its burst plays across the wait. */
export const LIVE_FRAME_REFRESH_MS = 60_000;
/** A channel whose live edge has not moved waits twice as long each time, up to this. */
export const LIVE_FRAME_REFRESH_CAP_MS = 300_000;
/** The link breathes between grabs. */
export const LIVE_FRAME_SPACING_MS = 1_000;
/** One open reads this long after its first keyframe, a picture a second. */
export const LIVE_FRAME_BURST_S = 8;
export const LIVE_FRAME_BURST_INTERVAL_S = 1;
export const LIVE_FRAME_BURST_COUNT = 8;
/** Wall clock per grab, the keyframe wait included; the engine's watchdog stops the read at it. */
export const LIVE_FRAME_DEADLINE_S = 12;
/** A failed channel waits this long, doubling per failure, up to the cap. */
export const LIVE_FRAME_RETRY_MS = 120_000;
export const LIVE_FRAME_RETRY_CAP_MS = 600_000;
/** The card's crossfade between two frames of a burst. */
export const LIVE_FRAME_TRANSITION_MS = 400;

export interface LiveFrame {
  uri: string;
  cacheKey: string;
}

/** One grab's pictures in order and when they were taken; the card walks them until the next grab. */
interface Burst {
  frames: LiveFrame[];
  at: number;
}

interface Entry {
  /** When the last grab started; 0 before any. */
  lastAt: number;
  /** How long after `lastAt` the channel is due; the refresh floor until its picture stands still. */
  intervalMs?: number;
  burst?: Burst;
  /** The frame of the burst the card was last told about. */
  shownIndex?: number;
  /** The shown burst's keyframe timestamp: the engine answers unchanged while the live edge is still on it. */
  pts?: number;
  /** The frame pool was asked for this channel's last burst: a reload keeps the pictures it had. */
  seeded?: boolean;
  lane?: "origin" | "server";
  origin?: ChannelOrigin;
  failure?: { at: number; attempts: number };
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
/** A seed from disk in flight; a viewable set that changes while it runs waits for it. */
let seeding: Promise<void> | null = null;
/** The guide's channel column or the channel wall: whichever is the screen feeds the sampler. */
export type LiveFrameSurface = "guide" | "wall";

/** Channels in view on the active surface, in its order, plus the lookahead row. */
let viewable: string[] = [];
/** Each surface's last reported set; the one that turns active plays its set back. */
const viewableBySurface = new Map<LiveFrameSurface, string[]>();
let activeSurface: LiveFrameSurface | null = null;
let appActive = AppState.currentState !== "background" && AppState.currentState !== "inactive";
/** The channel a grab is reading now, so playback taking the link can stop it. */
let grabbing: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Walks every burst on screen; runs only while a surface shows one with more than one frame. */
let ticker: ReturnType<typeof setInterval> | null = null;
let wired = false;
/** Bumped by every clear, so a grab that outlived one writes nothing back. */
let generation = 0;

function wire(): void {
  if (wired) return;
  wired = true;
  AppState.addEventListener("change", (state) => {
    appActive = state === "active";
    if (appActive) schedule(0);
    else stop();
  });
  onPlaybackHoldReleased(() => schedule(0));
  // A channel opening needs the whole link: the grab reading now is stopped, not waited out.
  onPlaybackHoldTaken(() => {
    stop();
    cancelGrab();
  });
}

function running(): boolean {
  return activeSurface !== null && appActive && !isPlaybackHeld() && viewable.length > 0 && isLocalRemuxAvailable();
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function cancelGrab(): void {
  if (grabbing) void LocalRemuxer?.cancelLiveFrame?.(grabbing)?.catch(() => {});
}

function schedule(delayMs: number): void {
  stop();
  if (!running()) return;
  timer = setTimeout(() => {
    timer = null;
    void pump();
  }, delayMs);
}

function entry(channelId: string): Entry {
  let found = entries.get(channelId);
  if (!found) {
    found = { lastAt: 0 };
    entries.set(channelId, found);
  }
  return found;
}

function notify(channelId: string): void {
  for (const listener of listeners.get(channelId) ?? []) listener();
}

/** The grab time a frame file's name carries (`live-<ms>-<i>.jpg`), 0 for a name without one. */
function stampOf(uri: string): number {
  const match = /live-(\d+)(?:-\d+)?\.jpg$/.exec(uri);
  return match ? Number(match[1]) : 0;
}

function burstOf(channelId: string, uris: string[], at: number): Burst {
  return { at, frames: uris.map((uri, index) => ({ uri, cacheKey: `live-${channelId}-${at}-${index}` })) };
}

/** Which frame of a burst the card shows now: the burst spread evenly across the refresh. */
function frameIndex(burst: Burst, now: number): number {
  if (burst.frames.length <= 1) return 0;
  const slice = LIVE_FRAME_REFRESH_MS / burst.frames.length;
  return Math.floor(Math.max(0, now - burst.at) / slice) % burst.frames.length;
}

function tick(): void {
  const now = Date.now();
  let walking = false;
  for (const channelId of viewable) {
    const item = entries.get(channelId);
    if (!item?.burst || item.burst.frames.length <= 1) continue;
    walking = true;
    const index = frameIndex(item.burst, now);
    if (index === item.shownIndex) continue;
    item.shownIndex = index;
    notify(channelId);
  }
  if (!walking) stopTicker();
}

function startTicker(): void {
  if (ticker || activeSurface === null) return;
  ticker = setInterval(tick, 1_000);
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/**
 * Channels in view the pool has not been asked about: their newest burst on disk stands in
 * until a grab replaces it, and its time is what the refresh counts from.
 */
async function seedFromDisk(): Promise<void> {
  const asking = viewable.filter((channelId) => !entry(channelId).seeded);
  if (asking.length === 0 || typeof LocalRemuxer?.liveFramesOnDisk !== "function") return;
  for (const channelId of asking) entry(channelId).seeded = true;
  const gen = generation;
  try {
    const found: Record<string, string[]> = (await LocalRemuxer.liveFramesOnDisk(asking)) ?? {};
    if (gen !== generation) return;
    for (const [channelId, uris] of Object.entries(found)) {
      const item = entry(channelId);
      if (item.burst || uris.length === 0) continue;
      const at = stampOf(uris[0]);
      item.burst = burstOf(channelId, uris, at);
      item.shownIndex = undefined;
      item.lastAt = Math.max(item.lastAt, at);
      notify(channelId);
    }
    startTicker();
  } catch (error) {
    logger.debug("Live frames on disk unreadable", { service: "LiveFrames", error: String(error) });
  }
}

function backoffUntil(failure: Entry["failure"]): number {
  if (!failure) return 0;
  return failure.at + Math.min(LIVE_FRAME_RETRY_MS * 2 ** (failure.attempts - 1), LIVE_FRAME_RETRY_CAP_MS);
}

function recordFailure(item: Entry, now: number): void {
  item.failure = { at: now, attempts: (item.failure?.attempts ?? 0) + 1 };
}

/** The channel due next: the one longest without a burst, once its refresh and any backoff have passed. */
function nextDue(now: number): { channelId: string; waitMs: number } | null {
  let pick: { channelId: string; readyAt: number } | null = null;
  for (const channelId of viewable) {
    const item = entry(channelId);
    const readyAt = Math.max(item.lastAt + (item.intervalMs ?? LIVE_FRAME_REFRESH_MS), backoffUntil(item.failure));
    if (!pick || readyAt < pick.readyAt) pick = { channelId, readyAt };
  }
  return pick ? { channelId: pick.channelId, waitMs: Math.max(0, pick.readyAt - now) } : null;
}

async function pump(): Promise<void> {
  if (!running() || grabbing) return;
  if (!seeding) seeding = seedFromDisk().finally(() => (seeding = null));
  await seeding;
  if (!running() || grabbing) return;
  const now = Date.now();
  const due = nextDue(now);
  if (!due || due.waitMs > 0) {
    if (due) schedule(due.waitMs);
    return;
  }
  grabbing = due.channelId;
  try {
    await grab(due.channelId);
  } finally {
    grabbing = null;
    schedule(LIVE_FRAME_SPACING_MS);
  }
}

interface GrabInput {
  url: string;
  headers?: Record<string, string>;
  /** Releases the server's open once the burst is read; nothing for an origin read. */
  close?: () => void;
}

/** The stream a grab reads for the channel, or null when nothing can be read now. */
async function inputFor(channelId: string, item: Entry): Promise<GrabInput | null> {
  if (!item.lane) {
    const origin = await resolveChannelOrigin(channelId);
    item.lane = origin ? "origin" : "server";
    item.origin = origin ?? undefined;
  }
  if (item.lane === "origin") return item.origin ?? null;
  // The server carries this channel: opened for this burst alone, closed the moment it is read.
  if (openRecentlyFailed(channelId)) return null;
  const opened = await openChannel(channelId, undefined, { quiet: true });
  const close = () => void closeLiveStream(opened.LiveStreamId);
  if (!opened.liveStreamUrl) {
    close();
    return null;
  }
  return { url: opened.liveStreamUrl, close };
}

async function grab(channelId: string): Promise<void> {
  const item = entry(channelId);
  const now = Date.now();
  item.lastAt = now;
  const gen = generation;
  let input: GrabInput | null = null;
  try {
    input = await inputFor(channelId, item);
    // A surface left while the open ran: a cancel sent then met no read, so the open closes here.
    if (gen !== generation || isPlaybackHeld() || activeSurface === null) return;
    if (!input) {
      recordFailure(item, now);
      return;
    }
    const result: { uris?: string[] | null; pts?: number | null; unchanged?: boolean; cancelled?: boolean; reason?: string } = await LocalRemuxer.liveFrame({
      channelId,
      inputUrl: input.url,
      httpHeaders: input.headers ?? {},
      deadline: LIVE_FRAME_DEADLINE_S,
      span: LIVE_FRAME_BURST_S,
      interval: LIVE_FRAME_BURST_INTERVAL_S,
      count: LIVE_FRAME_BURST_COUNT,
      shownPts: item.burst ? item.pts : undefined,
    });
    if (gen !== generation || result?.cancelled) return;
    if (result?.unchanged) {
      item.intervalMs = Math.min((item.intervalMs ?? LIVE_FRAME_REFRESH_MS) * 2, LIVE_FRAME_REFRESH_CAP_MS);
      item.failure = undefined;
    } else if (result?.uris?.length) {
      item.burst = burstOf(channelId, result.uris, now);
      item.shownIndex = 0;
      item.pts = result.pts ?? undefined;
      item.intervalMs = LIVE_FRAME_REFRESH_MS;
      item.failure = undefined;
      notify(channelId);
      startTicker();
    } else {
      recordFailure(item, now);
    }
  } catch (error) {
    if (gen !== generation) return;
    recordFailure(item, now);
    logger.debug("Live frame failed", { service: "LiveFrames", channelId, error: String(error) });
  } finally {
    input?.close?.();
  }
}

function applyViewable(channelIds: string[]): void {
  viewable = channelIds;
  if (running()) schedule(0);
  else stop();
}

/** The rows in view on a surface, in order. Applied at once on the active surface, kept for the others. */
export function setLiveFrameViewable(surface: LiveFrameSurface, channelIds: string[]): void {
  viewableBySurface.set(surface, channelIds);
  if (surface === activeSurface) applyViewable(channelIds);
}

/** The surface turning active takes over with its set; one leaving after another took over changes nothing. */
export function setLiveFramesActive(surface: LiveFrameSurface, active: boolean): void {
  wire();
  if (active) {
    activeSurface = surface;
    applyViewable(viewableBySurface.get(surface) ?? []);
    startTicker();
    return;
  }
  if (activeSurface !== surface) return;
  activeSurface = null;
  stop();
  stopTicker();
  // The read in flight is stopped, so its server open closes now rather than at its deadline.
  cancelGrab();
}

/** The channel's frame for now: the burst spread across the refresh, one picture at a time. */
export function liveFrameFor(channelId: string): LiveFrame | undefined {
  const burst = entries.get(channelId)?.burst;
  return burst ? burst.frames[frameIndex(burst, Date.now())] : undefined;
}

export function subscribeLiveFrame(channelId: string, listener: () => void): () => void {
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

/** Channel ids repeat across servers: a switch drops every frame and the lanes they were read on. */
export function clearLiveFrames(): void {
  generation += 1;
  const cleared = [...entries.keys()];
  entries.clear();
  stopTicker();
  for (const channelId of cleared) notify(channelId);
}
