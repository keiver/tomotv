/**
 * playbackProbe.ts
 *
 * One set of emit points feeding two sinks.
 *
 * SUITE sink: the playback regression suite (scripts/playback-regression.mjs)
 * deep-links the player with probe=1 and reads Documents/playback-probe.jsonl
 * back from the app container while playback is still live, so that file is
 * rewritten on every event and its URLs stay raw. Armed only by __DEV__ AND
 * probe=1.
 *
 * SESSION sink: the Diagnostics screen (app/diagnostics.tsx). Always armed. The
 * MOST RECENT playback only, capped and redacted, living in memory. Every event
 * mirrors it to Caches/last-session.json, so a reload or a crash leaves the
 * playback behind, and nothing empty is ever written over it.
 */
import { APP_VERSION_LABEL } from "@/constants/app";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger, redactSecrets } from "@/utils/logger";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

/** Jellyfin reports durations in 100ns ticks. */
const JELLYFIN_TICKS_PER_SECOND = 10_000_000;

export const PROBE_FILENAME = "playback-probe.jsonl";
export const SESSION_FILENAME = "last-session.json";

/** Seconds between recorded progress samples; the driver only needs coarse advancement. */
const PROGRESS_INTERVAL_MS = 2000;

/** Session caps. A real playback emits well under MAX_EVENTS of these; the cap bounds the
 *  pathological case, and HEAD_KEEP protects the opening decisions from being the ones dropped. */
const MAX_EVENTS = 40;
const HEAD_KEEP = 8;
const MAX_PROGRESS = 10;

export type SessionEvent = { t: number; event: string; [key: string]: unknown };

export type PlaybackSession = {
  itemId: string;
  /** The build that recorded it, which is not always the one reading it back. */
  app: string;
  os: string;
  startedAt: number;
  outcome: "playing" | "ended" | "error";
  events: SessionEvent[];
  progress: { t: number; position: number }[];
};

const STAMP = { app: APP_VERSION_LABEL, os: `${Platform.isTV ? "tvOS" : "iOS"} ${Platform.Version}` };

let enabled = false;
let itemId: string | null = null;
let lines: string[] = [];
let lastProgressAt = 0;
let session: PlaybackSession | null = null;

/** Counts every write and clear, so a screen showing the session can re-read on change. */
let sessionVersion = 0;
const sessionListeners = new Set<() => void>();

function notifySession(): void {
  sessionVersion += 1;
  for (const listener of [...sessionListeners]) listener();
}

export function subscribeLastSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function getLastSessionVersion(): number {
  return sessionVersion;
}

function flush(): void {
  try {
    const file = new File(Paths.document, PROBE_FILENAME);
    file.write(lines.join("\n") + "\n");
  } catch (error) {
    logger.warn("Playback probe write failed", error, { service: "PlaybackProbe" });
  }
}

/**
 * What Jellyfin says the file is. This is the block that answers "why will my file not
 * play" without anyone having to send the file: codec, profile, bit depth and every track.
 */
export function sourceSummary(item: JellyfinVideoItem | null): Record<string, unknown> {
  const streams = item?.MediaStreams ?? [];
  const video = streams.find((s) => s.Type === "Video");
  return {
    id: item?.Id ?? null,
    name: item?.Name ?? null,
    container: item?.MediaSources?.[0]?.Container ?? null,
    runtimeSeconds: item?.RunTimeTicks ? Math.round(item.RunTimeTicks / JELLYFIN_TICKS_PER_SECOND) : null,
    video: video
      ? {
          codec: video.Codec,
          profile: video.Profile ?? null,
          level: video.Level ?? null,
          bitDepth: video.BitDepth ?? null,
          size: video.Width && video.Height ? `${video.Width}x${video.Height}` : null,
          range: video.VideoRangeType ?? video.VideoRange ?? null,
          dolbyVisionProfile: video.DvProfile ?? null,
          interlaced: video.IsInterlaced ?? false,
          fps: video.RealFrameRate ?? video.AverageFrameRate ?? null,
          bitRate: video.BitRate ?? null,
        }
      : null,
    audio: streams
      .filter((s) => s.Type === "Audio")
      .map((a) => ({ index: a.Index, codec: a.Codec, channels: a.Channels ?? null, language: a.Language ?? null, profile: a.Profile ?? null, default: a.IsDefault ?? false })),
    subtitles: streams
      .filter((s) => s.Type === "Subtitle")
      .map((t) => ({ index: t.Index, codec: t.Codec, language: t.Language ?? null, external: t.IsExternal ?? false, forced: t.IsForced ?? false })),
  };
}

/** Redacts every nested string at once: the pattern stops at the closing quote in JSON. */
function redactEntry<T>(value: T): T {
  return JSON.parse(redactSecrets(JSON.stringify(value))) as T;
}

/** Caches, not Documents: tvOS refused every overwrite there, and this file only exists so a
 *  reload can recover what memory already holds. */
function sessionFile(): File {
  return new File(Paths.cache, SESSION_FILENAME);
}

/** Mirrors memory to disk. Nothing empty is ever written, so a blank session cannot replace
 *  a real one that a reload would otherwise have recovered. */
function writeSession(): void {
  if (!session?.events.length) return;
  try {
    const file = sessionFile();
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(session));
  } catch (error) {
    logger.warn("Session log write failed", error, { service: "PlaybackProbe" });
  }
}

/** Replaces whatever the last playback left, a replay of the same item included. One session
 *  is kept, never a history. */
function startSession(videoId: string): void {
  // The player mounts before it has an id; recording that would persist an empty session
  // over a real one.
  if (!videoId) return;
  session = { itemId: videoId, ...STAMP, startedAt: Date.now(), outcome: "playing", events: [], progress: [] };
  lastProgressAt = 0;
}

function recordSession(event: string, entry: SessionEvent): void {
  if (!session) return;
  if (event === "progress") {
    session.progress.push({ t: entry.t, position: Number(entry.position) });
    if (session.progress.length > MAX_PROGRESS) session.progress.shift();
  } else {
    session.events.push(redactEntry(entry));
    // Drop from just after the head, so the first decisions and the latest activity both survive.
    if (session.events.length > MAX_EVENTS) session.events.splice(HEAD_KEEP, 1);
    // An error the player retries is not the verdict; the playback that follows decides it.
    if (event === "ended") session.outcome = "ended";
    if (event === "error" && !entry.willRetry) session.outcome = "error";
  }
  writeSession();
  notifySession();
}

/** The last playback: memory first, falling back to the file a reload or a crash left behind. */
export function readLastSession(): PlaybackSession | null {
  if (session?.events.length) return session;
  try {
    const file = sessionFile();
    if (!file.exists) return null;
    const stored = JSON.parse(file.textSync()) as Partial<PlaybackSession>;
    // A file from a build before the stamp would read under the wrong header.
    return typeof stored.app === "string" ? (stored as PlaybackSession) : null;
  } catch (error) {
    logger.warn("Session log read failed", error, { service: "PlaybackProbe" });
    return null;
  }
}

/** Forgets the last playback, memory and file. A playback still running records nothing more. */
export function clearLastSession(): void {
  session = null;
  try {
    const file = sessionFile();
    if (file.exists) file.delete();
  } catch (error) {
    logger.warn("Session log delete failed", error, { service: "PlaybackProbe" });
  }
  notifySession();
}

/**
 * Arm or disarm the probe for one playback. Arming resets the event log so
 * every driver-launched playback starts a fresh file (the driver cold-starts
 * the app per item, but a Metro reload must not leak a previous run's events).
 */
export function setPlaybackProbeEnabled(on: boolean, videoId: string): void {
  startSession(videoId);
  if (!__DEV__) return;
  if (!on) {
    enabled = false;
    return;
  }
  if (!enabled || itemId !== videoId) {
    enabled = true;
    itemId = videoId;
    lines = [];
    lastProgressAt = 0;
    probeEmit("start");
  }
}

/**
 * Record one event into both sinks. Nothing in here may throw into the caller: these calls
 * sit inside the playback path, and a diagnostics failure must not become a playback one.
 */
export function probeEmit(event: string, data?: Record<string, unknown>): void {
  try {
    const entry: SessionEvent = { t: Date.now(), event, itemId, ...data };
    recordSession(event, entry);
    if (!enabled) return;
    lines.push(JSON.stringify(entry));
    flush();
  } catch (error) {
    logger.warn("Probe emit failed", error, { service: "PlaybackProbe", event });
  }
}

/**
 * The moment playback first moves, once per session: the "started after N seconds" the
 * Diagnostics screen reads. Later flips (engine restarts, seeks) are not a start.
 */
export function probeFirstPlaying(): void {
  if (!session || session.events.some((event) => event.event === "playing")) return;
  probeEmit("playing", { afterSeconds: Math.round((Date.now() - session.startedAt) / 100) / 10 });
}

/** Throttled position sample from onProgress. */
export function probeProgress(positionSeconds: number): void {
  const now = Date.now();
  if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
  lastProgressAt = now;
  probeEmit("progress", { position: positionSeconds });
}
