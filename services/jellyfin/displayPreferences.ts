/**
 * The per-user, per-client key/value store the server keeps for every client. A GET creates
 * the entry when none exists, so a write always merges into what the server already holds.
 */
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";

export type DisplayPreferences = { CustomPrefs?: Record<string, string | null> | null } & Record<string, unknown>;

/** One account's address for one record: the read and the write both go through the same one. */
type PreferencesTarget = { url: string; headers: Record<string, string>; server: string; userId: string };

async function endpoint(id: string, client: string): Promise<PreferencesTarget> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  return {
    url: `${config.server}/DisplayPreferences/${encodeURIComponent(id)}?userId=${config.userId}&client=${encodeURIComponent(client)}`,
    headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) },
    server: config.server,
    userId: config.userId,
  };
}

async function readFrom(target: PreferencesTarget): Promise<DisplayPreferences> {
  const response = await fetchWithTimeout(target.url, { headers: target.headers }, API_TIMEOUTS.QUICK);
  if (!response.ok) throwRequestError(response, `Failed to read display preferences: ${response.status}`);
  return (await response.json()) as DisplayPreferences;
}

export async function getDisplayPreferences(id: string, client: string): Promise<DisplayPreferences> {
  return readFrom(await endpoint(id, client));
}

/** A read then a write of one shared record. The API carries no ETag, so writers on two devices
 *  cannot be made safe against each other; this keeps THIS device's writes in line. */
let writeChain: Promise<unknown> = Promise.resolve();

async function writeCustomPrefs(id: string, client: string, edit: (current: Record<string, string | null>) => Record<string, string | null>): Promise<void> {
  const run = writeChain.then(async () => {
    // One target for both halves, and the account is re-read before the write: a switch while the
    // read was in flight, or while this write waited its turn, would merge one account into another.
    const target = await endpoint(id, client);
    const current = await readFrom(target);
    const now = await getConfig();
    if (now.server !== target.server || now.userId !== target.userId) throw new Error("The account changed during the write.");
    const body: DisplayPreferences = { ...current, Id: id, Client: client, CustomPrefs: edit({ ...(current.CustomPrefs ?? {}) }) };
    const response = await fetchWithTimeout(target.url, { method: "POST", headers: { ...target.headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }, API_TIMEOUTS.NORMAL);
    if (!response.ok) throwRequestError(response, `Failed to write display preferences: ${response.status}`);
  });
  // The chain must survive a rejection, or one failed write blocks every write after it.
  writeChain = run.catch(() => undefined);
  return run;
}

/** Merges `customPrefs` into the custom keys the server holds for this id and client. */
export function updateDisplayPreferences(id: string, client: string, customPrefs: Record<string, string>): Promise<void> {
  return writeCustomPrefs(id, client, (current) => ({ ...current, ...customPrefs }));
}

export function editDisplayPreferences(id: string, client: string, edit: (current: Record<string, string | null>) => Record<string, string | null>): Promise<void> {
  return writeCustomPrefs(id, client, edit);
}

/** Drops one custom key, leaving the rest as the server holds them. */
export function removeDisplayPreference(id: string, client: string, key: string): Promise<void> {
  return writeCustomPrefs(id, client, ({ [key]: _dropped, ...rest }) => rest);
}
