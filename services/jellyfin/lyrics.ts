/**
 * Song lyrics (server 10.9+): the lines the server parsed from a sidecar .lrc/.elrc/.txt or an
 * embedded tag. Word cues exist on 10.11+. A song without lyrics answers 404; a request that
 * fails is a different answer, since the song may well have some.
 */
import { logger } from "@/utils/logger";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, JELLYFIN_TIME } from "./constants";
import { getAuthHeader, getConfig } from "./session";

interface LyricCueDto {
  Position?: number;
  EndPosition?: number;
  Start?: number;
  End?: number | null;
}

interface LyricLineDto {
  Text?: string;
  Start?: number | null;
  Cues?: LyricCueDto[] | null;
}

/** One sung word or syllable: a character range of the line and when it sounds, in seconds. */
export interface LyricCue {
  position: number;
  endPosition: number;
  start: number;
  end: number | null;
}

export interface LyricLine {
  text: string;
  /** Seconds, or null on an unsynced line. */
  start: number | null;
  cues: LyricCue[];
}

/** Where a song's lyrics came from: the Jellyfin server, lrclib.net, or the device's own hearing of the song. */
export type LyricsSource = "server" | "lrclib" | "generated";

export interface ItemLyrics {
  /** False for plain text, which has no line to follow. */
  synced: boolean;
  lines: LyricLine[];
  source?: LyricsSource;
  /** One line the player prints above the lyrics. */
  caption?: string;
}

type TimedCue = LyricCueDto & { Position: number; EndPosition: number; Start: number };

const seconds = (ticks: number) => ticks / JELLYFIN_TIME.TICKS_PER_SECOND;
const isNumber = (value: unknown): value is number => typeof value === "number";

/**
 * The server's LyricDto as the player's lines. Synced is read off the lines: the LRC parser
 * leaves Metadata empty. A cue outside its line's text is dropped rather than trusted.
 */
export function parseLyrics(dto: unknown): ItemLyrics | null {
  const raw = (dto as { Lyrics?: LyricLineDto[] | null } | null)?.Lyrics;
  if (!Array.isArray(raw)) return null;

  const lines: LyricLine[] = raw.map((line) => {
    const text = typeof line.Text === "string" ? line.Text : "";
    const cues = (line.Cues ?? [])
      .filter(
        (cue): cue is TimedCue => isNumber(cue.Position) && isNumber(cue.EndPosition) && isNumber(cue.Start) && cue.Position >= 0 && cue.EndPosition > cue.Position && cue.EndPosition <= text.length,
      )
      .map((cue) => ({ position: cue.Position, endPosition: cue.EndPosition, start: seconds(cue.Start), end: typeof cue.End === "number" ? seconds(cue.End) : null }))
      .sort((a, b) => a.start - b.start);
    return { text, start: typeof line.Start === "number" ? seconds(line.Start) : null, cues };
  });

  if (!lines.some((line) => line.text.trim() !== "")) return null;
  const synced = lines.some((line) => line.start !== null);
  // A synced file can carry untimed header lines; they have no place on the timeline.
  const kept = synced ? lines.filter((line) => line.start !== null).sort((a, b) => (a.start as number) - (b.start as number)) : lines;
  return { synced, lines: kept };
}

/** `answered` is false when the server could not be asked, which says nothing about the song. */
export interface LyricsAnswer {
  lyrics: ItemLyrics | null;
  answered: boolean;
}

export async function askLyrics(itemId: string): Promise<LyricsAnswer> {
  const config = await getConfig();

  if (!config.server || !config.apiKey) {
    return { lyrics: null, answered: true };
  }

  try {
    const response = await fetchWithTimeout(
      `${config.server}/Audio/${itemId}/Lyrics`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
      },
      API_TIMEOUTS.QUICK,
    );

    // Only a 404 says the song has none; any other status is the server failing to say.
    if (!response.ok) {
      return { lyrics: null, answered: response.status === 404 };
    }

    const lyrics = parseLyrics(await response.json());
    return { lyrics: lyrics ? { ...lyrics, source: "server" } : null, answered: true };
  } catch (error) {
    logger.debug("Lyrics fetch failed", { service: "JellyfinAPI", itemId, error: String(error) });
    return { lyrics: null, answered: false };
  }
}

export async function fetchLyrics(itemId: string): Promise<ItemLyrics | null> {
  return (await askLyrics(itemId)).lyrics;
}
