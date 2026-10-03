/**
 * The server's recording timers as one app-wide reading: the tab badges, the guide's Schedule
 * cell and the Live TV card draw their dot from here. Re-read on a timer write, a sign-in, a
 * foreground and at the next timer boundary, so a recording's end clears the dot on its own.
 */
import { cancelTimer, fetchTimers, subscribeAuthChange, subscribeRecordingsChange } from "@/services/jellyfinApi";
import { getLiveTvAvailability, subscribeLiveTvAvailability } from "@/services/liveTvAvailability";
import type { JellyfinTimer } from "@/types/jellyfin";
import { isActiveTimer } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";

export interface RecordingStatus {
  /** Timers recording now, as runningTimers reads them. */
  running: JellyfinTimer[];
}

/** A re-read lands a moment after the boundary so the server's own clock has passed it too. */
const BOUNDARY_GRACE_MS = 1_500;
/** The longest sleep before a re-read: a boundary beyond this is read when it arrives. */
const MAX_SLEEP_MS = 24 * 60 * 60 * 1_000;
/** A failed read tries again: a boot read can run before the session is usable. */
const RETRY_MS = 60_000;
/** A timer still InProgress past its padded end is closing on the server; look again soon. */
const OVERRUN_RECHECK_MS = 30_000;

const EMPTY: RecordingStatus = { running: [] };
let status: RecordingStatus = EMPTY;
const listeners = new Set<() => void>();
let sources: (() => void)[] = [];
let appState: NativeEventSubscription | null = null;
let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

/** The span the server records: the timer's dates widened by its pre and post padding. */
export function recordingWindow(timer: JellyfinTimer): { startMs: number; endMs: number } {
  return { startMs: Date.parse(timer.StartDate) - (timer.PrePaddingSeconds ?? 0) * 1_000, endMs: Date.parse(timer.EndDate) + (timer.PostPaddingSeconds ?? 0) * 1_000 };
}

/**
 * Live timers recording now: the server says InProgress, or the clock is inside the padded span.
 * The clock matters because InProgress is set only once the tuner stream is open, after the create call returned.
 */
export function runningTimers(timers: JellyfinTimer[], nowMs: number): JellyfinTimer[] {
  return timers.filter((timer) => {
    if (!isActiveTimer(timer)) return false;
    if (timer.Status === "InProgress") return true;
    const { startMs, endMs } = recordingWindow(timer);
    return startMs <= nowMs && nowMs < endMs;
  });
}

/** Deletes every given timer, the Schedule screen's Stop All; the ids whose delete failed come back. */
export async function stopRunningTimers(running: JellyfinTimer[]): Promise<string[]> {
  const results = await Promise.allSettled(running.map((timer) => cancelTimer(timer.Id)));
  return running.filter((_, index) => results[index].status === "rejected").map((timer) => timer.Id);
}

/** The next moment the reading changes by itself: a running timer's padded end or an upcoming one's padded start. */
export function recordingBoundary(timers: JellyfinTimer[], nowMs: number): number | null {
  let next: number | null = null;
  for (const timer of timers) {
    if (!isActiveTimer(timer)) continue;
    const { startMs, endMs } = recordingWindow(timer);
    let edge = startMs > nowMs ? startMs : endMs;
    if (edge <= nowMs && timer.Status === "InProgress") edge = nowMs + OVERRUN_RECHECK_MS;
    if (!Number.isFinite(edge) || edge <= nowMs) continue;
    if (next === null || edge < next) next = edge;
  }
  return next;
}

export function getRecordingStatus(): RecordingStatus {
  return status;
}

function publish(next: RecordingStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function clearBoundary(): void {
  if (boundaryTimer) clearTimeout(boundaryTimer);
  boundaryTimer = null;
}

function armBoundary(timers: JellyfinTimer[]): void {
  clearBoundary();
  const edge = recordingBoundary(timers, Date.now());
  if (edge === null) return;
  boundaryTimer = setTimeout(() => void refreshRecordingStatus(), Math.min(edge - Date.now() + BOUNDARY_GRACE_MS, MAX_SLEEP_MS));
}

/** Reads the timers again; a read overtaken by a newer one is dropped. */
export async function refreshRecordingStatus(): Promise<void> {
  const mine = ++generation;
  clearBoundary();
  if (!getLiveTvAvailability()) {
    if (status.running.length > 0) publish(EMPTY);
    return;
  }
  let timers: JellyfinTimer[];
  try {
    timers = await fetchTimers();
  } catch (error) {
    logger.warn("Recording status read failed", error, { service: "RecordingStatus" });
    if (mine === generation && listeners.size > 0) boundaryTimer = setTimeout(() => void refreshRecordingStatus(), RETRY_MS);
    return;
  }
  if (mine !== generation) return;
  const running = runningTimers(timers, Date.now());
  if (running.length !== status.running.length || running.some((timer, index) => timer.Id !== status.running[index]?.Id)) publish({ running });
  armBoundary(timers);
}

function handleAppState(next: AppStateStatus): void {
  if (next === "active") void refreshRecordingStatus();
}

function start(): void {
  sources = [
    subscribeRecordingsChange(() => void refreshRecordingStatus()),
    subscribeAuthChange(() => {
      publish(EMPTY);
      void refreshRecordingStatus();
    }),
    subscribeLiveTvAvailability(() => void refreshRecordingStatus()),
  ];
  appState = AppState.addEventListener("change", handleAppState);
  void refreshRecordingStatus();
}

function stop(): void {
  for (const unsubscribe of sources) unsubscribe();
  sources = [];
  appState?.remove();
  appState = null;
  clearBoundary();
}

/** The first subscriber starts the reading, the last one stops it. */
export function subscribeRecordingStatus(listener: () => void): () => void {
  if (listeners.size === 0) start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function resetRecordingStatusForTests(): void {
  stop();
  listeners.clear();
  generation++;
  status = EMPTY;
}
