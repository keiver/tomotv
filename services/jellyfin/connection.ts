/**
 * Finding and remembering servers: probing a candidate URL, expanding a bare host into
 * ordered candidates, the saved-server list, and the launch-time reachability evaluation.
 *
 * Auth lives next door in auth.ts; nothing here needs a token.
 */
import { isLocalNetworkPrimed, LOCAL_NETWORK_GRACE_MS, LOCAL_NETWORK_POLL_MS, markLocalNetworkPrimedFor } from "@/services/localNetworkPermission";
import { JellyfinPublicServerInfo, SavedServer } from "@/types/jellyfin";
import { warmBitrateMemory } from "./bitrateTest";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_TIMEOUTS, STORAGE_KEYS } from "./constants";
import { notifyAuthChange } from "./events";
import { clearContentCaches, getSavedConnectionStatus, refreshConfig, SavedConnectionStatus, setSavedConnectionStatus } from "./session";
/** Why a single /System/Info/Public probe failed, for per-candidate diagnostics. */
export type ProbeFailureReason = "timeout" | "unreachable" | "not_jellyfin" | "http_status";

/**
 * A failed server probe. Carries the candidate URL and a machine-readable reason
 * so the resolver can report which address failed and how, instead of collapsing
 * everything into one string. The `message` text is unchanged from before so
 * existing callers and tests that match on it keep working.
 */
export class ProbeError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly reason: ProbeFailureReason,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProbeError";
  }
}

/** One-line, human-readable summary of a probe failure, for the connect error list. */
function describeProbeFailure(error: unknown): string {
  if (!(error instanceof ProbeError)) return "failed";
  switch (error.reason) {
    case "timeout":
      return "no response";
    case "http_status":
      return `HTTP ${error.status}`;
    case "not_jellyfin":
      return "not a Jellyfin server";
    default:
      return "unreachable";
  }
}

/**
 * Validate a server URL by hitting /System/Info/Public (no auth required).
 * Returns server name, version, and ID if the server is reachable.
 *
 * `timeoutMs` is overridable so callers can size the budget to the situation.
 *
 * `signal` lets a caller abandon the request before the timeout. The local-network
 * scan passes one so that pressing Stop drops the requests already in flight
 * instead of leaving dozens of sockets to run their timeout out. An external abort
 * surfaces as the `timeout` reason — the distinction has no consumer, and adding a
 * ProbeFailureReason for it would ripple through the connect-failure list.
 */
export async function checkServerInfo(serverUrl: string, timeoutMs: number = API_TIMEOUTS.SHORT, signal?: AbortSignal): Promise<JellyfinPublicServerInfo> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const url = `${cleanUrl}/System/Info/Public`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // A sweep makes thousands of these against one signal, so the listener has to
  // come off again — see the cleanup paired with every clearTimeout below.
  const abortNow = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortNow);
  }
  const releaseSignal = () => signal?.removeEventListener("abort", abortNow);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    releaseSignal();

    if (!response.ok) {
      // Message deliberately matches the generic unreachable text this path has
      // always produced; the status travels on the error for the diagnostic list.
      throw new ProbeError("Unable to reach Jellyfin server. Check the URL and ensure the server is running.", cleanUrl, "http_status", response.status);
    }

    const data: JellyfinPublicServerInfo = await response.json();

    if (!data.ServerName || !data.Version) {
      throw new ProbeError("Response missing ServerName or Version — not a valid Jellyfin server", cleanUrl, "not_jellyfin");
    }

    logger.info("Server info validated", {
      service: "JellyfinAPI",
      serverName: data.ServerName,
      version: data.Version,
    });

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    releaseSignal();
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProbeError("Connection timed out. Check the server URL and make sure Jellyfin is running.", cleanUrl, "timeout");
    }
    if (error instanceof ProbeError) {
      // Preserve the specific reason (not_jellyfin, http_status) raised above.
      throw error;
    }
    throw new ProbeError("Unable to reach Jellyfin server. Check the URL and ensure the server is running.", cleanUrl, "unreachable");
  }
}

/**
 * Build the ordered list of candidate base URLs to probe for a user-entered address.
 *
 * - A full URL (http:// or https://) is used exactly as entered.
 * - A host/IP with an explicit port is probed over both protocols.
 * - A host/IP without a port is probed over Jellyfin's default ports
 *   (8920 https, 8096 http) and the standard ports (443, 80).
 *
 * A trailing path is preserved and kept after the port, so a reverse-proxy
 * address like "10.0.0.5/jellyfin" yields "https://10.0.0.5/jellyfin" rather
 * than the malformed "https://10.0.0.5/jellyfin:8920". A path also implies a
 * proxy on 443/80, so those candidates are ordered first in that case.
 */
export function buildServerUrlCandidates(input: string): string[] {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return [];

  // Already has a scheme — respect the user's exact URL.
  if (/^https?:\/\//i.test(trimmed)) {
    return [trimmed];
  }

  const hostAndPath = trimmed.replace(/^\/+/, "");
  if (!hostAndPath) return [];

  // Split "host[:port]" from any "/path" so the port is never appended after it.
  const slash = hostAndPath.indexOf("/");
  const authority = slash === -1 ? hostAndPath : hostAndPath.slice(0, slash);
  const path = slash === -1 ? "" : hostAndPath.slice(slash);
  if (!authority) return [];

  // Explicit port given — keep it, just try both protocols.
  if (/:\d+$/.test(authority)) {
    return [`https://${authority}${path}`, `http://${authority}${path}`];
  }

  const standardPorts = [`https://${authority}${path}`, `http://${authority}${path}`];
  const jellyfinPorts = [`https://${authority}:8920${path}`, `http://${authority}:8096${path}`];

  // A subpath means a reverse proxy, which listens on 443/80 far more often than
  // on Jellyfin's own ports. Without a path, Jellyfin's defaults come first.
  return path ? [...standardPorts, ...jellyfinPorts] : [jellyfinPorts[0], standardPorts[0], jellyfinPorts[1], standardPorts[1]];
}

/**
 * iOS also drops an app's first LAN request after an unlock or reboot even with
 * Local Network already granted (widely reported on iOS 17/18 as instant
 * no-route/refused failures that a simple retry cures). Distinct from the
 * unprimed grace window above: this is a single quick retry, and only for
 * failures at the socket level — a server that actively answered (HTTP status,
 * non-Jellyfin payload) or timed out is not suffering that flake.
 */
const FLAKE_RETRY_DELAY_MS = 1_000;

/** Whether a resolve failure is socket-level on every candidate it tried. */
function isSocketLevelFailure(error: unknown): boolean {
  if (error instanceof ProbeError) return error.reason === "unreachable";
  const reasons = (error as { probeReasons?: unknown }).probeReasons;
  return Array.isArray(reasons) && reasons.length > 0 && reasons.every((reason) => reason === "unreachable");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve a user-entered server address to a working Jellyfin base URL.
 *
 * Accepts a full URL (used as-is) or a bare IP/hostname (auto-discovers the
 * protocol and port by probing candidates concurrently). Returns the first
 * candidate that responds as a valid Jellyfin server, along with its info.
 *
 * On the first-ever attempt after install, a failure is retried for a grace
 * window in case the Local Network permission prompt is what blocked it — see
 * services/localNetworkPermission.ts.
 */
export async function resolveServerConnection(input: string): Promise<{ url: string; info: JellyfinPublicServerInfo }> {
  const candidates = buildServerUrlCandidates(input);
  if (candidates.length === 0) {
    throw new Error("Please enter a server address.");
  }

  try {
    return await probeResolveCandidates(candidates, input);
  } catch (error) {
    if (isLocalNetworkPrimed()) {
      // Permission already settled, so a socket-level failure may still be the
      // post-unlock first-request flake — retry once. The retry's own failure
      // is the freshest truth, so it propagates as-is.
      if (Platform.OS !== "ios" || !isSocketLevelFailure(error)) throw error;
      logger.info("Probe failed at socket level, retrying once for the first-request flake", { service: "JellyfinAPI" });
      await sleep(FLAKE_RETRY_DELAY_MS);
      return await probeResolveCandidates(candidates, input);
    }

    // First LAN attempt since install: the failure is as likely the pending
    // Local Network prompt as a dead server, so keep probing while the user
    // answers. The first success continues the login as if nothing happened.
    const deadline = Date.now() + LOCAL_NETWORK_GRACE_MS;
    while (Date.now() < deadline) {
      await sleep(LOCAL_NETWORK_POLL_MS);
      try {
        return await probeResolveCandidates(candidates, input);
      } catch {
        // Still failing: prompt unanswered, denied, or the server really is down.
      }
    }

    // The window drained without a success — the user may have denied the
    // prompt, so point at Settings alongside the original failure. The
    // multi-candidate error already carries this line.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Local Network access")) throw error;
    throw new Error(`${message}\n\nIf this is your first connection, allow Local Network access in Settings > General > Privacy & Security.`);
  }
}

/** One pass over the candidates: single candidate probed directly, several raced. */
async function probeResolveCandidates(candidates: string[], input: string): Promise<{ url: string; info: JellyfinPublicServerInfo }> {
  // Single candidate (a full URL): probe directly so its specific error surfaces.
  if (candidates.length === 1) {
    const info = await checkServerInfo(candidates[0]);
    markLocalNetworkPrimedFor(candidates[0]);
    return { url: candidates[0], info };
  }

  // Multiple candidates: race them and take the first that works, so a reachable
  // server connects immediately instead of waiting on the candidates that will
  // time out. A cold Jellyfin can exceed the routine health-check budget on its
  // first request, so the race gets a wider timeout.
  try {
    const result = await Promise.any(
      candidates.map(async (url) => {
        const info = await checkServerInfo(url, API_TIMEOUTS.RESOLVE);
        return { url, info };
      }),
    );
    markLocalNetworkPrimedFor(result.url);
    return result;
  } catch (error) {
    // Nothing worked. The rejection is an AggregateError whose `errors` preserves
    // candidate order, so report what was tried and how each attempt failed
    // instead of collapsing every cause into one unactionable sentence. Read
    // `errors` structurally rather than via instanceof, so this can't itself
    // throw if the runtime's Promise.any rejects with something else.
    const aggregate = error as { errors?: unknown };
    const failures: unknown[] = Array.isArray(aggregate?.errors) ? aggregate.errors : [];
    const breakdown = candidates.map((url, index) => `  ${url}  ${describeProbeFailure(failures[index])}`).join("\n");

    const resolveError = new Error(
      [
        `Couldn't reach a Jellyfin server at ${input.trim()}.`,
        breakdown,
        "",
        "If Jellyfin uses a different port, paste the full URL (e.g. http://192.168.1.100:8096).",
        "If this is your first connection, allow Local Network access in Settings > General > Privacy & Security.",
      ].join("\n"),
    );
    // Per-candidate reasons ride along so isSocketLevelFailure can tell an
    // all-sockets-dead failure (retryable flake) from a server that answered.
    (resolveError as Error & { probeReasons?: (ProbeFailureReason | null)[] }).probeReasons = candidates.map((url, index) => {
      const failure = failures[index];
      return failure instanceof ProbeError ? failure.reason : null;
    });
    throw resolveError;
  }
}

/**
 * Read saved connection details for the "Restore last connection" CTA.
 * Returns null when there is no complete saved connection.
 */
export async function getSavedConnectionInfo(): Promise<{ url: string; serverName: string } | null> {
  const [url, serverName, apiKey, userId] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_NAME),
    SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
    SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
  ]);
  if (!url || !apiKey || !userId) return null;
  return { url, serverName: serverName || url };
}

/** Normalize a server URL for use as a stable dedup id (trim + strip trailing slashes). */
function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Read the locally persisted list of servers, most-recently-connected first.
 *
 * One-time seed-migration: only when the key has NEVER been written do we seed
 * from the legacy single-server keys, so existing users see their last
 * connection as a card. Seeding on every empty list would make the last server
 * impossible to remove (it would be re-seeded from the still-present
 * single-server keys on the very next read).
 */
export async function getSavedServers(): Promise<SavedServer[]> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEYS.SAVED_SERVERS);

  if (raw === null) {
    const info = await getSavedConnectionInfo();
    const url = info ? normalizeServerUrl(info.url) : "";
    const seeded: SavedServer[] = info ? [{ id: url, name: info.serverName, url, lastConnectedAt: Date.now() }] : [];
    await SecureStore.setItemAsync(STORAGE_KEYS.SAVED_SERVERS, JSON.stringify(seeded));
    return seeded;
  }

  let servers: SavedServer[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) servers = parsed as SavedServer[];
  } catch {
    servers = [];
  }

  return servers.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
}

/**
 * Add or update a saved server. Deduped by the server's system Id when known —
 * the same server at a new address updates its card instead of growing a second
 * one — with the normalized url as the fallback key. New servers default to
 * their connection string as the display name; existing servers keep their
 * (possibly user-renamed) name and just bump lastConnectedAt to sort to front.
 */
export async function upsertSavedServer(url: string, name?: string, serverId?: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return;

  const servers = await getSavedServers();
  const existing = (serverId && servers.find((s) => s.serverId === serverId)) || servers.find((s) => s.id === normalized);
  if (existing) {
    existing.lastConnectedAt = Date.now();
    existing.id = normalized;
    existing.url = normalized;
    if (serverId) existing.serverId = serverId;
  } else {
    servers.push({ id: normalized, name: name?.trim() || normalized, url: normalized, lastConnectedAt: Date.now(), serverId });
  }

  await SecureStore.setItemAsync(STORAGE_KEYS.SAVED_SERVERS, JSON.stringify(servers));
}

/** Rename a saved server by id. No-op if the name is blank or the id is unknown. */
export async function renameSavedServer(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  const servers = await getSavedServers();
  const target = servers.find((s) => s.id === id);
  if (!target) return;
  target.name = trimmed;
  await SecureStore.setItemAsync(STORAGE_KEYS.SAVED_SERVERS, JSON.stringify(servers));
}

/** Remove a saved server by id. */
export async function removeSavedServer(id: string): Promise<void> {
  const servers = await getSavedServers();
  const next = servers.filter((s) => s.id !== id);
  await SecureStore.setItemAsync(STORAGE_KEYS.SAVED_SERVERS, JSON.stringify(next));
}

/**
 * Auto-try the saved connection once per app launch.
 *
 * - "none": no complete saved connection.
 * - "connected": the saved server URL is reachable — safe to keep using it.
 * - "needs_restore": creds exist but the saved URL is unreachable (e.g. the IP
 *   changed), so the UI should offer manual restore / re-entry.
 *
 * The result is cached for the session; pass force=true to re-evaluate.
 */
export async function evaluateSavedConnection(force = false): Promise<Exclude<SavedConnectionStatus, "unknown">> {
  const cached = getSavedConnectionStatus();
  if (cached !== "unknown" && !force) {
    return cached;
  }

  const [url, apiKey, userId] = await Promise.all([SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL), SecureStore.getItemAsync(STORAGE_KEYS.API_KEY), SecureStore.getItemAsync(STORAGE_KEYS.USER_ID)]);

  if (!url || !apiKey || !userId) {
    setSavedConnectionStatus("none");
    return "none";
  }

  try {
    const info = await checkServerInfo(url);
    setSavedConnectionStatus("connected");
    // Backfill the server's stable Id for installs that logged in before it was stored
    if (info.Id) {
      const storedId = await SecureStore.getItemAsync(STORAGE_KEYS.SERVER_ID);
      if (!storedId) {
        await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_ID, info.Id);
      }
    }
  } catch {
    setSavedConnectionStatus("needs_restore");
  }
  return getSavedConnectionStatus() as Exclude<SavedConnectionStatus, "unknown">;
}

/** The stored system Id of the connected server (null before first login/backfill). */
export async function getStoredServerId(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.SERVER_ID);
}

/**
 * Adopt a new base URL for the SAME server (matched by system Id) after its
 * address changed. Credentials stay valid — Jellyfin tokens bind to server +
 * device, not to the address — so this is a URL swap, not a re-login. The Top
 * Shelf extension reads the keychain directly and picks the new URL up on its
 * next query.
 */
export async function adoptRecoveredServerUrl(url: string): Promise<void> {
  const cleanUrl = url.trim().replace(/\/+$/, "");
  await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, cleanUrl);
  // Before upsertSavedServer: if that throws, the cache must already match the store
  await refreshConfig();
  // The Id keys the upsert to the moved server's existing card, updating its url.
  const serverId = await getStoredServerId();
  await upsertSavedServer(cleanUrl, undefined, serverId ?? undefined);
  setSavedConnectionStatus("connected");
  await clearContentCaches("after URL recovery");
  logger.info("Adopted recovered server URL", { service: "JellyfinAPI", url: cleanUrl });
  notifyAuthChange();
  // A moved server is a new memory key with nothing in it, and the routing gate
  // reads that memory without ever probing for itself.
  warmBitrateMemory();
}

/**
 * Restore the last connection: probe the saved server (exact URL plus
 * auto-discovered protocol/port candidates for the same host) and, if reachable,
 * reconnect with the saved login. Updates the stored URL if the protocol/port
 * changed. Throws if the host can't be reached (likely the IP itself changed).
 */
export async function restoreLastConnection(): Promise<{ url: string; serverName: string }> {
  const [savedUrl, serverName, apiKey, userId] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_NAME),
    SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
    SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
  ]);

  if (!savedUrl || !apiKey || !userId) {
    throw new Error("No saved connection to restore.");
  }

  // Try the exact saved URL first, then auto-discovered candidates for the host.
  const host = savedUrl.replace(/^https?:\/\//i, "");
  const candidates = Array.from(new Set([savedUrl, ...buildServerUrlCandidates(host)]));

  let workingUrl: string;
  try {
    workingUrl = await Promise.any(
      candidates.map(async (candidate) => {
        await checkServerInfo(candidate);
        return candidate;
      }),
    );
  } catch {
    throw new Error(`Couldn't reach ${serverName || "your last server"}. Its address may have changed — enter the new IP or hostname below.`);
  }

  // Persist a corrected URL (protocol/port may have changed) and refresh config.
  if (workingUrl !== savedUrl) {
    await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, workingUrl);
  }
  await refreshConfig();
  setSavedConnectionStatus("connected");

  // Clear stale navigation cache so the library reloads against the live URL.
  await clearContentCaches("during restore");

  logger.info("Restored last connection", { service: "JellyfinAPI", url: workingUrl, serverName });
  notifyAuthChange();
  // A corrected protocol/port is a different memory key, same reason as above.
  warmBitrateMemory();
  return { url: workingUrl, serverName: serverName || workingUrl };
}
