/**
 * A fresh frame for every channel card in view, one grab at a time. A manifest channel is read at
 * its origin; a channel the server carries is sampled off a warm open held while its row is in
 * view. Stands down while the screen is away, the app is in the background or playback holds the link.
 */
import { closeWarmedChannels, openRecentlyFailed, resolveChannelOrigin, warmChannel, warmedChannelCount, warmedStreamUrl, type ChannelOrigin } from "@/services/jellyfinApi";
import { isLocalRemuxAvailable } from "@/services/localRemux";
import { isPlaybackHeld, onPlaybackHoldReleased } from "@/services/playbackHold";
import { logger } from "@/utils/logger";
import { AppState, NativeModules } from "react-native";

const { LocalRemuxer } = NativeModules;

/** A channel's frame is refreshed no sooner than this. */
export const LIVE_FRAME_REFRESH_MS = 60_000;
/** The link breathes between grabs. */
export const LIVE_FRAME_SPACING_MS = 1_000;
/** Wall clock per grab; the engine's watchdog stops the read at it. */
export const LIVE_FRAME_DEADLINE_S = 8;
/** A failed channel waits this long, doubling per failure, up to the cap. */
export const LIVE_FRAME_RETRY_MS = 120_000;
export const LIVE_FRAME_RETRY_CAP_MS = 600_000;
/** Opens the server holds for the guide at once. */
export const LIVE_FRAME_HOLD_CAP = 8;
/** A held open outlives its row leaving view by this much, so a scroll back costs no reopen. */
export const LIVE_FRAME_HOLD_GRACE_MS = 30_000;

export interface LiveFrame {
  uri: string;
  cacheKey: string;
}

interface Entry {
  /** When the last grab started; 0 before any. */
  lastAt: number;
  frame?: LiveFrame;
  lane?: "origin" | "server";
  origin?: ChannelOrigin;
  failure?: { at: number; attempts: number };
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
/** Channels in view, in the column's order, plus the lookahead row. */
let viewable: string[] = [];
/** When each server-lane hold's row left view; cleared when it returns. */
const leftViewAt = new Map<string, number>();
let screenActive = false;
let appActive = AppState.currentState !== "background" && AppState.currentState !== "inactive";
let grabbing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
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
}

function running(): boolean {
  return screenActive && appActive && !isPlaybackHeld() && viewable.length > 0 && isLocalRemuxAvailable();
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
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

function backoffUntil(failure: Entry["failure"]): number {
  if (!failure) return 0;
  return failure.at + Math.min(LIVE_FRAME_RETRY_MS * 2 ** (failure.attempts - 1), LIVE_FRAME_RETRY_CAP_MS);
}

function recordFailure(item: Entry, now: number): void {
  item.failure = { at: now, attempts: (item.failure?.attempts ?? 0) + 1 };
}

/** The channel due next: the one longest without a frame, once its refresh and any backoff have passed. */
function nextDue(now: number): { channelId: string; waitMs: number } | null {
  let pick: { channelId: string; readyAt: number } | null = null;
  for (const channelId of viewable) {
    const item = entry(channelId);
    const readyAt = Math.max(item.lastAt + LIVE_FRAME_REFRESH_MS, backoffUntil(item.failure));
    if (!pick || readyAt < pick.readyAt) pick = { channelId, readyAt };
  }
  return pick ? { channelId: pick.channelId, waitMs: Math.max(0, pick.readyAt - now) } : null;
}

/** Holds whose rows are in view or left it inside the grace stay; the rest close. */
function trimHolds(now: number): void {
  const keep = new Set(viewable);
  for (const [channelId, at] of leftViewAt) {
    if (now - at < LIVE_FRAME_HOLD_GRACE_MS) keep.add(channelId);
    else leftViewAt.delete(channelId);
  }
  if (warmedChannelCount() > 0) void closeWarmedChannels(keep);
}

/** How long until the oldest hold out of view passes its grace; none pending, nothing to wait for. */
function nextTrimWait(now: number): number {
  let wait = Infinity;
  for (const at of leftViewAt.values()) wait = Math.min(wait, Math.max(0, at + LIVE_FRAME_HOLD_GRACE_MS - now));
  return wait;
}

async function pump(): Promise<void> {
  if (!running() || grabbing) return;
  const now = Date.now();
  trimHolds(now);
  const due = nextDue(now);
  if (!due || due.waitMs > 0) {
    const wait = Math.min(due?.waitMs ?? Infinity, nextTrimWait(now));
    if (Number.isFinite(wait)) schedule(wait);
    return;
  }
  grabbing = true;
  try {
    await grab(due.channelId);
  } finally {
    grabbing = false;
    schedule(LIVE_FRAME_SPACING_MS);
  }
}

/** The stream a grab reads for the channel, or null when nothing can be read now. */
async function inputFor(channelId: string, item: Entry, now: number): Promise<{ url: string; headers?: Record<string, string> } | null | "later"> {
  if (!item.lane) {
    const origin = await resolveChannelOrigin(channelId);
    item.lane = origin ? "origin" : "server";
    item.origin = origin ?? undefined;
  }
  if (item.lane === "origin") return item.origin ?? null;
  // The server carries this channel: its stream is read off a warm open held while the row is in view.
  const held = warmedStreamUrl(channelId);
  if (held) return { url: held };
  if (openRecentlyFailed(channelId)) return null;
  if (warmedChannelCount() >= LIVE_FRAME_HOLD_CAP) return "later";
  await warmChannel(channelId);
  const opened = warmedStreamUrl(channelId);
  if (opened) return { url: opened };
  // Warmed within the last two minutes elsewhere, or still opening: the next round asks again.
  return now === item.lastAt ? "later" : null;
}

async function grab(channelId: string): Promise<void> {
  const item = entry(channelId);
  const now = Date.now();
  item.lastAt = now;
  const gen = generation;
  try {
    const input = await inputFor(channelId, item, now);
    if (gen !== generation) return;
    if (input === "later") return;
    if (!input) {
      recordFailure(item, now);
      return;
    }
    const result: { uri?: string | null; cancelled?: boolean; reason?: string } = await LocalRemuxer.liveFrame({
      channelId,
      inputUrl: input.url,
      httpHeaders: input.headers ?? {},
      deadline: LIVE_FRAME_DEADLINE_S,
    });
    if (gen !== generation || result?.cancelled) return;
    if (result?.uri) {
      item.frame = { uri: result.uri, cacheKey: `live-${channelId}-${now}` };
      item.failure = undefined;
      notify(channelId);
    } else {
      recordFailure(item, now);
    }
  } catch (error) {
    if (gen !== generation) return;
    recordFailure(item, now);
    logger.debug("Live frame failed", { service: "LiveFrames", channelId, error: String(error) });
  }
}

/** The rows in view, in order, from the channel column. An empty list stops the pump. */
export function setLiveFrameViewable(channelIds: string[]): void {
  const now = Date.now();
  const next = new Set(channelIds);
  for (const channelId of viewable) if (!next.has(channelId) && entry(channelId).lane === "server") leftViewAt.set(channelId, now);
  for (const channelId of channelIds) leftViewAt.delete(channelId);
  viewable = channelIds;
  if (running()) schedule(0);
  else stop();
}

/** Whether the guide is on screen. Off, every hold closes and no grab runs. */
export function setLiveFramesActive(active: boolean): void {
  wire();
  screenActive = active;
  if (active) {
    schedule(0);
    return;
  }
  stop();
  leftViewAt.clear();
  if (warmedChannelCount() > 0) void closeWarmedChannels();
}

export function liveFrameFor(channelId: string): LiveFrame | undefined {
  return entries.get(channelId)?.frame;
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
  leftViewAt.clear();
  for (const channelId of cleared) notify(channelId);
}
