/**
 * bitrateTest.ts
 *
 * Link capacity to the configured server, from real media only: between plays the engine's native
 * probe (RateProbe) times ten seconds of a library file's static stream.
 *
 * A reading is keyed to the server and to the subnet it was taken on: it stands at
 * any age on that subnet, is void on another, and age only drives re-measurement.
 */

import * as SecureStore from "expo-secure-store";
import { NativeModules } from "react-native";
import { playsFromDisk } from "@/services/downloads/localSource";
import { describeSubnet, getLocalNetworkInfo } from "@/services/localNetworkIdentity";
import { isPlaybackHeld } from "@/services/playbackHold";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { STORAGE_KEYS } from "./constants";
import { fetchLibraryVideos } from "./items";
import { isLiveSource } from "./media";
import { getAuthHeader, getConfig, type JellyfinConfig } from "./session";
import { getRemoteVideoStreamUrl } from "./streamUrls";

/** Newest library videos searched for one the server still has to send. */
const TARGET_CANDIDATES = 20;
/** NDT7's ten seconds: a shorter read can sit inside a burst allowance and report it as the link. */
const PROBE_BUDGET_MS = 10_000;
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

/** Makes every probe URL unique. An identical URL is eligible for the URL cache, and a cached
 *  body returns in milliseconds, which reads as a link an order of magnitude faster than it is. */
let probeNonce = 0;

/** Hosts whose last probe failed. Session-only: a relaunch retries clean. */
const failedAt = new Map<string, number>();
/** The memory probe in flight, shared by every caller asking about the same host. */
let inFlight: { host: string; probe: Promise<number | null> } | null = null;
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

/** Matching subnet answers at any age; unknown on either side leaves the age backstop. */
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

/** Settings surface: the reading plus the triggers' own freshness verdict. */
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

/** What the native probe read: the rate, whether it filled a window, and over how long. */
interface LinkReading {
  bps: number;
  kind: "full" | "short";
  seconds: number;
}

const engine = () => NativeModules.LocalRemuxer as { measureLink?: (url: string, headers: Record<string, string>, budgetMs: number) => Promise<LinkReading | null> } | undefined;

/** The file the probe reads: the newest library video not already on this device. */
async function probeTarget(): Promise<JellyfinVideoItem | null> {
  const remote = (item: JellyfinVideoItem) => !playsFromDisk(item.Id) && !isLiveSource(item);
  const { items } = await fetchLibraryVideos({ limit: TARGET_CANDIDATES });
  return items.find(remote) ?? null;
}

async function measureLink(config: JellyfinConfig): Promise<LinkReading | null> {
  const measure = engine()?.measureLink;
  if (typeof measure !== "function") return null;
  const item = await probeTarget();
  const stream = item ? getRemoteVideoStreamUrl(item.Id, item) : "";
  if (!stream) return null;
  const url = `${stream}&_probe=${Date.now()}-${probeNonce++}`;
  const reading = await measure(url, { Authorization: getAuthHeader(config.deviceId, config.apiKey), Range: "bytes=0-" }, PROBE_BUDGET_MS);
  return reading != null && Number.isFinite(reading.bps) && reading.bps > 0 ? reading : null;
}

async function runProbe(config: JellyfinConfig, host: string): Promise<number | null> {
  try {
    const reading = await measureLink(config);
    if (reading == null) {
      failedAt.set(host, Date.now());
      logger.warn("Bitrate test returned nothing usable", { service: "BitrateTest", host });
      return null;
    }
    const bps = reading.bps;
    const net = await currentNetworkId();
    failedAt.delete(host);
    logger.info("Server bitrate measured", {
      service: "BitrateTest",
      host,
      mbps: Math.round(bps / 100_000) / 10,
      kind: reading.kind,
      seconds: Math.round(reading.seconds * 1000) / 1000,
      net,
    });
    await remember(config.server, bps, net);
    return bps;
  } catch (error) {
    failedAt.set(host, Date.now());
    logger.warn("Bitrate test failed", error, { service: "BitrateTest", host });
    return null;
  }
}

/**
 * Measure the link to the configured server, in bits/second, by reading a library file, and keep
 * the reading. Concurrent callers share one download.
 */
export async function measureServerBitrate(): Promise<number | null> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return null;
  const host = serverHost(config.server);

  const failed = failedAt.get(host);
  if (failed != null && Date.now() - failed < FAILURE_BACKOFF_MS) return null;

  let current = inFlight;
  if (current?.host !== host) {
    current = {
      host,
      probe: runProbe(config, host).finally(() => {
        // A switch mid-probe already installed the next host; leave that one alone.
        if (inFlight?.host === host) inFlight = null;
      }),
    };
    inFlight = current;
  }
  return current.probe;
}

/**
 * The idle-moment measurement every background trigger and Settings share: it
 * declines to playback, to a reading still inside the refresh window, and (via
 * measureServerBitrate) to a host still inside its failure backoff.
 */
export async function measureIfIdle(): Promise<number | null> {
  if (isPlaybackHeld()) return null;
  // Every trigger re-reads the interface: this is when the device may have moved.
  cachedNetworkId = null;
  const active = await activeEntry();
  if (!active) return null;
  if (entryAnswersFor(active.entry, active.networkId) && Date.now() - active.entry.at < REFRESH_AGE_MS) return null;
  return measureServerBitrate();
}

/**
 * Warm the memory in the background: launch, sign-in, account switch, adopted URL,
 * foreground. The delay keeps the download off the library's first paint.
 */
export function warmBitrateMemory(delayMs: number = 5_000): void {
  setTimeout(() => {
    warmedOnce = true;
    void measureIfIdle();
  }, delayMs);
}

/**
 * Navigation-rate entry point, debounced and floored a minute apart, so browsing
 * costs a keychain read rather than a download.
 */
export function nudgeBitrateMemory(): void {
  // Inert until the warm-up runs: the first navigation lands inside its delay.
  if (!warmedOnce) return;
  if (nudgeTimer != null) return;
  if (Date.now() - lastNudgeAt < NUDGE_THROTTLE_MS) return;
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    lastNudgeAt = Date.now();
    void measureIfIdle();
  }, NUDGE_DEBOUNCE_MS);
}
