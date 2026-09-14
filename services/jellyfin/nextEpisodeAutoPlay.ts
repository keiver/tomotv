/**
 * The account's EnableNextEpisodeAutoPlay, Jellyfin's "Play next episode automatically", read only.
 * The last read answers while the server is unreachable.
 */
import * as SecureStore from "expo-secure-store";
import { logger } from "@/utils/logger";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, STORAGE_KEYS } from "./constants";
import { getAuthHeader, getConfig } from "./session";

interface StoredAutoPlay {
  account: string;
  enabled: boolean;
}

async function readStored(account: string): Promise<boolean | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.NEXT_EPISODE_AUTOPLAY);
    const stored = raw ? (JSON.parse(raw) as StoredAutoPlay) : null;
    return stored?.account === account && typeof stored.enabled === "boolean" ? stored.enabled : null;
  } catch {
    return null;
  }
}

/** True unless the server says otherwise, which is also the server's own default. */
export async function fetchNextEpisodeAutoPlay(): Promise<boolean> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return true;
  const account = `${config.server}|${config.userId}`;
  try {
    const response = await fetchWithTimeout(`${config.server}/Users/Me`, { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } }, API_TIMEOUTS.QUICK);
    if (response.ok) {
      const user = (await response.json()) as { Configuration?: { EnableNextEpisodeAutoPlay?: boolean } };
      const enabled = user.Configuration?.EnableNextEpisodeAutoPlay !== false;
      await SecureStore.setItemAsync(STORAGE_KEYS.NEXT_EPISODE_AUTOPLAY, JSON.stringify({ account, enabled } satisfies StoredAutoPlay)).catch(() => {});
      return enabled;
    }
  } catch (error) {
    logger.warn("Could not read the autoplay setting, using the last known value", error, { service: "JellyfinAPI" });
  }
  return (await readStored(account)) ?? true;
}
