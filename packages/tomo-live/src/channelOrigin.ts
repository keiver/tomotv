import { canProbeOrigin, engineLog, probeOriginReach, type OriginReach } from "@keiver/tomo-engine";

/** What the engine reads for a live channel: the origin's stream, with the headers it requires. */
export interface ChannelOrigin {
  url: string;
  headers?: Record<string, string>;
  /** A raw TS channel: the provider whose connection budget a grab spends, and the server's pass-through. */
  originKey?: string;
  fallbackUrl?: string;
}

/** `url|User-Agent=x&Referer=y`, split as packages/tomo-engine/ios/LiveSources/M3uParser.swift splits it. */
export function splitPipeHeaders(raw: string): { url: string; headers: Record<string, string> } {
  const pipe = raw.indexOf("|");
  if (pipe < 0) return { url: raw, headers: {} };
  const headers: Record<string, string> = {};
  for (const pair of raw.slice(pipe + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    let name = pair.slice(0, eq).trim().toLowerCase();
    if (name.startsWith("!")) name = name.slice(1);
    if (name === "referrer") name = "referer";
    if (!name) continue;
    const encoded = pair.slice(eq + 1);
    try {
      headers[name] = decodeURIComponent(encoded);
    } catch {
      headers[name] = encoded;
    }
  }
  return { url: raw.slice(0, pipe), headers };
}

/** The provider's host and port, the key its connection budget hangs on: two servers on one address never share it. */
export function originKeyOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)(:\d+)?/i.exec(url);
  return match ? match[1].toLowerCase() + (match[2] ?? "") : url;
}

/** `base` under `own`, one name each whatever its case; undefined when nothing is left. */
export function mergeOriginHeaders(base: Record<string, string> | undefined, own: Record<string, string>): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(base ?? {})) {
    if (!Object.keys(own).some((key) => key.toLowerCase() === name.toLowerCase())) merged[name] = value;
  }
  Object.assign(merged, own);
  return Object.keys(merged).length ? merged : undefined;
}

/**
 * The key scheme of a playlist that no lane can play: SAMPLE-AES (FFmpeg decodes none of it) or
 * a key format other than a plain key (FairPlay, Widevine, PlayReady). AES-128 with a key URI
 * is not that: FFmpeg fetches the key and decrypts.
 */
export function drmKeyFormat(playlist: string): string | null {
  for (const line of playlist.split(/\r?\n/)) {
    const tag = /^#EXT-X-(?:SESSION-)?KEY:(.*)$/.exec(line.trim());
    if (!tag) continue;
    const attributes = `,${tag[1]}`;
    const method = /,METHOD=([A-Z0-9-]+)/.exec(attributes)?.[1] ?? "NONE";
    const keyFormat = /,KEYFORMAT="([^"]*)"/.exec(attributes)?.[1] ?? "identity";
    if (method.startsWith("SAMPLE-AES")) return keyFormat === "identity" ? method : keyFormat;
    if (method !== "NONE" && keyFormat !== "identity") return keyFormat;
  }
  return null;
}

/** The DRM system an MPD names in its first ContentProtection, null for a clear presentation. */
export function dashProtection(mpd: string): string | null {
  const tag = /<ContentProtection\b([^>]*)>/i.exec(mpd);
  if (!tag) return null;
  return /\bschemeIdUri="(urn:uuid:[^"]+)"/i.exec(tag[1])?.[1] ?? /\bvalue="([^"]+)"/i.exec(tag[1])?.[1] ?? "ContentProtection";
}

/** The first variant's URI of a multivariant playlist, absolute; null for a media playlist. */
function firstVariantUrl(master: string, base: string): string | null {
  const lines = master.split(/\r?\n/).map((line) => line.trim());
  const at = lines.findIndex((line) => line.startsWith("#EXT-X-STREAM-INF:"));
  const uri = at < 0 ? undefined : lines.slice(at + 1).find((line) => line && !line.startsWith("#"));
  if (!uri) return null;
  try {
    return new URL(uri, base).toString();
  } catch {
    return null;
  }
}

async function readText(url: string, headers: Record<string, string> | undefined, timeoutMs: number): Promise<{ text: string; landed: string } | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: headers ?? {}, signal: abort.signal });
    return response.ok ? { text: await response.text(), landed: response.url || url } : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The DRM system a manifest channel is locked with, read off its master and one media playlist, or
 * null when it plays (or could not be read: the engine's own open is the judge then). A DRM channel
 * fails here, in a second, and not after the engine has timed out on it.
 */
export async function manifestDrm(masterUrl: string, headers?: Record<string, string>, timeoutMs = 5000): Promise<string | null> {
  let master: { text: string; landed: string } | null;
  try {
    master = await readText(masterUrl, headers, timeoutMs);
  } catch (error) {
    engineLog().debug("Origin master unreadable ahead of the engine", { service: "ChannelOrigin", error: String(error) });
    return null;
  }
  if (!master) return null;
  if (/<MPD\b/i.test(master.text)) return dashProtection(master.text);
  const sessionKey = drmKeyFormat(master.text);
  if (sessionKey) return sessionKey;
  const media = firstVariantUrl(master.text, master.landed);
  if (!media) return null;
  try {
    const variant = await readText(media, headers, timeoutMs);
    return variant ? drmKeyFormat(variant.text) : null;
  } catch (error) {
    engineLog().debug("Origin variant unreadable ahead of the engine", { service: "ChannelOrigin", error: String(error) });
    return null;
  }
}

const REACH_TIMEOUT_MS = 1500;
const REACH_TTL_MS = 2 * 60_000;
const reachByHost = new Map<string, { reach: OriginReach; at: number }>();

/** The origin lane needs the engine's reach check and connection broker. */
export function isOriginLaneAvailable(): boolean {
  return canProbeOrigin();
}

/** Whether this device reaches the channel's host, remembered per host for two minutes. */
export async function originReach(url: string): Promise<OriginReach> {
  const host = originKeyOf(url);
  const held = reachByHost.get(host);
  if (held && Date.now() - held.at < REACH_TTL_MS) return held.reach;
  let reach: OriginReach = "silent";
  try {
    reach = await probeOriginReach(url, REACH_TIMEOUT_MS);
  } catch (error) {
    engineLog().warn("Live origin reach check failed", error, { service: "ChannelOrigin", host });
  }
  reachByHost.set(host, { reach, at: Date.now() });
  return reach;
}

/** Channel hosts repeat across networks: a network or account switch forgets every reach. */
export function resetOriginReach(): void {
  reachByHost.clear();
}
