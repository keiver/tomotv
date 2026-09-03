/**
 * The phone's side of the diagnostics outbox: the sends it knows about, kept in memory for the
 * About section and the Diagnostics screen, and which of them it has already shown the viewer.
 */
import { OUTBOX_CLIENT, OUTBOX_ID, OUTBOX_KEY_PREFIX, readSentSessions, type SentSession } from "@/services/diagnosticsOutbox";
import { removeDisplayPreference } from "@/services/jellyfinApi";
import { isPlaybackHeld } from "@/services/playbackHold";
import { STORAGE_KEYS } from "@/services/jellyfin/constants";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";

type Seen = Record<string, number>;

export async function readSeen(): Promise<Seen> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.DIAGNOSTICS_SEEN);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Seen) : {};
  } catch (error) {
    logger.warn("Diagnostics seen marker read failed", error, { service: "DiagnosticsInbox" });
    return {};
  }
}

/** Never throws: a marker that fails to persist costs one repeated prompt, not a crash. */
export async function markSeen(sender: string, sentAt: number): Promise<void> {
  try {
    const seen = await readSeen();
    await SecureStore.setItemAsync(STORAGE_KEYS.DIAGNOSTICS_SEEN, JSON.stringify({ ...seen, [sender]: sentAt }));
  } catch (error) {
    logger.warn("Diagnostics seen marker write failed", error, { service: "DiagnosticsInbox" });
  }
}

let sends: SentSession[] = [];
const listeners = new Set<() => void>();

export function getSends(): SentSession[] {
  return sends;
}

export function subscribeSends(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads every slot off the server into memory and tells the screens that show them. */
export async function refreshSends(): Promise<SentSession[]> {
  sends = await readSentSessions();
  for (const listener of [...listeners]) listener();
  return sends;
}

/** Deletes one sender's slot on the server, so no phone on the account sees it again. */
export async function removeSend(sender: string): Promise<void> {
  await removeDisplayPreference(OUTBOX_ID, OUTBOX_CLIENT, OUTBOX_KEY_PREFIX + sender);
  sends = sends.filter((sent) => sent.sender !== sender);
  for (const listener of [...listeners]) listener();
}

/** Forgets the sends on sign-out or a server switch: they belong to the account that was read. */
export function clearSends(): void {
  if (sends.length === 0) return;
  sends = [];
  for (const listener of [...listeners]) listener();
}

/** The newest send the viewer has not been shown, else null. */
export async function checkInbox(): Promise<SentSession | null> {
  const seen = await readSeen();
  return sends.find((sent) => sent.sentAt > (seen[sent.sender] ?? 0)) ?? null;
}

/** Pokes inside this window fold into the one before: a scroll fires many, the server sees one. */
export const POKE_GAP_MS = 3_000;

let offer: ((sent: SentSession) => void) | null = null;
let checking: Promise<void> | null = null;
let lastCheckAt = 0;

/** Arms the inbox with what to do with a new send. Null disarms it: signed out, or tvOS. */
export function setInboxOffer(handler: ((sent: SentSession) => void) | null): void {
  offer = handler;
  if (!handler) lastCheckAt = 0;
}

/**
 * One read of the slots, on a moment that says the viewer is looking: foreground, the Settings
 * tab, a scroll there. Nothing while disarmed or while playback holds the link, and a second
 * poke inside the gap joins the first. `force` skips the gap for sign-in and foreground.
 */
export function pokeInbox(force = false): Promise<void> {
  if (!offer || isPlaybackHeld()) return Promise.resolve();
  if (checking) return checking;
  if (!force && Date.now() - lastCheckAt < POKE_GAP_MS) return Promise.resolve();
  const handler = offer;
  checking = (async () => {
    try {
      await refreshSends();
      const found = await checkInbox();
      if (found && offer === handler) {
        await markSeen(found.sender, found.sentAt);
        handler(found);
      }
    } finally {
      lastCheckAt = Date.now();
      checking = null;
    }
  })();
  return checking;
}
