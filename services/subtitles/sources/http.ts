/**
 * What every outside provider needs from the network: a named client, a timeout, JSON or bytes,
 * and a subtitle file read out of whatever wrapper the provider sends it in.
 */
import { strFromU8, unzipSync } from "fflate";
import { APP_VERSION } from "@/constants/app";
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { formatOf, TEXT_FORMATS } from "../convert";
import { SourceRefusal, type SubtitleFile, type SubtitleSourceId } from "../types";

export const CLIENT_NAME = `TomoTV v${APP_VERSION || "0"}`;
export const PROVIDER_TIMEOUT_MS = 15000;

/** Statuses after which a provider is left alone for the rest of the session. */
export function isRefusal(status: number): boolean {
  return status === 401 || status === 403 || status === 406 || status === 429 || status >= 500;
}

export async function providerFetch(source: SubtitleSourceId, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { "User-Agent": CLIENT_NAME, Accept: "application/json", ...((init.headers as Record<string, string> | undefined) ?? {}) };
  const response = await fetchWithTimeout(url, { ...init, headers }, PROVIDER_TIMEOUT_MS);
  if (isRefusal(response.status)) throw new SourceRefusal(source, response.status, `${source} answered ${response.status}`);
  return response;
}

export async function providerJson<T>(source: SubtitleSourceId, url: string, init: RequestInit = {}): Promise<T | null> {
  const response = await providerFetch(source, url, init);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function providerBytes(source: SubtitleSourceId, url: string, init: RequestInit = {}): Promise<Uint8Array | null> {
  const response = await providerFetch(source, url, { ...init, headers: { Accept: "*/*", ...((init.headers as Record<string, string> | undefined) ?? {}) } });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function decodeText(bytes: Uint8Array): string {
  return strFromU8(bytes).replace(/^﻿/, "");
}

/**
 * The subtitle inside a provider's download: a zip is opened and its one subtitle entry read
 * (the largest, when a pack carries several), a plain file is read as it is.
 */
export function unpackSubtitle(bytes: Uint8Array, fileNameHint: string): SubtitleFile | null {
  if (!isZip(bytes)) {
    const format = formatOf(fileNameHint);
    return { text: decodeText(bytes), format };
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  const candidates = Object.entries(entries)
    .filter(([name, data]) => data.length > 0 && TEXT_FORMATS.includes(formatOf(name)))
    .sort((a, b) => b[1].length - a[1].length);
  if (candidates.length === 0) return null;
  const [name, data] = candidates[0];
  return { text: decodeText(data), format: formatOf(name) };
}
