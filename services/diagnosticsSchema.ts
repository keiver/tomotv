/**
 * The diagnostics document: one playback with the build and the machine that recorded it.
 * docs/diagnostics-session.schema.json is its JSON Schema; the two change together.
 * Leaf module: only types, so both readers (the cache file and the server slot) can share it.
 */
import type { DeviceName } from "@/utils/hostEnvironment";

export const SCHEMA_VERSION = 2;

export type SessionEvent = { t: number; event: string; [key: string]: unknown };

export type DeviceDecode = { hevc: boolean; hevcMain10: boolean; av1: boolean; h264MaxHeight?: number | null; hevcMaxHeight?: number | null };

export type SessionDevice = {
  family: DeviceName;
  model: string | null;
  marketingName: string | null;
  cores: number | null;
  memoryBytes: number | null;
  decode: DeviceDecode | null;
};

export type SessionHead = {
  schemaVersion: typeof SCHEMA_VERSION;
  app: { name: string; version: string; build: string };
  os: { name: "iOS" | "tvOS"; version: string };
  device: SessionDevice;
};

export type Playback = {
  itemId: string;
  startedAt: number;
  outcome: "playing" | "ended" | "error";
  events: SessionEvent[];
  progress: { t: number; position: number }[];
};

export type PlaybackSession = SessionHead & { playback: Playback };

const FAMILIES: DeviceName[] = ["iPhone", "iPad", "Mac", "Apple TV"];
const OUTCOMES = ["playing", "ended", "error"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown) => value === null || typeof value === "string";
const isNullableNumber = (value: unknown) => value === null || typeof value === "number";

function isPlayback(value: unknown): value is Playback {
  return isRecord(value) && isString(value.itemId) && typeof value.startedAt === "number" && OUTCOMES.includes(value.outcome as string) && Array.isArray(value.events) && Array.isArray(value.progress);
}

function isDevice(value: unknown): value is SessionDevice {
  if (!isRecord(value) || !FAMILIES.includes(value.family as DeviceName)) return false;
  if (!isNullableString(value.model) || !isNullableString(value.marketingName) || !isNullableNumber(value.cores) || !isNullableNumber(value.memoryBytes)) return false;
  const decode = value.decode;
  if (decode === null) return true;
  if (!isRecord(decode) || typeof decode.hevc !== "boolean" || typeof decode.hevcMain10 !== "boolean" || typeof decode.av1 !== "boolean") return false;
  return [decode.h264MaxHeight, decode.hevcMaxHeight].every((max) => max === undefined || isNullableNumber(max));
}

function isSession(value: unknown): value is PlaybackSession {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) return false;
  const { app, os } = value;
  if (!isRecord(app) || !isString(app.name) || !isString(app.version) || !isString(app.build)) return false;
  if (!isRecord(os) || (os.name !== "iOS" && os.name !== "tvOS") || !isString(os.version)) return false;
  return isDevice(value.device) && isPlayback(value.playback);
}

/** A version 1 document: the head was two strings, "Tomo TV 2.2.4 (25)" and "tvOS 26.0". */
function liftV1(value: Record<string, unknown>, family: DeviceName): PlaybackSession | null {
  const { app: appLabel, os: osLabel } = value;
  if (!isString(appLabel) || !isString(osLabel) || !isPlayback(value)) return null;
  const app = /^(.*?)\s+(\S+?)(?:\s+\((\S+)\))?$/.exec(appLabel);
  const os = /^(iOS|tvOS)\s+(.*)$/.exec(osLabel);
  const { itemId, startedAt, outcome, events, progress } = value;
  return {
    schemaVersion: SCHEMA_VERSION,
    app: { name: app?.[1] ?? appLabel, version: app?.[2] ?? "", build: app?.[3] ?? "" },
    os: { name: os?.[1] === "tvOS" ? "tvOS" : "iOS", version: os?.[2] ?? osLabel },
    device: { family, model: null, marketingName: null, cores: null, memoryBytes: null, decode: null },
    playback: { itemId, startedAt, outcome, events, progress },
  };
}

/**
 * A document this build can show, or null. `family` names the machine for a version 1
 * document, which never recorded one: the reader's own for the cache file, the sender's
 * for a server slot.
 */
export function parseSession(value: unknown, family: DeviceName): PlaybackSession | null {
  if (!isRecord(value)) return null;
  if (isSession(value)) return value;
  return value.schemaVersion === undefined ? liftV1(value, family) : null;
}
