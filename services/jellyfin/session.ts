/**
 * The session store: the one place that owns Jellyfin credentials in memory, reads and
 * writes them to SecureStore, and tears them down.
 *
 * Everything downstream (browse, playback, images, ...) reads config from here, which is
 * why this module must never import a domain module. Two consequences worth knowing:
 *
 * - `signOut` lives here, not in auth.ts. `throwRequestError` routes a 401 into
 *   `handleUnauthorized`, which signs out. If signOut lived in auth.ts, session would
 *   depend on auth while auth depends on session. Signing out is "reset the session
 *   store" anyway, so this is where it belongs.
 * - `savedConnectionStatus` and `clearContentCaches` live here for the same reason:
 *   connection.ts, auth.ts and demo.ts all write them.
 */
import { clearFolderContentsCache } from "@/services/folderContentsCache";
import { clearFavoriteIdsCache } from "@/services/favoritesCache";
import { clearPlayedCache } from "@/services/playedCache";
import { clearRequestCache } from "@/services/requestCache";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import { accountTokenKey, API_TIMEOUTS, CLIENT_NAME, CLIENT_VERSION, DEFAULT_QUALITY, DEVICE_NAME, OLD_STORAGE_KEYS, QUALITY_PRESETS, QualityMode, QualityPreset, STORAGE_KEYS } from "./constants";
import { notifyAuthChange } from "./events";
import { fetchWithTimeout } from "./http";

/** The config shape threaded through every internal fetcher. */
export type JellyfinConfig = {
  server: string;
  apiKey: string;
  userId: string;
  deviceId: string;
};

// Cached config for synchronous URL functions
// Will be populated from SecureStore on first load
let cachedConfig: JellyfinConfig = {
  server: "",
  apiKey: "",
  userId: "",
  deviceId: "",
};

/**
 * Snapshot of the credential cache, for the synchronous URL builders.
 *
 * An accessor rather than a directly exported `let`: `getConfig` replaces the object
 * wholesale, and reading a reassigned binding across modules would rely on ES live-binding
 * semantics surviving babel's interop identically under Metro and Jest. Not worth the bet.
 */
export function getCachedConfig(): { server: string; apiKey: string; userId: string } {
  return cachedConfig;
}

// Promise that resolves when config is first loaded
let configInitPromise: Promise<void> | null = null;
let configInitialized = false;

/**
 * The last read threw rather than came back empty. A cold launch behind the lock
 * screen does that ("User interaction is not allowed"), and isAuthenticated then
 * reads as signed out. The read itself retries by itself, since configInitialized
 * stays false — this exists so the recovery can be announced to subscribers.
 */
let configReadFailed = false;

// Reachability of the saved connection, evaluated once per app launch.
// "unknown" until the first evaluation; cached afterwards so we don't re-probe
// (and stall) on every settings focus.
export type SavedConnectionStatus = "unknown" | "connected" | "needs_restore" | "none";
let savedConnectionStatus: SavedConnectionStatus = "unknown";

/**
 * Mark the saved-connection status. Call after a manual connect/restore (connected)
 * or sign out (none) so the cached launch evaluation stays accurate.
 */
export function setSavedConnectionStatus(status: Exclude<SavedConnectionStatus, "unknown">): void {
  savedConnectionStatus = status;
}

/** The cached launch evaluation, or "unknown" before the first probe. */
export function getSavedConnectionStatus(): SavedConnectionStatus {
  return savedConnectionStatus;
}

/**
 * Migrate old config format (IP/port/protocol) to new format (full URL)
 * Returns the migrated URL if migration was performed, null otherwise
 */
async function migrateOldConfigFormat(): Promise<string | null> {
  const [existingUrl, oldIp, oldPort, oldProtocol] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    SecureStore.getItemAsync(OLD_STORAGE_KEYS.SERVER_IP),
    SecureStore.getItemAsync(OLD_STORAGE_KEYS.SERVER_PORT),
    SecureStore.getItemAsync(OLD_STORAGE_KEYS.SERVER_PROTOCOL),
  ]);

  // Only migrate if old format exists and new format doesn't
  if (existingUrl || !oldIp) {
    return null;
  }

  const protocol = oldProtocol || "http";
  const port = oldPort || "8096";
  const migratedUrl = `${protocol}://${oldIp}:${port}`;

  logger.info("Migrating old server config to new format", {
    service: "JellyfinAPI",
    oldIp,
    oldPort: port,
    oldProtocol: protocol,
    newUrl: migratedUrl,
  });

  // Save new format
  await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, migratedUrl);

  // Clean up old keys
  await Promise.all([
    SecureStore.deleteItemAsync(OLD_STORAGE_KEYS.SERVER_IP).catch(() => {}),
    SecureStore.deleteItemAsync(OLD_STORAGE_KEYS.SERVER_PORT).catch(() => {}),
    SecureStore.deleteItemAsync(OLD_STORAGE_KEYS.SERVER_PROTOCOL).catch(() => {}),
  ]);

  return migratedUrl;
}

/**
 * Ensure config is initialized before generating URLs
 * Returns true if config is ready, false if not
 */
export function isConfigReady(): boolean {
  return configInitialized && !!cachedConfig.server && !!cachedConfig.apiKey;
}

/**
 * Synchronous "is the user logged in" check. True only once config is loaded and all three
 * credential pieces are present (mirrors how settings derives the connected state).
 */
export function isAuthenticated(): boolean {
  return configInitialized && !!cachedConfig.server && !!cachedConfig.apiKey && !!cachedConfig.userId;
}

let handlingUnauthorized = false;

/**
 * A 401 on an authenticated data request means the stored token is dead (the demo server resets
 * periodically; a real server can revoke sessions). Jellyfin has no token refresh and no password
 * is stored, so the only recovery is a clean sign-out: credentials clear and, via the auth-change
 * notification, every screen converges on the same disconnected state as a fresh install.
 * Guarded so a burst of parallel 401s triggers exactly one sign-out.
 */
function handleUnauthorized(): void {
  if (handlingUnauthorized || !isAuthenticated()) return;
  handlingUnauthorized = true;
  logger.warn("Server rejected the session token (401), signing out", { service: "JellyfinAPI" });
  // The saved copy of this token is equally dead: delete it so the account
  // picker never offers it. Direct key delete, not accounts.ts — session must
  // stay upstream of every domain module.
  dropActiveAccountToken()
    .catch((error) => logger.warn("Dropping the saved token after 401 failed", error, { service: "JellyfinAPI" }))
    .then(() => signOut())
    .catch((error) => logger.error("Sign-out after 401 rejection failed", error, { service: "JellyfinAPI" }))
    .finally(() => {
      handlingUnauthorized = false;
    });
}

/** Delete the saved-account token matching the active session, if both ids are stored. */
async function dropActiveAccountToken(): Promise<void> {
  const [serverId, userId] = await Promise.all([SecureStore.getItemAsync(STORAGE_KEYS.SERVER_ID), SecureStore.getItemAsync(STORAGE_KEYS.USER_ID)]);
  if (!serverId || !userId) return;
  await SecureStore.deleteItemAsync(accountTokenKey(serverId, userId)).catch(() => {});
}

/**
 * Throw for a failed AUTHENTICATED data response. A 401 routes through the session-expiry
 * sign-out above; every other status throws `message` unchanged. Auth flows (login, Quick
 * Connect, demo validation) keep their own status handling and must NOT use this.
 */
export function throwRequestError(response: Response, message: string): never {
  if (response.status === 401) {
    handleUnauthorized();
    throw new Error("Session expired. Please sign in again.");
  }
  throw new Error(message);
}

/**
 * Wait for config to be initialized
 * Call this before rendering components that need images
 */
export async function waitForConfig(): Promise<void> {
  if (configInitialized) return;
  if (configInitPromise) {
    await configInitPromise;
  } else {
    // If no init promise exists, trigger initialization
    await getConfig();
  }
}

/**
 * Get Jellyfin configuration. Returns empty strings when the user hasn't configured
 * a server yet.
 *
 * Served from the in-memory cache once initialized: request paths call this per fetch,
 * and a keychain round-trip per credential key on every call is a measurable startup
 * burst. `force` performs the full SecureStore read (and one-shot format migration);
 * every credential write already funnels through `refreshConfig`, which forces.
 */
export async function getConfig(force = false): Promise<JellyfinConfig> {
  if (!force) {
    if (configInitPromise) await configInitPromise;
    if (configInitialized) return cachedConfig;
  }
  try {
    // First, check if migration is needed (old format to new format)
    const migratedUrl = await migrateOldConfigFormat();

    const [serverUrl, apiKey, userId, deviceId] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
      SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
      SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
      getOrCreateDeviceId(),
    ]);

    const cleanServerUrl = (migratedUrl || serverUrl?.trim() || "").replace(/\/+$/, "");

    const config = {
      server: cleanServerUrl,
      apiKey: apiKey?.trim() || "",
      userId: userId?.trim() || "",
      deviceId,
    };

    // Update cache for synchronous functions
    cachedConfig = config;
    configInitialized = true;

    // Recovered from a failed read: isAuthenticated answered "signed out" while it
    // stood, and nothing re-asks on its own. Tell the subscribers it moved.
    if (configReadFailed) {
      configReadFailed = false;
      logger.info("Config read recovered after an earlier failure", { service: "JellyfinAPI" });
      notifyAuthChange();
    }

    logger.debug("Config loaded", {
      service: "JellyfinAPI",
      hasStoredUrl: !!serverUrl,
      server: config.server,
      hasApiKey: !!config.apiKey,
      hasUserId: !!config.userId,
    });

    return config;
  } catch (error) {
    // Not the same as "nothing stored": the credentials may be there and unreadable.
    configReadFailed = true;
    logger.error("Error reading Jellyfin config from SecureStore", error, {
      service: "JellyfinAPI",
    });
    return {
      server: "",
      apiKey: "",
      userId: "",
      deviceId: "",
    };
  }
}

/** True when the last config read threw, so an empty config is "unreadable", not "signed out". */
export function didConfigReadFail(): boolean {
  return configReadFailed;
}

/**
 * Refresh the config cache - call this after updating settings
 */
export async function refreshConfig(): Promise<void> {
  await getConfig(true);
}

/** Generate a UUID-like random ID (not cryptographically secure; correlation only). */
function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a per-playback-session ID. Sent with every Sessions report and appended to
 * transcode URLs so the server can tie the HLS transcode session to the reports.
 */
export function generatePlaySessionId(): string {
  return generateUuid();
}

/**
 * A fresh device identity for a new sign-in. Jellyfin keeps one token per DeviceId
 * per server, so accounts that must coexist each authenticate under their own id.
 */
export function generateDeviceId(): string {
  return generateUuid();
}

/**
 * Get or create the ACTIVE session's device ID. Written on install, and overwritten
 * with the account's own deviceId on every login or account switch, so auth headers,
 * stream URLs, and the Top Shelf extension all follow the active account.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  let deviceId = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = generateUuid();
    await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, deviceId);
    logger.debug("Generated new device ID", { service: "JellyfinAPI", deviceId });
  }
  return deviceId;
}

/**
 * Build the standard Jellyfin MediaBrowser authorization header.
 * Always identifies the client (Client/Device/DeviceId/Version); includes
 * Token only for authenticated requests.
 */
export function getAuthHeader(deviceId: string, token?: string): string {
  const base = `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${deviceId}", Version="${CLIENT_VERSION}"`;
  return token ? `${base}, Token="${token}"` : base;
}

/**
 * Ask the server whether a token still authenticates, with explicit credentials —
 * never the active config, since the caller is deciding whether to ADOPT these.
 * "invalid" is only a definitive server rejection; anything else the network can
 * cause reports "unreachable" so a Wi-Fi flap can't get a live token deleted.
 */
export async function validateAccessToken(serverUrl: string, token: string, deviceId: string): Promise<"valid" | "invalid" | "unreachable"> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  try {
    const response = await fetchWithTimeout(
      `${cleanUrl}/Users/Me`,
      {
        method: "GET",
        headers: { Accept: "application/json", Authorization: getAuthHeader(deviceId, token) },
      },
      API_TIMEOUTS.SHORT,
    );
    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

/**
 * Clear every content cache that holds data from the current server. Called on
 * any credential or server-URL change so nothing stale survives the switch.
 */
export async function clearContentCaches(context: string): Promise<void> {
  try {
    const { libraryManager } = await import("@/services/libraryManager");
    // Dynamic import, like libraryManager above: nextUp imports its fetchers from this module.
    const { clearNextUpDismissals } = await import("@/services/nextUp");
    libraryManager.clearCache();
    clearFolderContentsCache();
    clearFavoriteIdsCache();
    clearPlayedCache();
    clearRequestCache();
    clearNextUpDismissals();
  } catch (cacheError) {
    logger.warn(`Failed to clear manager caches ${context}`, cacheError, {
      service: "JellyfinAPI",
    });
  }

  // Item ids collide across servers, so a settled keyframe (a failure included) must not
  // answer for the next server's item of the same id, in memory or in the engine's pool on
  // disk. Its own step: the engine is native.
  try {
    const { clearFramePool, clearPosterFrameCache } = await import("@/services/localRemux");
    clearPosterFrameCache();
    await clearFramePool();
  } catch (frameError) {
    logger.warn(`Failed to clear the frame pool ${context}`, frameError, {
      service: "JellyfinAPI",
    });
  }
}

/**
 * Sign out: clear the ACTIVE session's credential keys and reset config. Saved
 * accounts (jellyfin_accounts + their token keys) survive, so the server card
 * offers a one-tap return; removing a saved server is what deletes them.
 */
export async function signOut(): Promise<void> {
  // Background music must not outlive the account. Lazy import: this module is
  // upstream of the jellyfinApi barrel the audio manager imports, so a static
  // import here would be a cycle.
  try {
    const { audioPlayerManager } = await import("@/services/audioPlayerManager");
    await audioPlayerManager.stop();
  } catch {
    // Native module unavailable (tests, Android): nothing to stop.
  }

  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_URL),
    SecureStore.deleteItemAsync(STORAGE_KEYS.API_KEY),
    SecureStore.deleteItemAsync(STORAGE_KEYS.USER_ID),
    SecureStore.deleteItemAsync(STORAGE_KEYS.USER_NAME),
    SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_METHOD),
    SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_NAME),
    SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_ID),
    SecureStore.deleteItemAsync(STORAGE_KEYS.IS_DEMO_MODE),
  ]);

  // Refresh config to reset to defaults
  await refreshConfig();
  setSavedConnectionStatus("none");

  // Clear manager caches (stale server content). Resume history lives server-side
  // per user (playback reporting), so there is nothing local to clear.
  await clearContentCaches("on sign out");

  logger.info("User signed out", { service: "JellyfinAPI" });

  notifyAuthChange();
}

/**
 * Get video quality settings from SecureStore.
 * Index 5 ("Auto" in Settings) reports mode "auto": its preset fields are the
 * Original CEILING and the adaptive controller picks the transcode entry.
 * Explicit 0-4 picks report "fixed" and are never auto-changed.
 */
export async function getQualitySettings(): Promise<QualityPreset & { index: number; mode: QualityMode }> {
  try {
    const savedQuality = await SecureStore.getItemAsync(STORAGE_KEYS.VIDEO_QUALITY);
    const qualityIndex = savedQuality ? parseInt(savedQuality, 10) : DEFAULT_QUALITY;

    // Validate index is within bounds
    const validIndex = qualityIndex >= 0 && qualityIndex < QUALITY_PRESETS.length ? qualityIndex : DEFAULT_QUALITY;
    return { index: validIndex, mode: validIndex === DEFAULT_QUALITY ? "auto" : "fixed", ...QUALITY_PRESETS[validIndex] };
  } catch (error) {
    logger.error("Error reading quality settings", error);
    return { index: DEFAULT_QUALITY, mode: "auto", ...QUALITY_PRESETS[DEFAULT_QUALITY] };
  }
}

// Initialize config cache on module load
configInitPromise = getConfig()
  .then(() => {
    configInitPromise = null;
  })
  .catch(() => {
    configInitPromise = null;
    // Silent fail, will use defaults
  });
