/**
 * One song's lyrics from wherever they can be had: the download, the Jellyfin server, lrclib.net,
 * and last the device's own hearing of the song. The first usable answer is reported at once and
 * a better one when listening finishes; the result is remembered so each step runs once a song.
 */
import { localLyrics } from "@/services/downloads/localSource";
import { t } from "@/services/i18n";
import { askLyrics, fetchLyrics, type ItemLyrics, type LyricsAnswer } from "@/services/jellyfin/lyrics";
import { getConfig } from "@/services/jellyfin/session";
import { getUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { generatedLyrics, withLineTiming, withWordTiming } from "./align";
import { listen, listenable, listenerAvailable } from "./listener";
import { findOnLrclib } from "./lrclib";
import { sourceNamed, withoutSourceLine } from "./sourceLine";
import { lyricsKey, readLyricsEntry, writeLyricsEntry } from "./store";
import { canManageLyrics, savable, uploadLyrics } from "./upload";

type Update = (lyrics: ItemLyrics | null) => void;

interface Flight {
  listeners: Set<Update>;
  /** The last answer reported, replayed to a caller that joins late. */
  last: ItemLyrics | null | undefined;
  done: Promise<void>;
}

const flights = new Map<string, Flight>();

const textOf = (lyrics: ItemLyrics | null): string =>
  lyrics
    ? lyrics.lines
        .map((line) => line.text)
        .filter(Boolean)
        .join("\n")
    : "";

/** What the server and LRCLIB have, without listening: the part a download can keep for offline. */
export async function networkLyrics(item: JellyfinVideoItem): Promise<ItemLyrics | null> {
  const server = await fetchLyrics(item.Id);
  if (server) return server;
  if (!getUiPreferences().findLyrics) return null;
  const answer = await findOnLrclib(item);
  return answer.status === "found" && answer.match.sameCut ? answer.match.lyrics : null;
}

/** A server that could not be asked is asked again after each of these waits. */
const SERVER_RETRY_MS = [1000, 3000];

async function serverLyrics(itemId: string): Promise<LyricsAnswer> {
  let answer = await askLyrics(itemId);
  for (const delay of SERVER_RETRY_MS) {
    if (answer.answered) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    answer = await askLyrics(itemId);
  }
  return answer;
}

async function run(key: string, item: JellyfinVideoItem, emit: Update): Promise<void> {
  const preferences = getUiPreferences();
  const cached = await readLyricsEntry(key);
  let current: ItemLyrics | null = null;
  /** Words from another cut of the song: shown only if the device hears them fit. */
  let unconfirmed: ItemLyrics | null = null;
  let listened = false;
  let tried = false;
  let uploaded = cached?.uploaded ?? false;

  // The download's and the server's own lyrics always win; a remembered word fill of the same text is reused.
  const local = await localLyrics(item.Id);
  const server = local ? null : await serverLyrics(item.Id);
  const owned = local ?? server?.lyrics ?? null;
  // A server that never answered may hold lyrics of its own: nothing is remembered or saved over it.
  const serverAnswered = server?.answered ?? true;
  let definite = serverAnswered;
  if (owned) {
    const remembered = cached?.lyrics && textOf(withoutSourceLine(cached.lyrics)) === textOf(withoutSourceLine(owned)) ? cached : null;
    current = remembered?.lyrics ?? owned;
    listened = remembered?.listened ?? false;
  } else if (cached) {
    current = cached.lyrics;
    listened = cached.listened;
  } else if (preferences.findLyrics) {
    const answer = await findOnLrclib(item);
    if (answer.status === "unreachable") definite = false;
    if (answer.status === "found") {
      if (answer.match.sameCut) current = answer.match.lyrics;
      else unconfirmed = answer.match.lyrics;
    }
  }
  if (current) emit(current);

  if (!listened && preferences.listenForLyrics && listenable(item) && (await listenerAvailable())) {
    tried = true;
    const heard = await listen(item, textOf(current ?? unconfirmed) || null);
    if (heard) {
      listened = true;
      let next: ItemLyrics | null = current;
      if (current?.synced) next = withWordTiming(current, heard);
      else if (current) next = withLineTiming(current, heard) ?? current;
      else if (unconfirmed) next = withLineTiming(unconfirmed, heard);
      else {
        const generated = generatedLyrics(heard, (item.RunTimeTicks ?? 0) / 10_000_000);
        next = generated ? { ...generated, caption: t("lyrics.generated") } : null;
      }
      if (next !== current) {
        current = next;
        if (current) emit(current);
      }
    }
  }
  if (!current) emit(null);

  // An untimed copy this app saved is replaced once this device has timed it.
  const savedUntimed = server?.lyrics && !server.lyrics.synced ? sourceNamed(server.lyrics) : undefined;
  const toSave = savedUntimed && current?.synced ? { ...withoutSourceLine(current), source: savedUntimed } : current;
  if (toSave && savable(toSave) && (!uploaded || savedUntimed) && serverAnswered && preferences.saveLyrics && (await canManageLyrics())) {
    uploaded = await uploadLyrics(item.Id, toSave);
  }
  // A miss is only remembered when every source actually answered; one the device tried to hear is not listened to again.
  if (current || definite) writeLyricsEntry(key, { lyrics: current, listened: listened || (current === null && tried), uploaded });
}

/**
 * Resolves the song's lyrics, calling `onUpdate` with each answer as it improves and with null
 * when there are none. Callers asking for the same song share one run.
 */
export async function resolveLyrics(item: JellyfinVideoItem, onUpdate: Update): Promise<void> {
  const { server } = await getConfig();
  const key = lyricsKey(server ?? "", item);
  let flight = flights.get(key);
  if (flight) {
    flight.listeners.add(onUpdate);
    if (flight.last !== undefined) onUpdate(flight.last);
    return flight.done;
  }
  const created: Flight = { listeners: new Set([onUpdate]), last: undefined, done: Promise.resolve() };
  flight = created;
  flights.set(key, created);
  created.done = run(key, item, (lyrics) => {
    created.last = lyrics;
    created.listeners.forEach((listener) => listener(lyrics));
  })
    .catch((error) => {
      logger.warn("Lyrics could not be resolved", error, { service: "Lyrics", itemId: item.Id });
      created.listeners.forEach((listener) => listener(null));
    })
    .finally(() => {
      flights.delete(key);
    });
  return created.done;
}
