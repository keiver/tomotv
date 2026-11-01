/**
 * The viewer's time correction for a subtitle track, kept on the device per server, item and
 * stream index. Positive delays the cues. The engine adds it to every cue time when it serves
 * the track.
 */
import { Settings } from "react-native";
import { logger } from "@/utils/logger";

export const SUBTITLE_TIMING_KEY = "app_subtitle_timing";
export const SUBTITLE_OFFSET_STEP_MS = 500;
/** Past this a cue is not a correction but another track. */
export const SUBTITLE_OFFSET_LIMIT_MS = 60_000;

function key(server: string, itemId: string, streamIndex: number): string {
  return `${server}|${itemId}|${streamIndex}`;
}

function readAll(): Record<string, number> {
  try {
    const raw = Settings.get(SUBTITLE_TIMING_KEY);
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "number" && Number.isFinite(value))) as Record<string, number>;
  } catch {
    return {};
  }
}

/** The stored correction in milliseconds, 0 when none. */
export function subtitleOffsetMs(server: string, itemId: string, streamIndex: number): number {
  return readAll()[key(server, itemId, streamIndex)] ?? 0;
}

/** Stores a correction; 0 removes the entry. Returns the value kept, clamped to the limit. */
export function setSubtitleOffsetMs(server: string, itemId: string, streamIndex: number, offsetMs: number): number {
  const kept = Math.max(-SUBTITLE_OFFSET_LIMIT_MS, Math.min(SUBTITLE_OFFSET_LIMIT_MS, Math.round(offsetMs)));
  try {
    const all = readAll();
    if (kept === 0) delete all[key(server, itemId, streamIndex)];
    else all[key(server, itemId, streamIndex)] = kept;
    Settings.set({ [SUBTITLE_TIMING_KEY]: JSON.stringify(all) });
  } catch (error) {
    logger.warn("Subtitle timing write failed", error, { service: "Subtitles", itemId, streamIndex });
  }
  return kept;
}
