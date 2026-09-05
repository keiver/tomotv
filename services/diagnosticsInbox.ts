/**
 * The phone's side of the diagnostics outbox: the sends it knows about, kept in memory for the
 * About section and the Diagnostics screen.
 */
import { OUTBOX_CLIENT, OUTBOX_ID, OUTBOX_KEY_PREFIX, readSentSessions, type SentSession } from "@/services/diagnosticsOutbox";
import { removeDisplayPreference } from "@/services/jellyfinApi";
import { isPlaybackHeld } from "@/services/playbackHold";

let sends: SentSession[] = [];
const listeners = new Set<() => void>();

export function getSends(): SentSession[] {
  return sends;
}

export function subscribeSends(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which account's slots these are. Bumped by every clear, so a read still in flight when the
 *  viewer signs out cannot write the account they left back into the list. */
let sendsGeneration = 0;

/** Reads every slot off the server into memory and tells the screens that show them. */
export async function refreshSends(): Promise<SentSession[]> {
  const generation = sendsGeneration;
  const read = await readSentSessions();
  if (generation !== sendsGeneration) return sends;
  sends = read;
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
  sendsGeneration += 1;
  if (sends.length === 0) return;
  sends = [];
  for (const listener of [...listeners]) listener();
}

/** Pokes inside this window fold into the one before: a scroll fires many, the server sees one. */
export const POKE_GAP_MS = 3_000;

let armed = false;
let checking: Promise<void> | null = null;
let lastCheckAt = 0;

/** Off while signed out, and on tvOS, which never reads the slots. */
export function armInbox(on: boolean): void {
  armed = on;
  if (!on) lastCheckAt = 0;
}

/**
 * One read of the slots, on a moment that says the viewer is looking: foreground, the Settings
 * tab, a scroll there. Nothing while disarmed or while playback holds the link, and a second
 * poke inside the gap joins the first. `force` skips the gap for sign-in and foreground.
 */
export function pokeInbox(force = false): Promise<void> {
  if (!armed || isPlaybackHeld()) return Promise.resolve();
  if (checking) return checking;
  if (!force && Date.now() - lastCheckAt < POKE_GAP_MS) return Promise.resolve();
  checking = (async () => {
    try {
      await refreshSends();
    } finally {
      lastCheckAt = Date.now();
      checking = null;
    }
  })();
  return checking;
}
