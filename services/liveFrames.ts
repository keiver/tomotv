/**
 * A burst of frames for every channel card in view, one channel at a time. A manifest channel is
 * read at its origin; a channel the server carries is opened on the server for the burst and closed
 * right after, since an open the server counts outlives any app that dies and writes the channel to
 * the server's disk while it lasts. Stands down while the screen is away, the app is in the
 * background or playback holds the link.
 */
import { clearChannelHealth, noteChannelAlive, noteChannelOpenFailure } from "@/services/channelHealth";
import { closeLiveStream, openChannel, openRecentlyFailed, resolveChannelOrigin, type ChannelOrigin } from "@/services/jellyfinApi";
import { isLocalRemuxAvailable, nativeEmits } from "@/services/localRemux";
import { isPlaybackHeld, onPlaybackHoldReleased, onPlaybackHoldTaken } from "@/services/playbackHold";
import { logger } from "@/utils/logger";
import { AppState, NativeEventEmitter, NativeModules } from "react-native";

const { LocalRemuxer } = NativeModules;

/** A channel is asked again this soon after its picture moved; its burst loops across the wait. */
export const LIVE_FRAME_REFRESH_MS = 120_000;
/** A channel whose live edge has not moved waits twice as long each time, up to this. */
export const LIVE_FRAME_REFRESH_CAP_MS = 300_000;
/** The link breathes between grabs. */
export const LIVE_FRAME_SPACING_MS = 1_000;
/** One open covers this much stream time after its first keyframe, a keyframe per interval. */
export const LIVE_FRAME_BURST_S = 36;
export const LIVE_FRAME_BURST_INTERVAL_S = 3;
export const LIVE_FRAME_BURST_COUNT = 12;
/** Wall clock per grab, the keyframe wait included; the engine's watchdog stops the read at it. */
export const LIVE_FRAME_DEADLINE_S = 12;
/**
 * A channel with no picture yet takes a short grab: the same single open, a few frames, the
 * slot freed in half the time, so a cold wall paints in view order fast. Its full burst comes
 * with the normal refresh; no channel is ever opened twice for one cycle.
 */
export const LIVE_FRAME_COLD_COUNT = 4;
export const LIVE_FRAME_COLD_SPAN_S = 9;
export const LIVE_FRAME_COLD_DEADLINE_S = 6;
/**
 * Opens refused this many times in a row read as a provider's concurrent-stream cap, not dead
 * channels: the sampler rests instead of walking every card through a refusal. Playback is
 * never in the contest; grabs already stand down while it holds the link.
 */
export const LIVE_FRAME_CAP_TRIP = 3;
export const LIVE_FRAME_CAP_COOLDOWN_MS = 180_000;
/** A failed channel waits this long, doubling per failure, up to the cap. */
export const LIVE_FRAME_RETRY_MS = 120_000;
export const LIVE_FRAME_RETRY_CAP_MS = 600_000;
/** The card holds each frame of a burst this long, looping until the next grab. */
export const LIVE_FRAME_DWELL_MS = 3_000;
/** The card's crossfade between two frames of a burst. */
export const LIVE_FRAME_TRANSITION_MS = 400;
/** A row focused this long promotes its channel to the front of the sampler. */
export const LIVE_FRAME_FOCUS_DWELL_MS = 2_000;
/** The promoted channel's own refresh floor, well under the ordinary one. */
export const LIVE_FRAME_FOCUS_REFRESH_MS = 30_000;
/**
 * A burst older than this no longer shows: a healthy channel refreshes within minutes, so
 * past it the pictures are stale, not live. An `unchanged` answer re-dates the burst, so a
 * genuinely still live edge never expires while it keeps being verified.
 */
export const LIVE_FRAME_EXPIRY_MS = 30 * 60_000;

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
  /** The burst aged past the display gate and the cards were told once; the reel keeps it. */
  expiredAnnounced?: boolean;
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
/** Grabs at once; the native queue serializes same-host jobs itself. */
const MAX_INFLIGHT = 2;
/** Channels grabs are reading now, each with the generation it started in. */
const grabbing = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Walks every burst on screen; runs only while a surface shows one with more than one frame. */
let ticker: ReturnType<typeof setInterval> | null = null;
let wired = false;
/** Bumped by every clear, so a grab that outlived one writes nothing back. */
let generation = 0;
/** Consecutive refused opens; any open that succeeds resets it. */
let openFailStreak = 0;
/** The sampler rests until this passes once the streak trips. */
let capRestUntil = 0;
/** The row holding focus, and the channel it promoted once the dwell passed. */
let focusCandidate: string | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;
let priority: string | null = null;

function noteOpenFailure(): void {
  openFailStreak += 1;
  if (openFailStreak >= LIVE_FRAME_CAP_TRIP && Date.now() >= capRestUntil) {
    capRestUntil = Date.now() + LIVE_FRAME_CAP_COOLDOWN_MS;
    logger.info("Live frame opens refused in a row, sampler resting", { service: "LiveFrames", streak: openFailStreak, restMs: LIVE_FRAME_CAP_COOLDOWN_MS });
  }
}

/** A frame the running grab just wrote: it joins the channel's burst at once, ahead of the rest. */
function onLiveFrameEvent(event: { channelId?: string; uri?: string; index?: number }): void {
  const { channelId, uri, index } = event;
  if (!channelId || !uri || typeof index !== "number") return;
  if (grabbing.get(channelId) !== generation) return;
  const item = entries.get(channelId);
  if (!item) return;
  if (index === 0) {
    item.burst = burstOf(channelId, [uri], item.lastAt);
    item.expiredAnnounced = false;
    item.shownIndex = 0;
  } else {
    // Appends in order only; anything missed is reconciled when the grab resolves. Replaced,
    // never pushed: subscribers' snapshot is the burst object, and a same-object mutation
    // renders nowhere (useSyncExternalStore bails on identity).
    if (!item.burst || item.burst.at !== item.lastAt || index !== item.burst.frames.length) return;
    item.burst = { at: item.burst.at, frames: [...item.burst.frames, { uri, cacheKey: `live-${channelId}-${item.burst.at}-${index}` }] };
  }
  notify(channelId);
  startTicker();
}

function wire(): void {
  if (wired) return;
  wired = true;
  if (nativeEmits("onLiveFrame")) {
    new NativeEventEmitter(LocalRemuxer).addListener("onLiveFrame", onLiveFrameEvent);
  }
  AppState.addEventListener("change", (state) => {
    if (state === "active") schedule(0);
    else stop();
  });
  onPlaybackHoldReleased(() => schedule(0));
  // A channel opening needs the whole link: the grab reading now is stopped, not waited out.
  onPlaybackHoldTaken(() => {
    stop();
    cancelGrabs();
  });
}

/** Read live: a release bundle evaluates this module while launch is still "inactive", before any listener is wired. */
function appActive(): boolean {
  return AppState.currentState !== "background" && AppState.currentState !== "inactive";
}

function running(): boolean {
  return activeSurface !== null && appActive() && !isPlaybackHeld() && viewable.length > 0 && isLocalRemuxAvailable();
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function cancelGrabs(keep?: readonly string[]): void {
  for (const channelId of grabbing.keys()) {
    if (!keep?.includes(channelId)) void LocalRemuxer?.cancelLiveFrame?.(channelId)?.catch(() => {});
  }
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

function expired(burst: Burst, now: number): boolean {
  return now - burst.at > LIVE_FRAME_EXPIRY_MS;
}

/** Which frame of a burst the card shows now: one per dwell, looping until the next grab. */
function frameIndex(burst: Burst, now: number): number {
  if (burst.frames.length <= 1) return 0;
  return Math.floor(Math.max(0, now - burst.at) / LIVE_FRAME_DWELL_MS) % burst.frames.length;
}

function tick(): void {
  const now = Date.now();
  let walking = false;
  for (const channelId of viewable) {
    const item = entries.get(channelId);
    if (!item?.burst) continue;
    // Past the display gate the cards repaint to their placeholder once; the burst itself stays
    // for the reel, which places history by its grab time.
    if (expired(item.burst, now)) {
      if (!item.expiredAnnounced) {
        item.expiredAnnounced = true;
        item.shownIndex = undefined;
        item.pts = undefined;
        notify(channelId);
      }
      continue;
    }
    if (item.burst.frames.length <= 1) continue;
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
      // A stale burst from a past run stays off screen; the channel is due at once instead.
      if (Date.now() - at > LIVE_FRAME_EXPIRY_MS) continue;
      item.burst = burstOf(channelId, uris, at);
      item.expiredAnnounced = false;
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

/** The channel due next: the promoted one on its short floor first, else the one longest
 *  without a burst once its refresh and any backoff have passed. Backoff binds them both:
 *  staring at a dead channel never hammers it. */
function nextDue(now: number): { channelId: string; waitMs: number } | null {
  if (priority && viewable.includes(priority) && !grabbing.has(priority)) {
    const item = entry(priority);
    const readyAt = Math.max(item.lastAt + LIVE_FRAME_FOCUS_REFRESH_MS, backoffUntil(item.failure));
    if (readyAt <= now) return { channelId: priority, waitMs: 0 };
  }
  let pick: { channelId: string; readyAt: number } | null = null;
  for (const channelId of viewable) {
    if (grabbing.has(channelId)) continue;
    const item = entry(channelId);
    const readyAt = Math.max(item.lastAt + (item.intervalMs ?? LIVE_FRAME_REFRESH_MS), backoffUntil(item.failure));
    if (!pick || readyAt < pick.readyAt) pick = { channelId, readyAt };
  }
  return pick ? { channelId: pick.channelId, waitMs: Math.max(0, pick.readyAt - now) } : null;
}

/** The row holding focus names its channel; after the dwell it jumps the queue. Null on leave. */
export function setLiveFrameFocus(channelId: string | null): void {
  if (focusCandidate === channelId) return;
  focusCandidate = channelId;
  priority = null;
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = null;
  if (!channelId) return;
  focusTimer = setTimeout(() => {
    focusTimer = null;
    priority = channelId;
    if (running()) schedule(0);
  }, LIVE_FRAME_FOCUS_DWELL_MS);
}

/** A blur that may land after the next row's focus: clears only its own claim. */
export function clearLiveFrameFocus(channelId: string): void {
  if (focusCandidate === channelId) setLiveFrameFocus(null);
}

async function pump(): Promise<void> {
  if (!running() || grabbing.size >= MAX_INFLIGHT) return;
  if (!seeding) seeding = seedFromDisk().finally(() => (seeding = null));
  await seeding;
  if (!running() || grabbing.size >= MAX_INFLIGHT) return;
  const now = Date.now();
  if (now < capRestUntil) {
    schedule(capRestUntil - now);
    return;
  }
  const due = nextDue(now);
  if (!due || due.waitMs > 0) {
    if (due) schedule(due.waitMs);
    return;
  }
  grabbing.set(due.channelId, generation);
  void grab(due.channelId).finally(() => {
    grabbing.delete(due.channelId);
    schedule(LIVE_FRAME_SPACING_MS);
  });
  // The next slot, a breath later, so grab starts never land as a burst of opens.
  schedule(LIVE_FRAME_SPACING_MS);
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
  const wasDueAt = item.lastAt;
  item.lastAt = now;
  const gen = generation;
  // No picture yet: the short first-paint profile; the refresh upgrades to the full burst.
  const cold = !item.burst;
  let input: GrabInput | null = null;
  try {
    input = await inputFor(channelId, item);
    // A surface left while the open ran: a cancel sent then met no read, so the open closes here.
    if (gen !== generation || isPlaybackHeld() || activeSurface === null) return;
    if (!input) {
      recordFailure(item, now);
      noteOpenFailure();
      return;
    }
    const result: { uris?: string[] | null; pts?: number | null; unchanged?: boolean; cancelled?: boolean; reason?: string; failure?: string | null } = await LocalRemuxer.liveFrame({
      channelId,
      inputUrl: input.url,
      httpHeaders: input.headers ?? {},
      deadline: cold ? LIVE_FRAME_COLD_DEADLINE_S : LIVE_FRAME_DEADLINE_S,
      span: cold ? LIVE_FRAME_COLD_SPAN_S : LIVE_FRAME_BURST_S,
      interval: LIVE_FRAME_BURST_INTERVAL_S,
      count: cold ? LIVE_FRAME_COLD_COUNT : LIVE_FRAME_BURST_COUNT,
      shownPts: item.burst ? item.pts : undefined,
    });
    if (gen !== generation) return;
    if (result?.cancelled) {
      // An attempt cancelled before any frame landed leaves the channel due, not on a full wait.
      if (!item.burst || item.burst.at !== now) item.lastAt = wasDueAt;
      return;
    }
    if (result?.unchanged) {
      // The live edge was just verified on these pictures, so their expiry counts from now.
      if (item.burst) item.burst.at = now;
      item.intervalMs = Math.min((item.intervalMs ?? LIVE_FRAME_REFRESH_MS) * 2, LIVE_FRAME_REFRESH_CAP_MS);
      item.failure = undefined;
      openFailStreak = 0;
      noteChannelAlive(channelId);
    } else if (result?.uris?.length) {
      item.burst = burstOf(channelId, result.uris, now);
      item.expiredAnnounced = false;
      item.shownIndex = 0;
      item.pts = result.pts ?? undefined;
      item.intervalMs = LIVE_FRAME_REFRESH_MS;
      item.failure = undefined;
      openFailStreak = 0;
      noteChannelAlive(channelId);
      notify(channelId);
      startTicker();
    } else {
      recordFailure(item, now);
      // "open" is a refusal at the source, the cap's signature; "frame" opened fine.
      if (result?.reason === "open") {
        noteOpenFailure();
        // The origin's own words judge the channel, and never while the cap is suspected.
        if (item.lane === "origin" && Date.now() >= capRestUntil) noteChannelOpenFailure(channelId, result.failure ?? undefined);
      } else openFailStreak = 0;
    }
  } catch (error) {
    if (gen !== generation) return;
    recordFailure(item, now);
    noteOpenFailure();
    logger.debug("Live frame failed", { service: "LiveFrames", channelId, error: String(error) });
  } finally {
    input?.close?.();
  }
}

function applyViewable(channelIds: string[]): void {
  viewable = channelIds;
  // Grabs for cards that scrolled away free their slots; frames they already wrote stay.
  cancelGrabs(channelIds);
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
  setLiveFrameFocus(null);
  stop();
  stopTicker();
  // The reads in flight are stopped, so their server opens close now rather than at their deadlines.
  cancelGrabs();
}

/** Resolves once no grab is in flight and none is due within a beat, or at the wait's cap:
 *  bulk work (a guide file download) yields the link to the sampler's first paint. */
export function whenSamplerQuiet(maxWaitMs: number): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  return new Promise((resolve) => {
    const check = () => {
      const idle = grabbing.size === 0 && (nextDue(Date.now())?.waitMs ?? Infinity) > 2_000;
      if (idle || Date.now() >= deadline || !running()) resolve();
      else setTimeout(check, 1_500);
    };
    check();
  });
}

/** The channel's frame for now: the burst spread across the refresh, one picture at a time. */
export function liveFrameFor(channelId: string): LiveFrame | undefined {
  const burst = entries.get(channelId)?.burst;
  const now = Date.now();
  if (!burst || expired(burst, now)) return undefined;
  return burst.frames[frameIndex(burst, now)];
}

/** The channel's whole burst in grab order with when it was taken, for the focus reel. Expiry
 *  does not gate it: the reel is history and places itself by the grab's time on the timeline. */
export function liveFrameReel(channelId: string): { frames: LiveFrame[]; at: number } | undefined {
  return entries.get(channelId)?.burst;
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
  openFailStreak = 0;
  capRestUntil = 0;
  stopTicker();
  clearChannelHealth();
  for (const channelId of cleared) notify(channelId);
}
