/**
 * The phone's side of the diagnostics outbox: the sends it knows about, kept in memory for the
 * About section and the Diagnostics screen, and which of them it has already shown the viewer.
 */
import { readSentSessions, type SentSession } from "@/services/diagnosticsOutbox";
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
