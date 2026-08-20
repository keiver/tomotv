/**
 * bitrateTest.ts
 *
 * Bandwidth measurement against the configured server via Jellyfin's own
 * /Playback/BitrateTest endpoint (the jellyfin-web pattern: it downloads junk
 * bytes and times them). Staged like jellyfin-apiclient: a small probe first,
 * a larger one only when the link looks fast enough for the small one to be
 * timer-noise.
 *
 * A reading belongs to a server AND to the network it was taken on, because
 * those are the two things that make it wrong. Same subnet: it stands however
 * old it is, since the routing gate in useVideoPlayback would rather have a
 * stale LAN number than none. Different subnet: it is void however fresh it is.
 * Age drives RE-MEASUREMENT, never discard.
 */

import * as SecureStore from "expo-secure-store";
import { describeSubnet, getLocalNetworkInfo } from "@/services/localNetworkIdentity";
import { isPlaybackHeld } from "@/services/playbackHold";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS, STORAGE_KEYS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig } from "./session";

/** Probe sizes in bytes: quick first stage, refining second stage. */
const STAGE_SIZES = [500_000, 2_000_000];
/** A first stage faster than this (seconds) is timer-noise; run the big stage. */
const REFINE_THRESHOLD_SEC = 0.7;
/** Backstop for a reading with no network identity: age is all that is left to judge it by. */
const UNKNOWN_NETWORK_TTL_MS = 24 * 60 * 60 * 1000;
/** Past this a trigger re-measures. The reading keeps answering until the new one lands. */
const REFRESH_AGE_MS = 15 * 60 * 1000;
/** A host whose probe just failed is left alone this long, whatever fires next. */
const FAILURE_BACKOFF_MS = 60 * 1000;
/** Navigation bursts collapse into one attempt this far after the first of them. */
const NUDGE_DEBOUNCE_MS = 2 * 1000;
/** Floor between two navigation-driven attempts. */
const NUDGE_THROTTLE_MS = 60 * 1000;
/** The subnet read is cached this long, so a Wi-Fi handoff surfaces within it. */
const NETWORK_ID_TTL_MS = 10 * 1000;

interface BitrateEntry {
  bps: number;
  at: number;
  /** Subnet the reading was taken on; absent on entries written before this existed. */
  net?: string | null;
}

interface BitrateMemory {
  [serverHost: string]: BitrateEntry;
}

/** Hosts whose last probe failed. Session-only: a relaunch retries clean. */
const failedAt = new Map<string, number>();
/** The one memory probe in flight, shared by every caller. */
let inFlight: Promise<number | null> | null = null;
let cachedNetworkId: { id: string | null; at: number } | null = null;
let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
let lastNudgeAt = 0;
/** The launch warm-up owns the first measurement; navigation only takes over after it. */
let warmedOnce = false;

function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

/** The subnet the device is on, or null when it cannot be read. */
async function currentNetworkId(): Promise<string | null> {
  if (cachedNetworkId && Date.now() - cachedNetworkId.at < NETWORK_ID_TTL_MS) return cachedNetworkId.id;
  let id: string | null = null;
  try {
    const info = await getLocalNetworkInfo();
    id = info ? describeSubnet(info.ip, info.netmask) : null;
  } catch (error) {
    logger.debug("Network identity unavailable", { service: "BitrateTest", error: String(error) });
  }
  cachedNetworkId = { id, at: Date.now() };
  return id;
}

/**
 * Does this entry still answer for the link in front of us? Matching subnets say
 * yes at any age. A different subnet is a different link. Unknown on either side
 * leaves only the age backstop.
 */
function entryAnswersFor(entry: BitrateEntry | undefined, networkId: string | null): entry is BitrateEntry {
  if (!entry) return false;
  if (networkId != null && entry.net != null) return entry.net === networkId;
  return Date.now() - entry.at < UNKNOWN_NETWORK_TTL_MS;
}

async function readMemory(): Promise<BitrateMemory> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.BITRATE_MEMORY);
    return raw ? (JSON.parse(raw) as BitrateMemory) : {};
  } catch {
    return {};
  }
}

/** The active server's entry alongside the network it has to answer for. */
async function activeEntry(): Promise<{ host: string; entry: BitrateEntry | undefined; networkId: string | null } | null> {
  const config = await getConfig();
  if (!config.server) return null;
  const host = serverHost(config.server);
  const [memory, networkId] = await Promise.all([readMemory(), currentNetworkId()]);
  return { host, entry: memory[host], networkId };
}

/** Last measured bandwidth for the configured server, or null when nothing answers for this link. */
export async function rememberedBitrate(): Promise<number | null> {
  const active = await activeEntry();
  if (!active) return null;
  return entryAnswersFor(active.entry, active.networkId) ? active.entry.bps : null;
}

/**
 * Settings surface: the reading with a freshness verdict. `fresh` uses the same
 * window as the triggers, so the screen re-measures exactly when they would.
 */
export async function rememberedBitrateStatus(): Promise<{ bps: number; fresh: boolean } | null> {
  const active = await activeEntry();
  if (!active || !entryAnswersFor(active.entry, active.networkId)) return null;
  return { bps: active.entry.bps, fresh: Date.now() - active.entry.at < REFRESH_AGE_MS };
}

async function remember(server: string, bps: number, net: string | null): Promise<void> {
  try {
    const memory = await readMemory();
    memory[serverHost(server)] = { bps, at: Date.now(), net };
    await SecureStore.setItemAsync(STORAGE_KEYS.BITRATE_MEMORY, JSON.stringify(memory));
  } catch (error) {
    logger.warn("Bitrate memory write failed", error, { service: "BitrateTest" });
  }
}

async function timeStage(server: string, deviceId: string, apiKey: string | undefined, size: number): Promise<number | null> {
  const started = Date.now();
  const response = await fetchWithTimeout(`${server}/Playback/BitrateTest?Size=${size}`, { method: "GET", headers: { Authorization: getAuthHeader(deviceId, apiKey) } }, API_TIMEOUTS.NORMAL);
  if (!response.ok) return null;
  // React Native's fetch delivers the body fully before resolving json/blob;
  // arrayBuffer keeps the timing honest without a text decode.
  const body = await response.arrayBuffer();
  const seconds = (Date.now() - started) / 1000;
  if (seconds <= 0 || body.byteLength === 0) return null;
  return (body.byteLength * 8) / seconds;
}

async function runProbe(shouldRemember: boolean): Promise<number | null> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return null;
  const host = serverHost(config.server);
  try {
    const stageStart = Date.now();
    let bps = await timeStage(config.server, config.deviceId, config.apiKey, STAGE_SIZES[0]);
    if (bps == null) {
      if (shouldRemember) failedAt.set(host, Date.now());
      logger.warn("Bitrate test returned nothing usable", { service: "BitrateTest", host });
      return null;
    }
    if ((Date.now() - stageStart) / 1000 < REFINE_THRESHOLD_SEC) {
      // A refine that dies keeps the first stage: it measured the same link.
      try {
        const refined = await timeStage(config.server, config.deviceId, config.apiKey, STAGE_SIZES[1]);
        if (refined != null) bps = refined;
      } catch (error) {
        logger.warn("Bitrate refine stage failed, keeping the small-stage reading", error, { service: "BitrateTest" });
      }
    }
    failedAt.delete(host);
    logger.info("Server bitrate measured", { service: "BitrateTest", mbps: Math.round(bps / 100_000) / 10, remembered: shouldRemember });
    if (shouldRemember) await remember(config.server, bps, await currentNetworkId());
    return bps;
  } catch (error) {
    // Only the memory probe feeds the backoff: the in-playback one shares the
    // link with the player's segments, so its failures say nothing about the host.
    if (shouldRemember) failedAt.set(host, Date.now());
    logger.warn("Bitrate test failed", error, { service: "BitrateTest", host });
    return null;
  }
}

/**
 * Measure the link to the configured server, in bits/second.
 *
 * Concurrent callers share one download: a server switch arms both the warm-up
 * and the settings read, and two probes on one link only measure each other.
 *
 * `remember: false` is the in-playback probe and stays outside that sharing. It
 * runs while the player has the link, so its reading bounds the LEFTOVER
 * bandwidth: safe for a step-up decision, poison as routing memory.
 *
 * Null on any failure — callers fall back to their ceiling, which is exactly the
 * pre-adaptive behavior.
 */
export async function measureServerBitrate(options?: { remember?: boolean }): Promise<number | null> {
  if (options?.remember === false) return runProbe(false);
  if (!inFlight) {
    inFlight = runProbe(true).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Measure unless something already answers for this link: a reading on this
 * network inside the refresh window, a failure still inside its backoff, or
 * playback holding the link.
 */
async function warmIfStale(): Promise<void> {
  if (isPlaybackHeld()) return;
  // Every trigger re-reads the interface: a foreground or a switch is exactly
  // when the device may have moved networks.
  cachedNetworkId = null;
  const config = await getConfig();
  if (!config.server || !config.apiKey) return;
  const host = serverHost(config.server);
  const failed = failedAt.get(host);
  if (failed != null && Date.now() - failed < FAILURE_BACKOFF_MS) return;
  const active = await activeEntry();
  if (active && entryAnswersFor(active.entry, active.networkId) && Date.now() - active.entry.at < REFRESH_AGE_MS) return;
  await measureServerBitrate();
}

/**
 * Warm the memory in the background: launch, sign-in, account switch, a URL the
 * recovery ladder adopted, a foreground. The delay keeps the probe download off
 * app launch and the library's first paint.
 */
export function warmBitrateMemory(delayMs: number = 5_000): void {
  setTimeout(() => {
    warmedOnce = true;
    void warmIfStale();
  }, delayMs);
}

/**
 * Navigation-rate entry point. A burst collapses into one attempt and attempts
 * are floored a minute apart, so browsing costs a keychain read rather than a
 * download. What it protects is the routing gate in useVideoPlayback: that gate
 * reads this memory and deliberately never probes for itself, so a session that
 * starts on cold memory silently loses it.
 */
export function nudgeBitrateMemory(): void {
  // The launch warm-up is delayed off the first paint on purpose, and the first
  // navigation lands well inside that delay.
  if (!warmedOnce) return;
  if (nudgeTimer != null) return;
  if (Date.now() - lastNudgeAt < NUDGE_THROTTLE_MS) return;
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    lastNudgeAt = Date.now();
    void warmIfStale();
  }, NUDGE_DEBOUNCE_MS);
}
