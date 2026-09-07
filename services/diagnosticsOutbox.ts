/**
 * One slot per sending device on the Jellyfin server where an Apple TV leaves its last playback
 * for Tomo TV on a phone to pick up. The slots live in the user's own display preferences, so
 * any device signed in as that user reads them and nothing else can.
 */
import { parseSession, type PlaybackSession } from "@/services/diagnosticsSchema";
import { editDisplayPreferences, getConfig, getDisplayPreferences } from "@/services/jellyfinApi";
import type { DeviceName } from "@/utils/hostEnvironment";
import { logger } from "@/utils/logger";

export const OUTBOX_ID = "tomotv-diagnostics";
export const OUTBOX_CLIENT = "Tomo TV";
/** Followed by the sender's Jellyfin device id, so two Apple TVs keep two slots. */
export const OUTBOX_KEY_PREFIX = "playbackSession:";
/** A slot this old goes with the next send: the device id is re-minted on a reinstall and on an
 *  account switch, so nothing else reclaims the slot it left. */
export const OUTBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SentSession = { v: 2; sender: string; sentAt: number; session: PlaybackSession };

export async function sendSession(session: PlaybackSession, now = Date.now()): Promise<void> {
  const { deviceId } = await getConfig();
  if (!deviceId) throw new Error("Jellyfin server not configured.");
  const payload: SentSession = { v: 2, sender: deviceId, sentAt: now, session };
  await editDisplayPreferences(OUTBOX_ID, OUTBOX_CLIENT, (current) => {
    const kept: Record<string, string | null> = {};
    for (const [key, raw] of Object.entries(current)) {
      // Only our own expired slots go: a payload this build cannot read may belong to a newer one.
      const sent = key.startsWith(OUTBOX_KEY_PREFIX) ? parseSentSession(raw) : null;
      if (!sent || now - sent.sentAt < OUTBOX_TTL_MS) kept[key] = raw;
    }
    kept[OUTBOX_KEY_PREFIX + deviceId] = JSON.stringify(payload);
    return kept;
  });
}

const DEVICES: DeviceName[] = ["iPhone", "iPad", "Mac", "Apple TV"];

/**
 * A slot this build can show, else nothing sent. A version 1 slot named the sender's device on
 * the wrapper and its session carried the two head strings; parseSession lifts it.
 */
export function parseSentSession(raw: string | null | undefined): SentSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SentSession> & { device?: unknown };
    if (typeof value.sender !== "string" || !value.sender || typeof value.sentAt !== "number") return null;
    if (value.v === 2) {
      const session = parseSession(value.session, "Apple TV");
      return session ? { v: 2, sender: value.sender, sentAt: value.sentAt, session } : null;
    }
    if (value.v !== 1 || !DEVICES.includes(value.device as DeviceName)) return null;
    const session = parseSession(value.session, value.device as DeviceName);
    return session ? { v: 2, sender: value.sender, sentAt: value.sentAt, session } : null;
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
