/**
 * Lyrics found for a song, saved to the Jellyfin server as a lyric file so every client reads
 * them. The server allows it per account (Policy.EnableLyricManagement).
 */
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { API_TIMEOUTS } from "@/services/jellyfin/constants";
import type { ItemLyrics } from "@/services/jellyfin/lyrics";
import { getAuthHeader, getConfig } from "@/services/jellyfin/session";
import { logger } from "@/utils/logger";

let permission: { server: string; userId: string; allowed: boolean } | null = null;

/** Whether this account may write lyrics. Asked once per account; a failed read counts as no. */
export async function canManageLyrics(): Promise<boolean> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return false;
  if (permission && permission.server === config.server && permission.userId === config.userId) return permission.allowed;
  try {
    const response = await fetchWithTimeout(
      `${config.server}/Users/Me`,
      { method: "GET", headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.QUICK,
    );
    if (!response.ok) return false;
    const user = (await response.json()) as { Policy?: { EnableLyricManagement?: boolean } };
    permission = { server: config.server, userId: config.userId, allowed: user.Policy?.EnableLyricManagement === true };
    return permission.allowed;
  } catch {
    return false;
  }
}

function stamp(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${(whole - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/**
 * The file the server parses back into the same lines: word tags inside a line make it .elrc,
 * line stamps alone .lrc, and untimed text .txt.
 */
export function lyricsFile(lyrics: ItemLyrics): { fileName: string; body: string } {
  if (!lyrics.synced) return { fileName: "lyrics.txt", body: lyrics.lines.map((line) => line.text).join("\n") };
  const worded = lyrics.lines.some((line) => line.cues.length > 0);
  const body = lyrics.lines
    .map((line) => {
      const start = `[${stamp(line.start ?? 0)}]`;
      if (!worded || line.cues.length === 0) return `${start} ${line.text}`;
      return `${start} ${line.cues.map((cue) => `<${stamp(cue.start)}> ${line.text.slice(cue.position, cue.endPosition)}`).join(" ")}`;
    })
    .join("\n");
  return { fileName: worded ? "lyrics.elrc" : "lyrics.lrc", body };
}

/** True once the server has taken the file. Generated lyrics are never sent: the server cannot mark them as such. */
export async function uploadLyrics(itemId: string, lyrics: ItemLyrics): Promise<boolean> {
  if (lyrics.source !== "lrclib") return false;
  const config = await getConfig();
  if (!config.server || !config.apiKey) return false;
  const { fileName, body } = lyricsFile(lyrics);
  try {
    const response = await fetchWithTimeout(
      `${config.server}/Audio/${itemId}/Lyrics?fileName=${fileName}`,
      { method: "POST", headers: { "Content-Type": "text/plain", Authorization: getAuthHeader(config.deviceId, config.apiKey) }, body },
      API_TIMEOUTS.NORMAL,
    );
    if (!response.ok) logger.warn("Saving lyrics to the server was refused", { service: "Lyrics", itemId, status: response.status });
    return response.ok;
  } catch (error) {
    logger.warn("Saving lyrics to the server failed", error, { service: "Lyrics", itemId });
    return false;
  }
}
