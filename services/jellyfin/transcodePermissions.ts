/**
 * The account's transcoding permissions as the server states them (/Users/Me Policy), for the
 * settings copy. Playback reads the per-item SupportsTranscoding field, which carries the same answer.
 */
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig } from "./session";

export interface TranscodePermissions {
  server: string;
  userId?: string;
  video: boolean;
  audio: boolean;
}

let snapshot: TranscodePermissions | null = null;
let reads = 0;
const listeners = new Set<() => void>();

function set(next: TranscodePermissions | null): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** The last read for the signed-in account; null until read, and again across a server or account switch. */
export function getTranscodePermissions(): TranscodePermissions | null {
  return snapshot;
}

export function subscribeTranscodePermissions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshTranscodePermissions(): Promise<void> {
  const mine = ++reads;
  const config = await getConfig();
  if (mine !== reads) return;
  if (!config.server || !config.apiKey) {
    set(null);
    return;
  }
  if (snapshot && (snapshot.server !== config.server || snapshot.userId !== config.userId)) set(null);
  try {
    const response = await fetchWithTimeout(
      `${config.server}/Users/Me`,
      { method: "GET", headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.QUICK,
    );
    if (!response.ok) throw new Error(`Failed to read user policy: ${response.status}`);
    const user = (await response.json()) as { Policy?: { EnableVideoPlaybackTranscoding?: boolean; EnableAudioPlaybackTranscoding?: boolean } };
    // A read overtaken by a newer one, possibly for another account, is dropped.
    if (mine !== reads) return;
    set({ server: config.server, userId: config.userId, video: user.Policy?.EnableVideoPlaybackTranscoding !== false, audio: user.Policy?.EnableAudioPlaybackTranscoding !== false });
  } catch (error) {
    logger.warn("Transcoding permissions read failed", error, { service: "TranscodePermissions" });
  }
}
