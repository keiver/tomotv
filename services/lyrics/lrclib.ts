/**
 * lrclib.net, the free crowd-sourced lyrics database, asked when the Jellyfin server has none.
 * It has no keys and asks two things of a client: name yourself, and wait when told to.
 */
import { APP_VERSION } from "@/constants/app";
import type { ItemLyrics, LyricLine } from "@/services/jellyfin/lyrics";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

const BASE = "https://lrclib.net/api";
const CLIENT = `TomoTV/${APP_VERSION} (https://github.com/keiver/tomotv)`;
const TIMEOUT_MS = 10000;
const RETRIES = 2;
const MAX_WAIT_SECONDS = 5;
/** A search result this close in length is the same cut of the song, so its timing holds. */
const SAME_CUT_SECONDS = 3;
const MAX_CANDIDATES = 3;

type LookupItem = Pick<JellyfinVideoItem, "Name" | "Artists" | "AlbumArtist" | "RunTimeTicks">;

interface LrclibRecord {
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LrclibMatch {
  lyrics: ItemLyrics;
  /** False when the words come from another cut of the song: usable only once the device has heard them fit. */
  sameCut: boolean;
}

/** "found" carries a match, "none" is a definite miss worth remembering, "unreachable" is not. */
export type LrclibAnswer = { status: "found"; match: LrclibMatch } | { status: "none" } | { status: "unreachable" };

const NOISE = /\s*[([][^)\]]*(feat|ft\.|remaster|extended|version|edit|live|mix|explicit|official|audio|video|lyrics?|letra|hd|hq)[^)\]]*[)\]]/gi;

/** "Artist - Title", split on a hyphen, an en dash (0x2013), an em dash (0x2014) or an underscore. */
const ARTIST_TITLE = new RegExp(String.raw`^(.+?)\s+[-${String.fromCharCode(0x2013, 0x2014)}_]\s+(.+)$`);

/**
 * Who and what to ask for, most trusted first: the tags as they are, then the artist and title
 * read out of an "Artist - Title" name, which is how an untagged rip is usually named.
 */
export function lookupCandidates(item: LookupItem): { artist: string; title: string }[] {
  const tagArtist = item.Artists?.[0] || item.AlbumArtist || "";
  const title = item.Name.replace(NOISE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const candidates: { artist: string; title: string }[] = [];
  if (tagArtist) candidates.push({ artist: tagArtist, title });
  const split = title.match(ARTIST_TITLE);
  if (split) {
    const artist = split[1].trim();
    const song = split[2].trim();
    candidates.push({ artist, title: song });
    candidates.push({ artist: artist.split(/\s*(?:,|&| x | feat\.? | ft\.? )\s*/i)[0].trim(), title: song });
  }
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.artist}|${candidate.title}`.toLowerCase();
      if (!candidate.artist || !candidate.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES);
}

const STAMP = /^\[(\d+):(\d+(?:\.\d+)?)\]/;

/** LRCLIB's synced text, "[mm:ss.xx] words" a line, as the player's lines in time order. A line with several stamps is sung at each. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split("\n")) {
    let rest = raw.trim();
    const starts: number[] = [];
    for (let match = rest.match(STAMP); match; match = rest.match(STAMP)) {
      starts.push(Number(match[1]) * 60 + Number(match[2]));
      rest = rest.slice(match[0].length);
    }
    for (const start of starts) lines.push({ text: rest.trim(), start, cues: [] });
  }
  return lines.sort((a, b) => (a.start as number) - (b.start as number));
}

function plainLines(text: string): LyricLine[] {
  return text.split("\n").map((line) => ({ text: line.trim(), start: null, cues: [] }));
}

/** Anyone can publish to LRCLIB and it checks no length; lyrics longer than this are not used. */
const MAX_LYRICS_CHARS = 50_000;

const lyricsText = (value: unknown): string | undefined => (typeof value === "string" && value.length <= MAX_LYRICS_CHARS ? value : undefined);

/** An answer's record with only the fields of the expected type, or null when it is not a record. */
function readRecord(raw: unknown): LrclibRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    duration: typeof value.duration === "number" ? value.duration : undefined,
    instrumental: value.instrumental === true,
    plainLyrics: lyricsText(value.plainLyrics),
    syncedLyrics: lyricsText(value.syncedLyrics),
  };
}

/** The answer's JSON, or null when it is not JSON, such as a Wi-Fi sign-in page. */
async function readJson(response: Response): Promise<{ value: unknown } | null> {
  try {
    return { value: await response.json() };
  } catch {
    return null;
  }
}

function toMatch(record: LrclibRecord, sameCut: boolean): LrclibMatch | null {
  if (record.instrumental) return null;
  const synced = sameCut && record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  if (synced.some((line) => line.text)) return { sameCut, lyrics: { synced: true, source: "lrclib", lines: synced } };
  const unstamped = (text: string) => parseLrc(text).map((line) => line.text);
  const plain = record.plainLyrics ?? (record.syncedLyrics ? unstamped(record.syncedLyrics).join("\n") : "");
  if (!plain.trim()) return null;
  return { sameCut, lyrics: { synced: false, source: "lrclib", lines: plainLines(plain) } };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request, waited out and retried when the service says it is busy. Null when it never answers. */
async function ask(path: string): Promise<Response | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE}${path}`, { headers: { "User-Agent": CLIENT, "Lrclib-Client": CLIENT, Accept: "application/json" }, signal: controller.signal });
      if (response.status !== 429 && response.status !== 503) return response;
      if (attempt === RETRIES) return null;
      await wait(Math.min(MAX_WAIT_SECONDS, Number(response.headers.get("retry-after")) || 1) * 1000);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * The ladder: an exact lookup for each candidate, then one search for the last of them.
 * A search result is the same cut only when its length matches the file's.
 */
export async function findOnLrclib(item: LookupItem): Promise<LrclibAnswer> {
  const candidates = lookupCandidates(item);
  const duration = Math.round((item.RunTimeTicks ?? 0) / 10_000_000);
  if (candidates.length === 0 || duration <= 0) return { status: "none" };

  for (const candidate of candidates) {
    const response = await ask(`/get?${new URLSearchParams({ artist_name: candidate.artist, track_name: candidate.title, duration: String(duration) })}`);
    if (!response) return { status: "unreachable" };
    if (response.status !== 200) continue;
    const body = await readJson(response);
    if (!body) return { status: "unreachable" };
    const record = readRecord(body.value);
    const match = record ? toMatch(record, true) : null;
    if (match) return { status: "found", match };
  }

  const last = candidates[candidates.length - 1];
  const response = await ask(`/search?${new URLSearchParams({ track_name: last.title, artist_name: last.artist })}`);
  if (!response) return { status: "unreachable" };
  if (response.status !== 200) return { status: "none" };
  const body = await readJson(response);
  if (!body) return { status: "unreachable" };
  const records = (Array.isArray(body.value) ? body.value : [])
    .map(readRecord)
    .filter((record): record is LrclibRecord => record !== null && !record.instrumental && !!(record.plainLyrics || record.syncedLyrics));
  const byDistance = [...records].sort((a, b) => Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration));
  const sameCut = byDistance.filter((record) => Math.abs((record.duration ?? 0) - duration) <= SAME_CUT_SECONDS);
  const best = sameCut.find((record) => record.syncedLyrics) ?? sameCut[0];
  const match = best ? toMatch(best, true) : byDistance[0] ? toMatch(byDistance[0], false) : null;
  if (!match) return { status: "none" };
  logger.info("Lyrics found on LRCLIB", { service: "Lyrics", sameCut: match.sameCut, synced: match.lyrics.synced });
  return { status: "found", match };
}
