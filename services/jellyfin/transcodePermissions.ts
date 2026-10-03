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
  video: boolean;
  audio: boolean;
}

let snapshot: TranscodePermissions | null = null;
const listeners = new Set<() => void>();

function set(next: TranscodePermissions | null): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** The last read for the connected server; null until read, and again across a server switch. */
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
  const config = await getConfig();
  if (!config.server || !config.apiKey) {
    set(null);
    return;
  }
  if (snapshot && snapshot.server !== config.server) set(null);
  try {
    const response = await fetchWithTimeout(
      `${config.server}/Users/Me`,
      { method: "GET", headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.QUICK,
    );
    if (!response.ok) throw new Error(`Failed to read user policy: ${response.status}`);
    const user = (await response.json()) as { Policy?: { EnableVideoPlaybackTranscoding?: boolean; EnableAudioPlaybackTranscoding?: boolean } };
    set({ server: config.server, video: user.Policy?.EnableVideoPlaybackTranscoding !== false, audio: user.Policy?.EnableAudioPlaybackTranscoding !== false });
  } catch (error) {
    logger.warn("Transcoding permissions read failed", error, { service: "TranscodePermissions" });
  }
}
