/**
 * Lyrics found for a song, saved to the Jellyfin server as a lyric file so every client reads
 * them. The server allows it per account (EnableLyricManagement) but never reports that
 * permission in the user's policy, so a refused upload is what marks an account as not allowed.
 */
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { API_TIMEOUTS } from "@/services/jellyfin/constants";
import type { ItemLyrics } from "@/services/jellyfin/lyrics";
import { getAuthHeader, getConfig } from "@/services/jellyfin/session";
import { logger } from "@/utils/logger";
import { SOURCE_LINE_SECONDS, sourceLine } from "./sourceLine";

/** Accounts, by server and user, the server refused a lyrics upload while the app runs. */
const refused = new Set<string>();

const accountKey = (config: { server: string; userId: string }): string => `${config.server}|${config.userId}`;

/** Whether this account may write lyrics: yes once signed in, until the server refuses it. */
export async function canManageLyrics(): Promise<boolean> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return false;
  return !refused.has(accountKey(config));
}

function stamp(seconds: number): string {
  // Rounded to hundredths before the split, so 59.999 is 01:00.00 and never 00:60.00.
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  return `${String(minutes).padStart(2, "0")}:${((hundredths - minutes * 6000) / 100).toFixed(2).padStart(5, "0")}`;
}

/**
 * The file the server parses back into the same lines: word tags inside a line make it .elrc,
 * line stamps alone .lrc, and untimed text .txt. The source line comes first, an empty line ending it at 3 s.
 */
export function lyricsFile(lyrics: ItemLyrics): { fileName: string; body: string } {
  const source = sourceLine(lyrics.source);
  if (!lyrics.synced) return { fileName: "lyrics.txt", body: [...(source ? [source] : []), ...lyrics.lines.map((line) => line.text)].join("\n") };
  const worded = lyrics.lines.some((line) => line.cues.length > 0);
  const firstStart = Math.min(...lyrics.lines.map((line) => line.start ?? 0));
  const head = source ? [`[${stamp(0)}] ${source}`, ...(firstStart > SOURCE_LINE_SECONDS ? [`[${stamp(SOURCE_LINE_SECONDS)}]`] : [])] : [];
  const lines = lyrics.lines.map((line) => {
    const start = `[${stamp(line.start ?? 0)}]`;
    if (!worded || line.cues.length === 0) return `${start} ${line.text}`;
    return `${start} ${line.cues.map((cue) => `<${stamp(cue.start)}> ${line.text.slice(cue.position, cue.endPosition)}`).join(" ")}`;
  });
  return { fileName: worded ? "lyrics.elrc" : "lyrics.lrc", body: [...head, ...lines].join("\n") };
}

/** Timed lyrics this app found or wrote. The server's own are never sent back to it, and untimed text waits for a device that can time it. */
export const savable = (lyrics: ItemLyrics | null): boolean => (lyrics?.source === "lrclib" || lyrics?.source === "generated") && lyrics.synced;

/** True once the server has taken the file. The server keeps no source field, so the source line carries it. */
export async function uploadLyrics(itemId: string, lyrics: ItemLyrics): Promise<boolean> {
  if (!savable(lyrics)) return false;
  const config = await getConfig();
  if (!config.server || !config.apiKey) return false;
  const { fileName, body } = lyricsFile(lyrics);
  try {
    const response = await fetchWithTimeout(
      `${config.server}/Audio/${itemId}/Lyrics?fileName=${fileName}`,
      { method: "POST", headers: { "Content-Type": "text/plain", Authorization: getAuthHeader(config.deviceId, config.apiKey) }, body },
      API_TIMEOUTS.NORMAL,
    );
    if (response.status === 403) refused.add(accountKey(config));
    if (!response.ok) logger.warn("Saving lyrics to the server was refused", { service: "Lyrics", itemId, status: response.status });
    return response.ok;
  } catch (error) {
    logger.warn("Saving lyrics to the server failed", error, { service: "Lyrics", itemId });
    return false;
  }
}
