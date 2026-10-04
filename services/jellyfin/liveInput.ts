/**
 * Where the engine reads a raw MPEG-TS channel: its own origin when the server allows direct play and this device
 * reaches the host, else the server's pass-through of the same stream. Neither opens anything on the server.
 */
import { canProbeOrigin, probeOriginReach, type OriginReach } from "@keiver/tomo-engine";
import type { JellyfinMediaSource } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

const REACH_TIMEOUT_MS = 1500;
const REACH_TTL_MS = 2 * 60_000;

export type { OriginReach };

export interface RawLiveInput {
  url: string;
  headers?: Record<string, string>;
  /** The provider whose connections the read counts against; the engine learns each provider's limit from its refusals. */
  originKey: string;
  /** The server's pass-through, read once when the origin will not open. */
  fallbackUrl?: string;
  via: "origin" | "server";
}

const reachByHost = new Map<string, { reach: OriginReach; at: number }>();

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

export function originKeyOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : url;
}

/** The server's headers under the playlist's own, one name each whatever its case. */
function mergeHeaders(base: Record<string, string> | undefined, own: Record<string, string>): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(base ?? {})) {
    if (!Object.keys(own).some((key) => key.toLowerCase() === name.toLowerCase())) merged[name] = value;
  }
  Object.assign(merged, own);
  return Object.keys(merged).length ? merged : undefined;
}

/** The origin lane needs the engine's reach check and connection broker; a build without them keeps the server open. */
export function isOriginLaneAvailable(): boolean {
  return canProbeOrigin();
}

async function reachOf(url: string): Promise<OriginReach> {
  const host = originKeyOf(url);
  const held = reachByHost.get(host);
  if (held && Date.now() - held.at < REACH_TTL_MS) return held.reach;
  let reach: OriginReach = "silent";
  try {
    reach = await probeOriginReach(url, REACH_TIMEOUT_MS);
  } catch (error) {
    logger.warn("Live origin reach check failed", error, { service: "LiveInput", host });
  }
  reachByHost.set(host, { reach, at: Date.now() });
  return reach;
}

/**
 * The input for a raw TS channel, or null when the server must open it: a manifest, a non-HTTP tuner (HDHomeRun
 * answers Udp), or a tuner whose stream limit or looping turns direct play off (M3UTunerHost.cs `supportsDirectPlay`).
 */
export async function rawLiveInput(server: string, apiKey: string, channelId: string, source: JellyfinMediaSource): Promise<RawLiveInput | null> {
  if (!isOriginLaneAvailable() || !source.Path || !/^https?$/i.test(source.Protocol ?? "") || source.SupportsDirectPlay !== true) return null;
  const { url, headers: own } = splitPipeHeaders(source.Path);
  if (!/^https?:\/\//i.test(url) || /\.(?:m3u8?|mpd)(?:$|\?)/i.test(url)) return null;
  const originKey = originKeyOf(url);
  const passThrough = `${server}/Videos/${channelId}/stream?static=true&ApiKey=${encodeURIComponent(apiKey)}`;
  if ((await reachOf(url)) !== "reachable") return { url: passThrough, originKey, via: "server" };
  return { url, headers: mergeHeaders(source.RequiredHttpHeaders, own), originKey, fallbackUrl: passThrough, via: "origin" };
}

/** Channel hosts repeat across servers and networks: a switch forgets every reach. */
export function resetLiveInput(): void {
  reachByHost.clear();
}
