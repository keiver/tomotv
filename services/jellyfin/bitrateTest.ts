/**
 * bitrateTest.ts
 *
 * Bandwidth measurement against the configured server via Jellyfin's own
 * /Playback/BitrateTest endpoint (the jellyfin-web pattern: it downloads junk
 * bytes and times them). Staged like jellyfin-apiclient: a small probe first,
 * a larger one only when the link looks fast enough for the small one to be
 * timer-noise. Measured values are remembered per server host so the next
 * session's Auto pick starts informed before its first measurement lands.
 */

import * as SecureStore from "expo-secure-store";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS, STORAGE_KEYS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig } from "./session";

/** Probe sizes in bytes: quick first stage, refining second stage. */
const STAGE_SIZES = [500_000, 2_000_000];
/** A first stage faster than this (seconds) is timer-noise; run the big stage. */
const REFINE_THRESHOLD_SEC = 0.7;
/** Remembered measurements older than this seed nothing. */
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
/** App-start warm-up re-measures entries older than this: launch is an idle
 * moment, so the reading is clean, and it heals any drift. */
const REFRESH_AGE_MS = 15 * 60 * 1000;

interface BitrateMemory {
  [serverHost: string]: { bps: number; at: number };
}

function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

async function readMemory(): Promise<BitrateMemory> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.BITRATE_MEMORY);
    return raw ? (JSON.parse(raw) as BitrateMemory) : {};
  } catch {
    return {};
  }
}

/** Last measured bandwidth for the configured server, or null when unknown/stale. */
export async function rememberedBitrate(): Promise<number | null> {
  const config = await getConfig();
  if (!config.server) return null;
  const memory = await readMemory();
  const entry = memory[serverHost(config.server)];
  if (!entry || Date.now() - entry.at > MEMORY_TTL_MS) return null;
  return entry.bps;
}

/**
 * Settings surface: the remembered value with a freshness verdict. `fresh`
 * uses the same REFRESH_AGE window as the launch warm-up, so the screen
 * re-measures exactly when the warm-up would have.
 */
export async function rememberedBitrateStatus(): Promise<{ bps: number; fresh: boolean } | null> {
  const config = await getConfig();
  if (!config.server) return null;
  const entry = (await readMemory())[serverHost(config.server)];
  if (!entry || Date.now() - entry.at > MEMORY_TTL_MS) return null;
  return { bps: entry.bps, fresh: Date.now() - entry.at < REFRESH_AGE_MS };
}

async function remember(server: string, bps: number): Promise<void> {
  try {
    const memory = await readMemory();
    memory[serverHost(server)] = { bps, at: Date.now() };
    await SecureStore.setItemAsync(STORAGE_KEYS.BITRATE_MEMORY, JSON.stringify(memory));
  } catch (error) {
    logger.debug("Bitrate memory write failed", { service: "BitrateTest", error: String(error) });
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

/**
 * Warm the per-server bitrate memory in the background: measure only when no
 * fresh memory exists, after a delay so app launch and the library's first
 * paint never compete with the probe download. A session that starts before
 * this lands measures inline instead (the Auto path in useVideoPlayback).
 */
export function warmBitrateMemory(delayMs: number = 5_000): void {
  setTimeout(() => {
    void (async () => {
      const config = await getConfig();
      if (!config.server) return;
      const entry = (await readMemory())[serverHost(config.server)];
      if (entry && Date.now() - entry.at < REFRESH_AGE_MS) return;
      await measureServerBitrate();
    })();
  }, delayMs);
}

/**
 * Measure the link to the configured server, in bits/second. Remembers the
 * result per server unless `remember` is false — an in-playback probe shares
 * the link with the player's own segment downloads, so its reading bounds the
 * LEFTOVER bandwidth: safe for a step-up decision, poison as routing memory.
 * Null on any failure — callers fall back to their ceiling, which is exactly
 * the pre-adaptive behavior.
 */
export async function measureServerBitrate(options?: { remember?: boolean }): Promise<number | null> {
  try {
    const config = await getConfig();
    if (!config.server || !config.apiKey) return null;
    const stageStart = Date.now();
    let bps = await timeStage(config.server, config.deviceId, config.apiKey, STAGE_SIZES[0]);
    if (bps == null) return null;
    if ((Date.now() - stageStart) / 1000 < REFINE_THRESHOLD_SEC) {
      const refined = await timeStage(config.server, config.deviceId, config.apiKey, STAGE_SIZES[1]);
      if (refined != null) bps = refined;
    }
    logger.info("Server bitrate measured", { service: "BitrateTest", mbps: Math.round(bps / 100_000) / 10, remembered: options?.remember !== false });
    if (options?.remember !== false) await remember(config.server, bps);
    return bps;
  } catch (error) {
    logger.debug("Bitrate test failed", { service: "BitrateTest", error: String(error) });
    return null;
  }
}
