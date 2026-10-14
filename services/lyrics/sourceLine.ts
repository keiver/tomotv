/**
 * The line this app puts at 0:00 in every lyric file it saves to the server, naming where the
 * lyrics came from. English: every account and client on the server reads the same file.
 */
import type { ItemLyrics, LyricsSource } from "@/services/jellyfin/lyrics";
import { THIS_DEVICE } from "@/utils/hostEnvironment";

const FOUND = "Lyrics: lrclib.net";
const WRITTEN = "Lyrics: written by Tomo TV";

/** The source line shows until 3 s, or until the first lyric when the singing starts sooner. */
export const SOURCE_LINE_SECONDS = 3;

/** "Lyrics: lrclib.net", or "Lyrics: written by Tomo TV on iPhone" for lyrics this device wrote. */
export function sourceLine(source: LyricsSource | undefined): string | undefined {
  if (source === "lrclib") return FOUND;
  if (source === "generated") return `${WRITTEN} on ${THIS_DEVICE}`;
  return undefined;
}

/** The lyrics without a source line this app wrote at their top. */
export function withoutSourceLine(lyrics: ItemLyrics): ItemLyrics {
  const first = lyrics.lines[0]?.text;
  return first !== undefined && (first === FOUND || first.startsWith(WRITTEN)) ? { ...lyrics, lines: lyrics.lines.slice(1) } : lyrics;
}
