/**
 * The per-user, per-client key/value store the server keeps for every client. A GET creates
 * the entry when none exists, so a write always merges into what the server already holds.
 */
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";

export type DisplayPreferences = { CustomPrefs?: Record<string, string | null> | null } & Record<string, unknown>;

async function endpoint(id: string, client: string) {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  return {
    url: `${config.server}/DisplayPreferences/${encodeURIComponent(id)}?userId=${config.userId}&client=${encodeURIComponent(client)}`,
    headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) },
  };
}

export async function getDisplayPreferences(id: string, client: string): Promise<DisplayPreferences> {
  const { url, headers } = await endpoint(id, client);
  const response = await fetchWithTimeout(url, { headers }, API_TIMEOUTS.QUICK);
  if (!response.ok) throwRequestError(response, `Failed to read display preferences: ${response.status}`);
  return (await response.json()) as DisplayPreferences;
}

/** Replaces the custom keys the server holds for this id and client with `customPrefs`. */
export async function updateDisplayPreferences(id: string, client: string, customPrefs: Record<string, string>): Promise<void> {
  const current = await getDisplayPreferences(id, client);
  const { url, headers } = await endpoint(id, client);
  const body: DisplayPreferences = { ...current, Id: id, Client: client, CustomPrefs: { ...(current.CustomPrefs ?? {}), ...customPrefs } };
  const response = await fetchWithTimeout(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }, API_TIMEOUTS.NORMAL);
  if (!response.ok) throwRequestError(response, `Failed to write display preferences: ${response.status}`);
}
