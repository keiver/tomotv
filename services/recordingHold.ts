/**
 * Server recordings on a one-connection provider: the engine learns which providers a recording reads and,
 * at a limit of 1, opens nothing on them.
 */
import { cancelTimer, createTimer, fetchInProgressRecording, fetchTimerDefaults, fetchTimers, readRecordingStart } from "@/services/jellyfinApi";
import { t } from "@/services/i18n";
import { getRecordingStatus, recordingWindow, refreshRecordingStatus, subscribeRecordingStatus } from "@/services/recordingStatus";
import { showToast } from "@/services/toast";
import type { JellyfinItem, JellyfinTimer } from "@/types/jellyfin";
import { activeRecordTimer, adjacentChannelId, isActiveTimer } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { originConnectionLimit, originConnections, originHeld, setOriginRecording, subscribeOriginHolds } from "@keiver/tomo-engine";
import { playlistChannelById, subscribePlaylistChannels } from "@keiver/tomo-live";

const WARN_AHEAD_MS = 60_000;
const PLAYING_REFRESH_MS = 60_000;
const DRAIN_TIMEOUT_MS = 10_000;
const PENDING_TTL_MS = 120_000;
const POLL_MS = 250;
/** MPEG-TS sync byte: the first byte of a recording that got the stream. */
const TS_SYNC = 0x47;
/** Cancels that found video, not a refusal: after this many the provider is slow to send, not refusing. */
const VIDEO_FLUSHES_TO_STOP = 2;

export function channelOrigin(channelId: string | null | undefined): string | null {
  return (channelId && playlistChannelById(channelId)?.originKey) || null;
}

/** Whether a recording held the channel's provider at the engine's last answer. */
export function channelHeld(channelId: string): boolean {
  return originHeld(channelOrigin(channelId));
}

/** The next channel in `direction` whose provider no recording holds; null when every other one is held. */
export function adjacentPlayableChannelId<T extends { Id: string }>(ring: T[], fromId: string, direction: 1 | -1, isHeld: (channelId: string) => boolean = channelHeld): string | null {
  let id: string | null = fromId;
  for (let step = 0; step < ring.length; step++) {
    id = adjacentChannelId(ring, id, direction);
    if (!id || id === fromId) return null;
    if (!isHeld(id)) return id;
  }
  return null;
}

let heldPredicate = (channelId: string) => channelHeld(channelId);

/** `channelHeld` as a value whose identity changes with every hold change, for a screen that skips held channels. */
export function getHeldPredicate(): (channelId: string) => boolean {
  return heldPredicate;
}

export function subscribeHolds(listener: () => void): () => void {
  return subscribeOriginHolds(() => {
    heldPredicate = (channelId: string) => channelHeld(channelId);
    listener();
  });
}

/** Recording now, or inside its padded span. */
function holdsNow(timer: JellyfinTimer, nowMs: number): boolean {
  if (!isActiveTimer(timer)) return false;
  if (timer.Status === "InProgress") return true;
  const { startMs, endMs } = recordingWindow(timer);
  return startMs <= nowMs && nowMs < endMs;
}

/** The providers a recording holds at `nowMs`. */
export function recordingOrigins(timers: JellyfinTimer[], nowMs: number): Set<string> {
  const origins = new Set<string>();
  for (const timer of timers) {
    const originKey = channelOrigin(timer.ChannelId);
    if (originKey && holdsNow(timer, nowMs)) origins.add(originKey);
  }
  return origins;
}

/** The next moment the held providers or a warning change by themselves; null when nothing is ahead. */
export function nextHoldEdge(timers: JellyfinTimer[], nowMs: number): number | null {
  let next: number | null = null;
  const consider = (edge: number) => {
    if (Number.isFinite(edge) && edge > nowMs && (next === null || edge < next)) next = edge;
  };
  for (const timer of timers) {
    if (!isActiveTimer(timer) || !channelOrigin(timer.ChannelId)) continue;
    const { startMs, endMs } = recordingWindow(timer);
    consider(startMs - WARN_AHEAD_MS);
    consider(startMs);
    consider(endMs);
  }
  return next;
}

/** The viewer's limit, else the one the engine learned from the provider's refusals. */
async function oneConnection(originKey: string): Promise<boolean> {
  if (originConnectionLimit(originKey) === 1) return true;
  return (await originConnections(originKey))?.budget === 1;
}

let pushed = new Set<string>();
const pending = new Map<string, number>();
const warned = new Set<string>();
/** Providers whose new recording is being checked for the stream, with the run that checks it. */
const checking = new Map<string, number>();
let checkRun = 0;
const checkListeners = new Set<() => void>();
let edgeTimer: ReturnType<typeof setTimeout> | null = null;

function clearEdge(): void {
  if (edgeTimer) clearTimeout(edgeTimer);
  edgeTimer = null;
}

function notifyChecks(): void {
  for (const listener of checkListeners) listener();
}

/** Tells the engine each provider a recording starts or stops holding, warns a minute ahead, and arms the next edge. */
export function syncRecordingHolds(nowMs = Date.now()): void {
  const { active, running } = getRecordingStatus();
  const runningOrigins = new Set(running.map((timer) => channelOrigin(timer.ChannelId)).filter((key): key is string => !!key));
  for (const [originKey, atMs] of pending) {
    if (runningOrigins.has(originKey) || nowMs - atMs >= PENDING_TTL_MS) pending.delete(originKey);
  }

  const next = recordingOrigins(active, nowMs);
  for (const originKey of pending.keys()) next.add(originKey);
  for (const originKey of checking.keys()) next.add(originKey);
  for (const originKey of next) {
    if (pushed.has(originKey)) continue;
    const starting = pending.has(originKey) || checking.has(originKey) ? null : active.find((timer) => channelOrigin(timer.ChannelId) === originKey && holdsNow(timer, nowMs));
    void holdOrigin(originKey, starting ?? null);
  }
  for (const originKey of pushed) if (!next.has(originKey)) void setOriginRecording(originKey, false);
  pushed = next;

  for (const timer of active) {
    if (!isActiveTimer(timer) || timer.Status === "InProgress" || warned.has(timer.Id)) continue;
    const originKey = channelOrigin(timer.ChannelId);
    const { startMs } = recordingWindow(timer);
    if (!originKey || nowMs < startMs - WARN_AHEAD_MS || nowMs >= startMs) continue;
    warned.add(timer.Id);
    void oneConnection(originKey).then((one) => {
      if (one) showToast({ title: t("player.limitedConnections"), message: t("liveTv.recordingSoon").replace("{channel}", timer.ChannelName ?? timer.Name) });
    });
  }

  clearEdge();
  const edges = [nextHoldEdge(active, nowMs), ...[...pending.values()].map((atMs) => atMs + PENDING_TTL_MS)].filter((edge): edge is number => edge !== null);
  if (edges.length > 0) edgeTimer = setTimeout(() => syncRecordingHolds(), Math.max(0, Math.min(...edges) - nowMs));
}

/** Holds the provider; a scheduled recording that starts while this device reads it is checked for the stream. */
async function holdOrigin(originKey: string, starting: JellyfinTimer | null): Promise<void> {
  const before = starting ? await originConnections(originKey) : null;
  await setOriginRecording(originKey, true);
  if (!starting || !before || before.active === 0 || before.budget !== 1) return;
  void checkRecording(originKey, starting, () => recreateTimer(starting));
}

export function watchRecordingHolds(): () => void {
  const stopStatus = subscribeRecordingStatus(() => syncRecordingHolds());
  const stopPlaylists = subscribePlaylistChannels(() => syncRecordingHolds());
  syncRecordingHolds();
  return () => {
    stopStatus();
    stopPlaylists();
    clearEdge();
  };
}

/** While a channel on a one-connection provider plays, timers made on another device are read every minute. */
export function watchRecordingsWhilePlaying(channelId: string): () => void {
  const originKey = channelOrigin(channelId);
  if (!originKey) return () => {};
  const timer = setInterval(() => {
    void oneConnection(originKey).then((one) => (one ? refreshRecordingStatus() : undefined));
  }, PLAYING_REFRESH_MS);
  return () => clearInterval(timer);
}

/** The timer recording on the channel's provider now; null when none is. */
export function heldRecording(channelId: string, nowMs = Date.now()): JellyfinTimer | null {
  const originKey = channelOrigin(channelId);
  if (!originKey) return null;
  const { running, active } = getRecordingStatus();
  return [...running, ...active].find((timer) => channelOrigin(timer.ChannelId) === originKey && holdsNow(timer, nowMs)) ?? null;
}

/** Whether a recording holds the channel's provider, as the engine answers now. */
export async function isChannelHeld(channelId: string): Promise<boolean> {
  const originKey = channelOrigin(channelId);
  if (!originKey) return false;
  return (await originConnections(originKey))?.held ?? originHeld(originKey);
}

/** Whether the recording on the channel's provider is still being checked for the stream. */
export function recordingChecking(channelId: string): boolean {
  const originKey = channelOrigin(channelId);
  return !!originKey && checking.has(originKey);
}

export function subscribeRecordingChecks(listener: () => void): () => void {
  checkListeners.add(listener);
  return () => checkListeners.delete(listener);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Before a recording that starts now on a one-connection provider: every read here ends. The returned release
 * drops the mark when the timer write failed; null when the provider is not at one connection.
 */
export async function reserveForRecording(channelId: string): Promise<(() => void) | null> {
  const originKey = channelOrigin(channelId);
  if (!originKey || !(await oneConnection(originKey))) return null;
  pending.set(originKey, Date.now());
  syncRecordingHolds();
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline && ((await originConnections(originKey))?.active ?? 0) > 0) await wait(POLL_MS);
  return () => {
    pending.delete(originKey);
    syncRecordingHolds();
  };
}

/** The live timer on a channel now, the one a write just made. */
async function currentTimer(channelId: string, programId?: string): Promise<JellyfinTimer | null> {
  return activeRecordTimer(await fetchTimers(), { programId, channelId }, Date.now());
}

/** A refused airing made again: a program's defaults bring back its own timer, series link kept; a manual timer is made anew. */
async function recreateTimer(timer: JellyfinTimer): Promise<void> {
  if (timer.ProgramId) {
    await createTimer(await fetchTimerDefaults(timer.ProgramId));
    return;
  }
  const defaults = await fetchTimerDefaults();
  await createTimer({ ...defaults, ChannelId: timer.ChannelId, Name: timer.Name, StartDate: new Date().toISOString(), EndDate: timer.EndDate });
}

/** After a write that started a recording now: the recording is checked until it has the stream. */
export async function checkNewRecording(channelId: string, programId: string | undefined, recreate: () => Promise<void>): Promise<void> {
  const originKey = channelOrigin(channelId);
  if (!originKey) return;
  const timer = await currentTimer(channelId, programId);
  if (!timer) return;
  await checkRecording(originKey, timer, recreate);
}

/** The recording the timer writes once it starts; null when the timer stops being live first (cancelled anywhere) or the span ends. */
async function waitForRecording(timerId: string, endMs: number, mine: () => boolean): Promise<JellyfinItem | null> {
  while (mine() && Date.now() < endMs) {
    const timer = (await fetchTimers()).find((candidate) => candidate.Id === timerId);
    if (!timer || !isActiveTimer(timer)) return null;
    const item = timer.Status === "InProgress" ? await fetchInProgressRecording(timerId) : null;
    if (item) return item;
    await wait(POLL_MS);
  }
  return null;
}

async function readsVideo(itemId: string): Promise<boolean> {
  return (await readRecordingStart(itemId))[0] === TS_SYNC;
}

/**
 * A recording counts only once its file holds video. An empty file is cancelled, which writes out what the provider
 * sent, and made again, until a read finds video. Cancels that found video mean a provider slow to send: after
 * VIDEO_FLUSHES_TO_STOP of them the recording is made once more and left alone.
 */
async function checkRecording(originKey: string, timer: JellyfinTimer, recreate: () => Promise<void>): Promise<void> {
  const run = ++checkRun;
  const mine = () => checking.get(originKey) === run;
  checking.set(originKey, run);
  notifyChecks();
  syncRecordingHolds();
  const { endMs } = recordingWindow(timer);
  let id: string | null = timer.Id;
  let videoFlushes = 0;
  try {
    while (id && mine() && Date.now() < endMs) {
      const item = await waitForRecording(id, endMs, mine);
      if (!item || !mine()) return;
      if (await readsVideo(item.Id)) return;
      await cancelTimer(id);
      while (mine() && Date.now() < endMs && (await fetchInProgressRecording(id))) await wait(POLL_MS);
      if (!mine()) return;
      if (await readsVideo(item.Id)) videoFlushes += 1;
      logger.info("Recording had no stream, made again", { service: "RecordingHold", timerId: id, videoFlushes });
      await recreate();
      if (videoFlushes >= VIDEO_FLUSHES_TO_STOP) return;
      id = (await currentTimer(timer.ChannelId ?? "", timer.ProgramId))?.Id ?? null;
    }
  } catch (error) {
    logger.warn("Recording check failed", error, { service: "RecordingHold" });
  } finally {
    if (mine()) {
      checking.delete(originKey);
      notifyChecks();
      await refreshRecordingStatus().catch((error) => logger.warn("Recording status read failed", error, { service: "RecordingHold" }));
      syncRecordingHolds();
    }
  }
}

/** Ends the check on the channel's provider: its recording was stopped on purpose. */
export function stopRecordingCheck(channelId: string): void {
  const originKey = channelOrigin(channelId);
  if (!originKey || !checking.delete(originKey)) return;
  notifyChecks();
}

/** The recording the timer is writing, to play instead of the held channel; null while it has none. */
export async function recordingInProgress(timer: JellyfinTimer): Promise<JellyfinItem | null> {
  return fetchInProgressRecording(timer.Id);
}

let admitting: string | null = null;

/** The channel to open again on every refusal until it plays, after its provider's recording was stopped. */
export function admitUntilPlaying(channelId: string | null): void {
  admitting = channelId;
}

export function isAdmitting(channelId: string): boolean {
  return admitting === channelId;
}

/** Stops the recording; resolves once its provider is free for the channel asked for. */
export async function stopRecordingAndPlay(timer: JellyfinTimer, channelId: string): Promise<void> {
  stopRecordingCheck(channelId);
  await cancelTimer(timer.Id);
  try {
    await refreshRecordingStatus();
  } catch (error) {
    logger.warn("Recording status read failed", error, { service: "RecordingHold" });
  }
  syncRecordingHolds();
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline && (await isChannelHeld(channelId))) await wait(POLL_MS);
  admitUntilPlaying(channelId);
}

export function resetRecordingHoldsForTests(): void {
  clearEdge();
  pushed = new Set();
  pending.clear();
  warned.clear();
  checking.clear();
  checkListeners.clear();
  admitting = null;
}
