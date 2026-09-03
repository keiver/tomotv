/**
 * One slot per sending device on the Jellyfin server where an Apple TV leaves its last playback
 * for Tomo TV on a phone to pick up. The slots live in the user's own display preferences, so
 * any device signed in as that user reads them and nothing else can.
 */
import { getConfig, getDisplayPreferences, updateDisplayPreferences } from "@/services/jellyfinApi";
import type { PlaybackSession } from "@/services/playbackProbe";
import type { DeviceName } from "@/services/playbackStory";
import { logger } from "@/utils/logger";

export const OUTBOX_ID = "tomotv-diagnostics";
export const OUTBOX_CLIENT = "Tomo TV";
/** Followed by the sender's Jellyfin device id, so two Apple TVs keep two slots. */
export const OUTBOX_KEY_PREFIX = "playbackSession:";

export type SentSession = { v: 1; sender: string; device: DeviceName; sentAt: number; session: PlaybackSession };

export async function sendSession(session: PlaybackSession, device: DeviceName, now = Date.now()): Promise<void> {
  const { deviceId } = await getConfig();
  if (!deviceId) throw new Error("Jellyfin server not configured.");
  const payload: SentSession = { v: 1, sender: deviceId, device, sentAt: now, session };
  await updateDisplayPreferences(OUTBOX_ID, OUTBOX_CLIENT, { [OUTBOX_KEY_PREFIX + deviceId]: JSON.stringify(payload) });
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
      typeof value.sender === "string" &&
      value.sender.length > 0 &&
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

/** Every slot on the server, newest first. Empty when nothing was sent or it cannot be reached. */
export async function readSentSessions(): Promise<SentSession[]> {
  try {
    const prefs = await getDisplayPreferences(OUTBOX_ID, OUTBOX_CLIENT);
    const entries = Object.entries(prefs.CustomPrefs ?? {}).filter(([key]) => key.startsWith(OUTBOX_KEY_PREFIX));
    return entries
      .map(([, raw]) => parseSentSession(raw))
      .filter((sent): sent is SentSession => sent !== null)
      .sort((a, b) => b.sentAt - a.sentAt);
  } catch (error) {
    logger.warn("Diagnostics outbox read failed", error, { service: "DiagnosticsOutbox" });
    return [];
  }
}
