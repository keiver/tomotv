/**
 * One slot per account on the Jellyfin server where an Apple TV leaves its last playback for
 * Tomo TV on a phone to pick up. It lives in the user's own display preferences, so any device
 * signed in as that user reads it and nothing else can.
 */
import { getDisplayPreferences, updateDisplayPreferences } from "@/services/jellyfinApi";
import type { PlaybackSession } from "@/services/playbackProbe";
import type { DeviceName } from "@/services/playbackStory";
import { logger } from "@/utils/logger";

export const OUTBOX_ID = "tomotv-diagnostics";
export const OUTBOX_CLIENT = "Tomo TV";
export const OUTBOX_KEY = "playbackSession";

export type SentSession = { v: 1; device: DeviceName; sentAt: number; session: PlaybackSession };

export async function sendSession(session: PlaybackSession, device: DeviceName, now = Date.now()): Promise<void> {
  const payload: SentSession = { v: 1, device, sentAt: now, session };
  await updateDisplayPreferences(OUTBOX_ID, OUTBOX_CLIENT, { [OUTBOX_KEY]: JSON.stringify(payload) });
}

const DEVICES: DeviceName[] = ["iPhone", "iPad", "Mac", "Apple TV"];

/** Only a payload this build wrote the shape of is shown; anything else reads as nothing sent. */
export function parseSentSession(raw: string | null | undefined): SentSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SentSession>;
    const session = value.session as Partial<PlaybackSession> | undefined;
    const sound =
      value.v === 1 &&
      DEVICES.includes(value.device as DeviceName) &&
      typeof value.sentAt === "number" &&
      !!session &&
      typeof session.itemId === "string" &&
      typeof session.app === "string" &&
      typeof session.os === "string" &&
      typeof session.startedAt === "number" &&
      Array.isArray(session.events) &&
      Array.isArray(session.progress);
    return sound ? (value as SentSession) : null;
  } catch {
    return null;
  }
}

/** Null when nothing was sent, the slot is unreadable, or the server cannot be reached. */
export async function readSentSession(): Promise<SentSession | null> {
  try {
    const prefs = await getDisplayPreferences(OUTBOX_ID, OUTBOX_CLIENT);
    return parseSentSession(prefs.CustomPrefs?.[OUTBOX_KEY]);
  } catch (error) {
    logger.warn("Diagnostics outbox read failed", error, { service: "DiagnosticsOutbox" });
    return null;
  }
}
