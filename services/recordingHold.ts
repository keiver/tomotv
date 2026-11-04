/**
 * Server recordings on a one-connection provider: the engine learns which providers a recording reads and,
 * at a limit of 1, opens nothing on them.
 */
import { cancelTimer, createTimer, deleteItem, deleteRecording, fetchInProgressRecording, fetchTimerDefaults, fetchTimers, readRecordingStart } from "@/services/jellyfinApi";
import { t } from "@/services/i18n";
import { getRecordingStatus, recordingWindow, refreshRecordingStatus, subscribeRecordingStatus } from "@/services/recordingStatus";
import { hideRefusedRecording } from "@/services/refusedRecordings";
import { showToast } from "@/services/toast";
import type { JellyfinItem, JellyfinTimer } from "@/types/jellyfin";
import { activeRecordTimer, adjacentChannelId, isActiveTimer } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { learnOriginConnectionBudget, originConnectionLimit, originConnections, originHeld, setOriginRecording, subscribeOriginHolds } from "@keiver/tomo-engine";
import { playlistChannelById, providerStreamsInUse, subscribePlaylistChannels } from "@keiver/tomo-live";

const WARN_AHEAD_MS = 60_000;
const PLAYING_REFRESH_MS = 60_000;
const DRAIN_TIMEOUT_MS = 10_000;
const PENDING_TTL_MS = 120_000;
const POLL_MS = 250;
/** Reads of a stopped recording before its file counts as flushed. */
const FLUSH_READS = 40;
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

/** Each provider's limit as its account API stated it this session. */
const statedLimits = new Map<string, number>();

/** The viewer's limit, else the engine's, else the provider's account API, whose 1 the engine then learns. */
async function oneConnection(channelId: string): Promise<boolean> {
  const row = playlistChannelById(channelId);
  if (!row) return false;
  const { originKey } = row;
  if (originConnectionLimit(originKey) === 1) return true;
  const budget = (await originConnections(originKey))?.budget ?? null;
  if (budget !== null) return budget === 1;
  let stated = statedLimits.get(originKey);
  if (stated === undefined) {
    stated = (await providerStreamsInUse(row.streamUrl, row.headers))?.max;
    if (stated === undefined) return false;
    statedLimits.set(originKey, stated);
  }
  if (stated !== 1) return false;
  await learnOriginConnectionBudget(originKey, 1);
  return true;
}

let pushed = new Set<string>();
// Origins with a hold or clear in flight to the engine, so a second sync does not issue the same call twice.
const inflight = new Set<string>();
const pending = new Map<string, number>();
const warned = new Set<string>();
/** One-connection providers let go at a scheduled recording's warning, with the timer that starts on them. */
const leading = new Map<string, JellyfinTimer>();
/** Providers whose new recording is being checked for the stream, with the run that checks it. */
const checking = new Map<string, { run: number; timer: JellyfinTimer }>();
let checkRun = 0;
const checkListeners = new Set<() => void>();
let edgeTimer: ReturnType<typeof setTimeout> | null = null;

function clearEdge(): void {
  if (edgeTimer) clearTimeout(edgeTimer);
  edgeTimer = null;
}

let checkVersion = 0;

function notifyChecks(): void {
  checkVersion += 1;
  for (const listener of checkListeners) listener();
}

export function getRecordingCheckVersion(): number {
  return checkVersion;
}

/** Tells the engine each provider a recording starts or stops holding, warns a minute ahead, and arms the next edge. */
export function syncRecordingHolds(nowMs = Date.now()): void {
  const { active, running } = getRecordingStatus();
  const runningOrigins = new Set(running.map((timer) => channelOrigin(timer.ChannelId)).filter((key): key is string => !!key));
  for (const [originKey, atMs] of pending) {
    if (runningOrigins.has(originKey) || nowMs - atMs >= PENDING_TTL_MS) pending.delete(originKey);
  }

  const next = recordingOrigins(active, nowMs);
  for (const [originKey, timer] of leading) {
    const live = active.find((candidate) => candidate.Id === timer.Id);
    if (!live || !isActiveTimer(live) || nowMs >= recordingWindow(live).endMs) {
      leading.delete(originKey);
      continue;
    }
    if (!holdsNow(live, nowMs)) {
      next.add(originKey);
      continue;
    }
    // Let go at the warning, so this device was the reader: the started recording is checked for the stream.
    leading.delete(originKey);
    if (!checking.has(originKey)) void checkRecording(originKey, live, () => recreateTimer(live));
  }
  for (const originKey of pending.keys()) next.add(originKey);
  for (const originKey of checking.keys()) next.add(originKey);
  for (const originKey of next) {
    if (pushed.has(originKey) || inflight.has(originKey)) continue;
    const starting = pending.has(originKey) || checking.has(originKey) ? null : active.find((timer) => channelOrigin(timer.ChannelId) === originKey && holdsNow(timer, nowMs));
    pushHold(originKey, starting ?? null);
  }
  for (const originKey of [...pushed]) {
    if (!next.has(originKey) && !inflight.has(originKey)) pushClear(originKey);
  }

  for (const timer of active) {
    if (!isActiveTimer(timer) || timer.Status === "InProgress" || warned.has(timer.Id)) continue;
    const originKey = channelOrigin(timer.ChannelId);
    const { startMs } = recordingWindow(timer);
    if (!originKey || nowMs < startMs - WARN_AHEAD_MS || nowMs >= startMs) continue;
    warned.add(timer.Id);
    void oneConnection(timer.ChannelId ?? "").then(async (one) => {
      if (!one) return;
      showToast({ title: t("player.limitedConnections"), message: t("liveTv.recordingSoon").replace("{channel}", timer.ChannelName ?? timer.Name) });
      if (((await originConnections(originKey))?.active ?? 0) === 0) return;
      leading.set(originKey, timer);
      syncRecordingHolds();
    });
  }

  clearEdge();
  const edges = [nextHoldEdge(active, nowMs), ...[...pending.values()].map((atMs) => atMs + PENDING_TTL_MS)].filter((edge): edge is number => edge !== null && Number.isFinite(edge));
  if (edges.length > 0) edgeTimer = setTimeout(() => syncRecordingHolds(), Math.max(0, Math.min(...edges) - nowMs));
}

/** Holds the provider; a scheduled recording that starts while this device reads it is checked for the stream. */
async function holdOrigin(originKey: string, starting: JellyfinTimer | null): Promise<void> {
  if (starting?.ChannelId) await oneConnection(starting.ChannelId);
  const before = starting ? await originConnections(originKey) : null;
  await setOriginRecording(originKey, true);
  if (!starting || !before || before.active === 0 || before.budget !== 1) return;
  void checkRecording(originKey, starting, () => recreateTimer(starting));
}

// The engine resolves setOriginRecording even when it could not apply the change, so its own held state, not the
// promise settling, decides whether the push took. A hold it did not take, or a clear it did not apply, is left
// for the next sync to retry.
function reconcilePushed(originKey: string): void {
  if (originHeld(originKey)) pushed.add(originKey);
  else pushed.delete(originKey);
}

/** Pushes a hold to the engine and records it as pushed only if the engine then reports the origin held; else the next sync retries. */
function pushHold(originKey: string, starting: JellyfinTimer | null): void {
  inflight.add(originKey);
  holdOrigin(originKey, starting)
    .catch((error) => logger.warn("Recording hold push failed", error, { service: "RecordingHold" }))
    .finally(() => {
      inflight.delete(originKey);
      reconcilePushed(originKey);
    });
}

/** Clears a hold on the engine and drops it from pushed only if the engine then reports the origin free; else it stays and the next sync retries. */
function pushClear(originKey: string): void {
  inflight.add(originKey);
  setOriginRecording(originKey, false)
    .catch((error) => logger.warn("Recording hold clear failed", error, { service: "RecordingHold" }))
    .finally(() => {
      inflight.delete(originKey);
      reconcilePushed(originKey);
    });
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
    void oneConnection(channelId).then((one) => (one ? refreshRecordingStatus() : undefined));
  }, PLAYING_REFRESH_MS);
  return () => clearInterval(timer);
}

/**
 * The timer recording on the channel's provider now, the one being checked while it is made again; null when none is.
 * A hook passes the status and check version it read, so a memoizing compiler recomputes when either moves.
 */
export function heldRecording(channelId: string, status = getRecordingStatus(), _checkVersion = checkVersion, nowMs = Date.now()): JellyfinTimer | null {
  const originKey = channelOrigin(channelId);
  if (!originKey) return null;
  const { running, active } = status;
  return [...running, ...active].find((timer) => channelOrigin(timer.ChannelId) === originKey && holdsNow(timer, nowMs)) ?? checking.get(originKey)?.timer ?? null;
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

export interface Reservation {
  /** The slot is free and the timer may be written; false when the viewer cancelled or the span ended first. */
  free: boolean;
  /** Drops the hold when no timer was written. */
  release: () => void;
}

/**
 * Before a recording that starts now on a one-connection provider: every read here ends, then it waits, with no
 * deadline, for the provider to count the slot free. Null when the provider is not at one connection.
 */
export async function reserveForRecording(channelId: string, options: { signal?: AbortSignal; endMs?: number } = {}): Promise<Reservation | null> {
  const originKey = channelOrigin(channelId);
  if (!originKey || !(await oneConnection(channelId))) return null;
  // The mark holds the provider for as long as the wait runs; its TTL starts once the timer is written.
  pending.set(originKey, Number.POSITIVE_INFINITY);
  syncRecordingHolds();
  const endMs = options.endMs ?? Number.POSITIVE_INFINITY;
  const stillWanted = () => !options.signal?.aborted && Date.now() < endMs;
  await waitForSlot(channelId, originKey, stillWanted);
  const free = stillWanted();
  const release = () => {
    pending.delete(originKey);
    syncRecordingHolds();
  };
  if (free) pending.set(originKey, Date.now());
  else release();
  return { free, release };
}

/** Until this device's reads on the provider have closed, then until the provider counts a stream free. */
async function waitForSlot(channelId: string, originKey: string, stillWanted: () => boolean): Promise<void> {
  while (stillWanted() && ((await originConnections(originKey))?.active ?? 0) > 0) await wait(POLL_MS);
  await waitForProviderFree(channelId, stillWanted);
}

/**
 * Resolves once the channel's provider counts a stream free, read through its account API with no stream opened, so
 * the recorder never opens into a stream the provider still counts and saves its refusal. At once for a provider
 * without that API; a provider whose API answered keeps being asked through a failed read.
 */
async function waitForProviderFree(channelId: string, stillWanted: () => boolean): Promise<void> {
  const row = playlistChannelById(channelId);
  if (!row) return;
  while (stillWanted()) {
    const streams = await providerStreamsInUse(row.streamUrl, row.headers);
    if (streams ? streams.active < streams.max : !statedLimits.has(row.originKey)) return;
    await wait(POLL_MS);
  }
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
  const mine = () => checking.get(originKey)?.run === run;
  checking.set(originKey, { run, timer });
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
      const readsHere = (await originConnections(originKey))?.active ?? 0;
      await cancelTimer(id);
      while (mine() && Date.now() < endMs && (await fetchInProgressRecording(id))) await wait(POLL_MS);
      if (!mine()) return;
      if (await readsVideo(item.Id)) videoFlushes += 1;
      else {
        // Refused while this device held its reads: those were the provider's limit, as a refused open teaches the engine.
        if (readsHere > 0) await learnOriginConnectionBudget(originKey, readsHere);
        await clearRefusedRecording(item.Id);
      }
      logger.info("Recording had no stream, made again", { service: "RecordingHold", timerId: id, videoFlushes });
      await waitForSlot(timer.ChannelId ?? "", originKey, () => mine() && Date.now() < endMs);
      if (!mine() || Date.now() >= endMs) return;
      await recreate();
      if (videoFlushes >= VIDEO_FLUSHES_TO_STOP) return;
      const next = await currentTimer(timer.ChannelId ?? "", timer.ProgramId);
      id = next?.Id ?? null;
      if (next && mine()) {
        checking.set(originKey, { run, timer: next });
        notifyChecks();
      }
    }
  } catch (error) {
    logger.warn("Recording check failed", error, { service: "RecordingHold" });
  } finally {
    if (mine()) await refreshRecordingStatus().catch((error) => logger.warn("Recording status read failed", error, { service: "RecordingHold" }));
    if (mine()) {
      checking.delete(originKey);
      notifyChecks();
      syncRecordingHolds();
    }
  }
}

/** The recording on the channel's provider once its check has found video; null when there is none to play. */
export async function recordingWhenReady(channelId: string): Promise<JellyfinItem | null> {
  if (recordingChecking(channelId)) {
    await new Promise<void>((resolve) => {
      const stop = subscribeRecordingChecks(() => {
        if (recordingChecking(channelId)) return;
        stop();
        resolve();
      });
    });
  }
  const timer = heldRecording(channelId);
  return timer ? fetchInProgressRecording(timer.Id) : null;
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

/** How long a one-connection channel keeps opening again on the provider's refusal before its error shows. */
export const ADMIT_WAIT_MS = 20_000;

let admitting: string | null = null;
let admittingSince = 0;

/** The channel to open again on every refusal until it plays, for at most ADMIT_WAIT_MS from its first admit. */
export function admitUntilPlaying(channelId: string | null, nowMs = Date.now()): void {
  if (channelId !== admitting) admittingSince = nowMs;
  admitting = channelId;
}

/**
 * Before a channel opens, from one read of the engine's counts: true when a recording holds its provider. Otherwise a channel
 * on a one-connection provider opens again on every refusal until it plays: the slot is this device's to wait for.
 */
export async function admitOnOneConnection(channelId: string): Promise<boolean> {
  const originKey = channelOrigin(channelId);
  if (!originKey) return false;
  const connections = await originConnections(originKey);
  if (connections?.held ?? originHeld(originKey)) return true;
  if (originConnectionLimit(originKey) === 1 || connections?.budget === 1) admitUntilPlaying(channelId);
  return false;
}

export function isAdmitting(channelId: string, nowMs = Date.now()): boolean {
  return admitting === channelId && nowMs - admittingSince < ADMIT_WAIT_MS;
}

/**
 * A recording whose file is a provider's refusal: its file is deleted where the account may, else its entry is dropped
 * and hidden, since the server adds the file back on its next folder refresh.
 */
export async function clearRefusedRecording(itemId: string): Promise<void> {
  try {
    await deleteItem(itemId);
    return;
  } catch (error) {
    logger.info("Refused recording kept on disk, entry dropped", { service: "RecordingHold", itemId, error: String(error) });
  }
  hideRefusedRecording(itemId);
  await deleteRecording(itemId).catch((error) => logger.warn("Refused recording entry drop failed", error, { service: "RecordingHold" }));
}

/** Stops a recording; once the server has written its file out, a refusal is cleared. */
export async function cancelRecording(timerId: string): Promise<void> {
  const item = await fetchInProgressRecording(timerId).catch(() => null);
  if (!item) {
    await cancelTimer(timerId);
    return;
  }
  await cancelTimer(timerId, item.Id);
  void clearIfRefused(item.Id, timerId);
}

async function clearIfRefused(itemId: string, timerId: string): Promise<void> {
  try {
    for (let read = 0; read < FLUSH_READS && (await fetchInProgressRecording(timerId)); read++) await wait(POLL_MS);
    if (!(await readsVideo(itemId))) await clearRefusedRecording(itemId);
  } catch (error) {
    logger.warn("Stopped recording read failed", error, { service: "RecordingHold" });
  }
}

/** Stops the recording; resolves once its provider is free for the channel asked for. */
export async function stopRecordingAndPlay(timer: JellyfinTimer, channelId: string): Promise<void> {
  stopRecordingCheck(channelId);
  await cancelRecording(timer.Id);
  try {
    await refreshRecordingStatus();
  } catch (error) {
    logger.warn("Recording status read failed", error, { service: "RecordingHold" });
  }
  syncRecordingHolds();
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline && (await isChannelHeld(channelId))) await wait(POLL_MS);
  admitUntilPlaying(null);
  admitUntilPlaying(channelId);
}

export function resetRecordingHoldsForTests(): void {
  clearEdge();
  pushed = new Set();
  inflight.clear();
  pending.clear();
  warned.clear();
  leading.clear();
  statedLimits.clear();
  checking.clear();
  checkListeners.clear();
  admitting = null;
}
