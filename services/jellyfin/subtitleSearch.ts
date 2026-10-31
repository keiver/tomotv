/**
 * The server's own subtitle search and the two ways a subtitle lands beside a video: the server
 * fetching one from its providers, or the app uploading one it found. Every call here needs the
 * account's EnableSubtitleManagement, search included.
 */
import { strToU8 } from "fflate";
import { invalidateRequest } from "@/services/requestCache";
import type { JellyfinMediaStream } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { fetchVideoDetails } from "./items";
import { getAuthHeader, getConfig } from "./session";
import { isImageBasedSubtitleCodec } from "./subtitles";

export interface RemoteSubtitleInfo {
  ThreeLetterISOLanguageName?: string | null;
  Id?: string | null;
  ProviderName?: string | null;
  Name?: string | null;
  Format?: string | null;
  Author?: string | null;
  Comment?: string | null;
  DateCreated?: string | null;
  CommunityRating?: number | null;
  FrameRate?: number | null;
  DownloadCount?: number | null;
  IsHashMatch?: boolean | null;
  AiTranslated?: boolean | null;
  MachineTranslated?: boolean | null;
  Forced?: boolean | null;
  HearingImpaired?: boolean | null;
}

type Snapshot = { server: string; userId: string; allowed: boolean };
let snapshot: Snapshot | null = null;
let reads = 0;

function authHeaders(config: { deviceId: string; apiKey: string }): Record<string, string> {
  return { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
}

/** Whether the signed-in account may search, fetch and upload subtitles, read once per account. */
export async function canManageSubtitles(): Promise<boolean> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return false;
  if (snapshot && snapshot.server === config.server && snapshot.userId === config.userId) return snapshot.allowed;
  const mine = ++reads;
  try {
    const response = await fetchWithTimeout(`${config.server}/Users/Me`, { method: "GET", headers: authHeaders(config) }, API_TIMEOUTS.QUICK);
    if (!response.ok) return false;
    const user = (await response.json()) as { Policy?: { EnableSubtitleManagement?: boolean } };
    if (mine !== reads) return false;
    snapshot = { server: config.server, userId: config.userId, allowed: user.Policy?.EnableSubtitleManagement === true };
    return snapshot.allowed;
  } catch (error) {
    logger.warn("Subtitle permission read failed", error, { service: "SubtitleSearch" });
    return false;
  }
}

/** For tests and sign-out: forget the account's answer. */
export function resetSubtitlePermission(): void {
  snapshot = null;
}

export interface ServerSearchAnswer {
  status: number;
  results: RemoteSubtitleInfo[];
}

/** The server's providers asked for one language (ISO 639-2). The status is kept: a refusal is the caller's to remember. */
export async function searchRemoteSubtitles(itemId: string, language3: string): Promise<ServerSearchAnswer> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return { status: 0, results: [] };
  const response = await fetchWithTimeout(
    `${config.server}/Items/${itemId}/RemoteSearch/Subtitles/${encodeURIComponent(language3)}`,
    { method: "GET", headers: authHeaders(config) },
    API_TIMEOUTS.EXTENDED,
  );
  if (!response.ok) return { status: response.status, results: [] };
  const body = (await response.json()) as RemoteSubtitleInfo[] | null;
  return { status: response.status, results: Array.isArray(body) ? body : [] };
}

/** The server fetches a provider's subtitle and saves it beside the video. Returns the HTTP status. */
export async function downloadRemoteSubtitle(itemId: string, subtitleId: string): Promise<number> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return 0;
  const response = await fetchWithTimeout(
    `${config.server}/Items/${itemId}/RemoteSearch/Subtitles/${encodeURIComponent(subtitleId)}`,
    { method: "POST", headers: authHeaders(config) },
    API_TIMEOUTS.EXTENDED,
  );
  return response.status;
}

/** A provider's subtitle file read through the server, for an account that keeps it on the device. */
export async function fetchRemoteSubtitleFile(subtitleId: string): Promise<{ status: number; text: string }> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return { status: 0, text: "" };
  const response = await fetchWithTimeout(
    `${config.server}/Providers/Subtitles/Subtitles/${encodeURIComponent(subtitleId)}`,
    { method: "GET", headers: { Accept: "*/*", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.EXTENDED,
  );
  if (!response.ok) return { status: response.status, text: "" };
  return { status: response.status, text: await response.text() };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 of a UTF-8 string, the shape UploadSubtitleDto.Data takes. */
export function toBase64Utf8(text: string): string {
  const bytes = strToU8(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63] + (i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : "=") + (i + 2 < bytes.length ? BASE64[triple & 63] : "=");
  }
  return out;
}

export interface SubtitleUpload {
  /** ISO 639-2, the suffix the server names the sidecar with. */
  language3: string;
  format: string;
  isForced: boolean;
  isHearingImpaired: boolean;
  text: string;
}

/** The app's own find, saved beside the video by the server. Returns the HTTP status. */
export async function uploadSubtitle(itemId: string, upload: SubtitleUpload): Promise<number> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return 0;
  const body = JSON.stringify({
    Language: upload.language3,
    Format: upload.format,
    IsForced: upload.isForced,
    IsHearingImpaired: upload.isHearingImpaired,
    Data: toBase64Utf8(upload.text),
  });
  const response = await fetchWithTimeout(
    `${config.server}/Videos/${itemId}/Subtitles`,
    { method: "POST", headers: { ...authHeaders(config), "Content-Type": "application/json" }, body },
    API_TIMEOUTS.EXTENDED,
  );
  return response.status;
}

/** External text subtitle streams of an item, the ones a save adds to. */
export function externalTextStreams(streams: JellyfinMediaStream[] | undefined): JellyfinMediaStream[] {
  return (streams ?? []).filter((stream) => stream.Type === "Subtitle" && stream.IsExternal === true && stream.Index !== undefined && !isImageBasedSubtitleCodec(stream.Codec));
}

export interface WaitOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The server queues a refresh after a save rather than attaching the file in the same call, so the
 * item is re-read until an external text stream shows that was not there before, or the wait runs out.
 */
export async function waitForSubtitleStream(itemId: string, knownIndexes: readonly number[], options: WaitOptions = {}): Promise<JellyfinMediaStream | null> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 1500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const config = await getConfig();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);
    invalidateRequest(`details:${config.userId}:${itemId}`);
    const details = await fetchVideoDetails(itemId).catch(() => null);
    const fresh = externalTextStreams(details?.MediaStreams).find((stream) => !knownIndexes.includes(stream.Index as number));
    if (fresh) return fresh;
  }
  return null;
}
