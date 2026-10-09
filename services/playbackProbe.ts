/**
 * playbackProbe.ts
 *
 * One set of emit points feeding two sinks.
 *
 * SUITE sink: a driver deep-links the player with probe=<its URL> and receives each
 * event as a POST the moment it happens (scripts/playback-regression.mjs), or with
 * probe=1 and reads Library/Caches/playback-probe.jsonl back (scripts/abr-drill.mjs).
 * URLs stay raw. Armed only by __DEV__ AND a probe param.
 *
 * SESSION sink: the Diagnostics screen (app/diagnostics.tsx). Always armed. The
 * MOST RECENT playback only, capped and redacted, living in memory. Every event
 * mirrors it to Caches/last-session.json off the JS thread, so a reload or a crash
 * leaves the playback behind, and nothing empty is ever written over it.
 */
import { APP_BUILD_NUMBER, APP_VERSION, BRAND_NAME } from "@/constants/app";
import { parseSession, SCHEMA_VERSION, type DeviceDecode, type PlaybackSession, type SessionEvent, type SessionHead } from "@/services/diagnosticsSchema";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { DEVICE_CORES, DEVICE_MARKETING_NAME, DEVICE_MEMORY_BYTES, DEVICE_MODEL, THIS_DEVICE } from "@/utils/hostEnvironment";
import { clearVerdicts } from "@/services/engineVerdicts";
import { logger, redactSecrets } from "@/utils/logger";
import { File, Paths } from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";
import { AppState, Platform } from "react-native";

export type { PlaybackSession, SessionEvent } from "@/services/diagnosticsSchema";

/** Jellyfin reports durations in 100ns ticks. */
const JELLYFIN_TICKS_PER_SECOND = 10_000_000;

export const PROBE_FILENAME = "playback-probe.jsonl";
/** The probe param that selects the file sink; any other value is the URL events are POSTed to. */
const FILE_SINK = "1";
export const SESSION_FILENAME = "last-session.json";

/** Seconds between recorded progress samples; the driver only needs coarse advancement. */
const PROGRESS_INTERVAL_MS = 2000;

/** Session caps. A real playback emits well under MAX_EVENTS of these; the cap bounds the
 *  pathological case, and HEAD_KEEP protects the opening decisions from being the ones dropped. */
const MAX_EVENTS = 40;
const HEAD_KEEP = 8;
const MAX_PROGRESS = 10;

/** The build and the machine, stamped on every session this process records. */
const HEAD: Omit<SessionHead, "device"> & { device: Omit<SessionHead["device"], "decode"> } = {
  schemaVersion: SCHEMA_VERSION,
  app: { name: BRAND_NAME, version: APP_VERSION, build: APP_BUILD_NUMBER },
  os: { name: Platform.isTV ? "tvOS" : "iOS", version: String(Platform.Version) },
  device: { family: THIS_DEVICE, model: DEVICE_MODEL, marketingName: DEVICE_MARKETING_NAME, cores: DEVICE_CORES, memoryBytes: DEVICE_MEMORY_BYTES },
};

let deviceDecode: DeviceDecode | null = null;

/** What VideoToolbox opens here, once the engine has asked it (services/localRemux.ts). */
export function noteDeviceDecode(decode: DeviceDecode): void {
  deviceDecode = decode;
}

let sink: string | null = null;
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
    // Caches, beside the session log: tvOS gives an app no writable Documents
    // directory, so on an Apple TV this wrote nothing at all and every device
    // run of the regression suite read an empty file.
    const file = new File(Paths.cache, PROBE_FILENAME);
    file.write(lines.join("\n") + "\n");
  } catch (error) {
    logger.warn("Playback probe write failed", error, { service: "PlaybackProbe" });
  }
}

let sending: Promise<void> = Promise.resolve();

/** One chain, so the driver receives events in the order they happened. */
function post(url: string, line: string): void {
  sending = sending
    .then(async () => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: line });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    })
    .catch((error) => logger.warn("Playback probe send failed", error, { service: "PlaybackProbe" }));
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

let sessionWriting = false;
let pendingSnapshot: string | null = null;
/** Bumped by every clear, so a write that lands after one is deleted. */
let clearCount = 0;

/** Events that do not decide the session ride one trailing write instead of one each. */
const SESSION_WRITE_DELAY_MS = 5000;
let sessionWriteTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSessionWrite(): void {
  if (sessionWriteTimer) return;
  sessionWriteTimer = setTimeout(() => {
    sessionWriteTimer = null;
    writeSession();
  }, SESSION_WRITE_DELAY_MS);
  (sessionWriteTimer as unknown as { unref?: () => void }).unref?.();
}

function cancelSessionWrite(): void {
  if (!sessionWriteTimer) return;
  clearTimeout(sessionWriteTimer);
  sessionWriteTimer = null;
}

function flushSessionWrite(): void {
  cancelSessionWrite();
  writeSession();
}

// Backgrounding is the last chance before a kill: the coalesced events land at once.
try {
  AppState.addEventListener("change", (state) => {
    if (state === "background") flushSessionWrite();
  });
} catch {
  // Test runtimes that stub react-native without AppState.
}

/** Mirrors memory to disk off the JS thread, one write at a time; events arriving while one lands
 *  leave only the latest snapshot waiting. Nothing empty is ever written, so a blank session cannot
 *  replace a stored one. */
function writeSession(): void {
  if (!session?.playback.events.length) return;
  const snapshot = JSON.stringify(session);
  if (sessionWriting) {
    pendingSnapshot = snapshot;
    return;
  }
  landSnapshot(snapshot);
}

function landSnapshot(snapshot: string): void {
  sessionWriting = true;
  const clears = clearCount;
  writeAsStringAsync(sessionFile().uri, snapshot)
    .catch((error) => logger.warn("Session log write failed", error, { service: "PlaybackProbe" }))
    .finally(() => {
      sessionWriting = false;
      // Cleared while it landed: the file it left belongs to the forgotten session.
      if (clears !== clearCount) deleteSessionFile();
      const next = pendingSnapshot;
      pendingSnapshot = null;
      if (next) landSnapshot(next);
    });
}

function deleteSessionFile(): void {
  try {
    const file = sessionFile();
    if (file.exists) file.delete();
  } catch (error) {
    logger.warn("Session log delete failed", error, { service: "PlaybackProbe" });
  }
}

/** Replaces whatever the last playback left, a replay of the same item included. One session
 *  is kept, never a history. */
function startSession(videoId: string): void {
  // The player mounts before it has an id; recording that would persist an empty session
  // over a real one.
  if (!videoId) return;
  // A write still pending belongs to the session being replaced.
  cancelSessionWrite();
  session = { ...HEAD, device: { ...HEAD.device, decode: deviceDecode }, playback: { itemId: videoId, startedAt: Date.now(), outcome: "playing", events: [], progress: [] } };
  lastProgressAt = 0;
}

function recordSession(event: string, entry: SessionEvent): void {
  if (!session) return;
  const { playback } = session;
  if (event === "progress") {
    // Memory only: a position every 2s is not worth a disk write; the next event's carries it.
    playback.progress.push({ t: entry.t, position: Number(entry.position) });
    if (playback.progress.length > MAX_PROGRESS) playback.progress.shift();
  } else {
    playback.events.push(redactEntry(entry));
    // Drop from just after the head, so the first decisions and the latest activity both survive.
    if (playback.events.length > MAX_EVENTS) playback.events.splice(HEAD_KEEP, 1);
    // An error the player retries is not the verdict; the playback that follows decides it.
    if (event === "ended") playback.outcome = "ended";
    if (event === "error" && !entry.willRetry) playback.outcome = "error";
    // The events that decide the session land at once; the rest coalesce into one write.
    if (event === "playing" || event === "ended" || event === "error") flushSessionWrite();
    else scheduleSessionWrite();
  }
  notifySession();
}

/** The last playback: memory first, falling back to the file a reload or a crash left behind. */
export function readLastSession(): PlaybackSession | null {
  if (session?.playback.events.length) return session;
  try {
    const file = sessionFile();
    if (!file.exists) return null;
    return parseSession(JSON.parse(file.textSync()), THIS_DEVICE);
  } catch (error) {
    logger.warn("Session log read failed", error, { service: "PlaybackProbe" });
    return null;
  }
}

/** Forgets the last playback, memory and file. A playback still running records nothing more. */
export function clearLastSession(): void {
  session = null;
  pendingSnapshot = null;
  cancelSessionWrite();
  clearCount += 1;
  deleteSessionFile();
  notifySession();
}

/**
 * Arm the probe for one playback with the deep link's probe param, or disarm it with null.
 * Arming resets the event log, so a Metro reload cannot leak a previous run's events.
 */
export function setPlaybackProbeEnabled(probe: string | null, videoId: string): void {
  startSession(videoId);
  if (!__DEV__) return;
  if (!probe) {
    sink = null;
    return;
  }
  if (sink !== probe || itemId !== videoId) {
    sink = probe;
    itemId = videoId;
    lines = [];
    lastProgressAt = 0;
    // A verdict an earlier item recorded would pick this item's lane before the one the driver asserts.
    if (probe !== FILE_SINK) clearVerdicts();
    probeEmit("start");
  }
}

/**
 * Record one event into both sinks. Nothing in here may throw into the caller: these calls
 * sit inside the playback path, and a diagnostics failure must not become a playback one.
 */
export function probeEmit(event: string, data?: Record<string, unknown>): void {
  try {
    // The session names the item for every playback; the armed id only stands in before one opens.
    const id = session?.playback.itemId ?? itemId;
    const entry: SessionEvent = { t: Date.now(), event, ...(id ? { itemId: id } : {}), ...data };
    recordSession(event, entry);
    if (!sink) return;
    const line = JSON.stringify(entry);
    if (sink !== FILE_SINK) return post(sink, line);
    lines.push(line);
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
  if (!session || session.playback.events.some((event) => event.event === "playing")) return;
  probeEmit("playing", { afterSeconds: Math.round((Date.now() - session.playback.startedAt) / 100) / 10 });
}

/** Throttled position sample from onProgress. */
export function probeProgress(positionSeconds: number): void {
  const now = Date.now();
  if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
  lastProgressAt = now;
  probeEmit("progress", { position: positionSeconds });
}
