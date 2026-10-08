/**
 * Error IDs the error screen shows and Diagnostics records: one stable ID per failure cause, read off
 * a photo of the screen and grepped straight to its site. A family prefix per surface (PB: playback).
 */

/** Playback causes. An ID never changes meaning; a new cause gets a new ID. */
export const PLAYBACK_ERROR_IDS = {
  /** Fetching the item from the server failed. */
  META: "PB-META",
  /** The item needs server transcoding and the server is off for it. */
  NOLANE: "PB-NOLANE",
  /** A channel the engine cannot take, and the server offers no transcode. */
  LIVE_NOLANE: "PB-LIVE-NOLANE",
  /** The engine session did not start. */
  ENGINE_START: "PB-ENGINE-START",
  /** The engine reported a failure before its first segment. */
  ENGINE_FAILED: "PB-ENGINE-FAILED",
  /** The engine's first segment came in below realtime. */
  ENGINE_SLOW: "PB-ENGINE-SLOW",
  /** The engine read the input but cut no segment in time. */
  ENGINE_NOSEG: "PB-ENGINE-NOSEG",
  /** The input delivered no bytes in time. */
  ENGINE_NODATA: "PB-ENGINE-NODATA",
  /** The server answered the engine's read with a 404. */
  INPUT_404: "PB-INPUT-404",
  /** AVPlayer reported an error. */
  AVPLAYER: "PB-AVPLAYER",
  /** AVPlayer did not start within the open deadline. */
  OPEN_TIMEOUT: "PB-OPEN-TIMEOUT",
  /** A live channel froze past the stall deadline. */
  LIVE_STALL: "PB-LIVE-STALL",
  /** Starting playback on a ready player threw. */
  AUTOPLAY: "PB-AUTOPLAY",
  /** The server refused the session and a credential refresh did not recover it. */
  AUTH: "PB-AUTH",
  /** Building the stream failed for any other reason. */
  STREAM: "PB-STREAM",
} as const;

export type PlaybackErrorId = (typeof PLAYBACK_ERROR_IDS)[keyof typeof PLAYBACK_ERROR_IDS];

/** What carried the playback: the engine, a server transcode, AVPlayer on the original, or a download on disk. */
export type LaneTag = "ENG" | "SRV" | "DIR" | "DSK";

export interface NativeError {
  domain: string;
  code: number;
}

export interface ErrorRef {
  id: string;
  lane?: LaneTag;
  native?: NativeError;
}

/** A failure that knows its ID; its message stays what the error classification reads. */
export class IdentifiedError extends Error {
  constructor(
    readonly id: string,
    message: string,
  ) {
    super(message);
  }
}

const DOMAIN_TAGS: Record<string, string> = {
  AVFoundationErrorDomain: "AVF",
  CoreMediaErrorDomain: "CM",
  NSURLErrorDomain: "URL",
  NSOSStatusErrorDomain: "OS",
};

/** The domain and code an Apple error carries, as the player hands it over; undefined when it has none. */
export function nativeErrorOf(error: unknown): NativeError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { domain, code } = error as { domain?: unknown; code?: unknown };
  const numeric = typeof code === "string" && /^-?\d+$/.test(code) ? Number(code) : code;
  return typeof domain === "string" && domain.length > 0 && typeof numeric === "number" && Number.isFinite(numeric) ? { domain, code: numeric } : undefined;
}

/** The ID a failure carries, else the fallback. */
export function errorIdOf(error: unknown, fallback: string): string {
  if (error instanceof IdentifiedError) return error.id;
  const carried = typeof error === "object" && error !== null ? (error as { errorId?: unknown }).errorId : undefined;
  return typeof carried === "string" ? carried : fallback;
}

/** "PB-AVPLAYER · ENG (AVF -11800) · 2.2.10 (19)": the ID first, so it reads alone from a photo. */
export function formatErrorRef(ref: ErrorRef, build: string): string {
  const native = ref.native ? ` (${DOMAIN_TAGS[ref.native.domain] ?? ref.native.domain} ${ref.native.code})` : "";
  const lane = ref.lane ? ` · ${ref.lane}${native}` : native;
  return `${ref.id}${lane}${build ? ` · ${build}` : ""}`;
}
