/**
 * What the device has already worked out about a song's lyrics, so the lookup and the listening
 * run once. One small JSON file a song in Caches: everything here can be found again.
 */
import { Directory, File, Paths } from "expo-file-system";
import type { ItemLyrics } from "@/services/jellyfin/lyrics";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

const DIRECTORY = "lyrics";
const VERSION = 4;
/** A song found to have no lyrics is asked about again after this long. */
export const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface LyricsEntry {
  version: number;
  savedAt: number;
  /** Null records a miss: nothing on the server, nothing on LRCLIB, nothing heard. */
  lyrics: ItemLyrics | null;
  /** The device has listened, so there is nothing left to improve. */
  listened: boolean;
  /** Already saved to the Jellyfin server. */
  uploaded: boolean;
}

type KeyItem = Pick<JellyfinVideoItem, "Id" | "MediaSources">;

/** Item ids repeat across servers, so the server is part of the key. */
export function lyricsKey(server: string, item: KeyItem): string {
  return `${server}:${item.Id}:${item.MediaSources?.[0]?.Id ?? ""}`;
}

function entryFile(key: string): File {
  return new File(new Directory(Paths.cache, DIRECTORY), `${key.replace(/[^A-Za-z0-9]/g, "_")}.json`);
}

/** The remembered answer, or null when there is none or a miss has gone stale. */
export async function readLyricsEntry(key: string, now: number = Date.now()): Promise<LyricsEntry | null> {
  try {
    const file = entryFile(key);
    if (!file.exists) return null;
    const entry = JSON.parse(await file.text()) as LyricsEntry;
    if (entry?.version !== VERSION) return null;
    if (entry.lyrics === null && now - entry.savedAt > MISS_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

export function writeLyricsEntry(key: string, entry: Omit<LyricsEntry, "version" | "savedAt">, now: number = Date.now()): void {
  try {
    const directory = new Directory(Paths.cache, DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    entryFile(key).write(JSON.stringify({ ...entry, version: VERSION, savedAt: now }));
  } catch (error) {
    logger.warn("Lyrics cache write failed", error, { service: "Lyrics" });
  }
}
