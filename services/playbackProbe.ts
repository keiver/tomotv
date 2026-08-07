/**
 * playbackProbe.ts
 *
 * Dev-only event recorder for the playback regression suite
 * (scripts/playback-regression.mjs). The driver deep-links the player with
 * probe=1, this module records what the playback state machine actually did
 * (chosen mode, stream URL, errors, transcode fallbacks, position) to
 * Documents/playback-probe.jsonl, and the driver reads that file from the app
 * container to assert against the manifest's expectations.
 *
 * Inert unless BOTH __DEV__ and the probe=1 deep-link param are present, so it
 * costs release builds and normal dev playback nothing.
 */
import { File, Paths } from "expo-file-system";
import { logger } from "@/utils/logger";

export const PROBE_FILENAME = "playback-probe.jsonl";

/** Seconds between recorded progress samples; the driver only needs coarse advancement. */
const PROGRESS_INTERVAL_MS = 2000;

let enabled = false;
let itemId: string | null = null;
let lines: string[] = [];
let lastProgressAt = 0;

function flush(): void {
  try {
    const file = new File(Paths.document, PROBE_FILENAME);
    file.write(lines.join("\n") + "\n");
  } catch (error) {
    logger.warn("Playback probe write failed", error, { service: "PlaybackProbe" });
  }
}

/**
 * Arm or disarm the probe for one playback. Arming resets the event log so
 * every driver-launched playback starts a fresh file (the driver cold-starts
 * the app per item, but a Metro reload must not leak a previous run's events).
 */
export function setPlaybackProbeEnabled(on: boolean, videoId: string): void {
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

/** Record one event and rewrite the probe file (tiny; a run stays under ~100 lines). */
export function probeEmit(event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  lines.push(JSON.stringify({ t: Date.now(), event, itemId, ...data }));
  flush();
}

/** Throttled position sample from onProgress. */
export function probeProgress(positionSeconds: number): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
  lastProgressAt = now;
  probeEmit("progress", { position: positionSeconds });
}
