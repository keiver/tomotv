import {
  JellyfinAuthResult,
  JellyfinFolderResponse,
  JellyfinItem,
  JellyfinMediaStream,
  JellyfinNamedItem,
  JellyfinPublicServerInfo,
  JellyfinVideoItem,
  JellyfinVideosResponse,
  EMPTY_FILTERS,
  LibraryFilters,
  QuickConnectResult,
  SavedServer,
} from "@/types/jellyfin";
import { clearFolderContentsCache } from "@/services/folderContentsCache";
import { addFavoriteIds, clearFavoriteIdsCache, getFavoriteIds, isFavoritesLoaded, markFavorite } from "@/services/favoritesCache";
import { clearPlayedCache, getPlayedOverrides, markPlayed } from "@/services/playedCache";
import { REMUXABLE_CODECS } from "@/services/localRemux";
import { cachedRequest, clearRequestCache, invalidateByPrefix } from "@/services/requestCache";
import { CACHE } from "@/constants/app";
import { logger } from "@/utils/logger";
import { retryWithBackoff } from "@/utils/retry";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Client identification sent to Jellyfin in the MediaBrowser auth header.
// Version is sourced from app.json (single source of truth) so it never drifts.
const CLIENT_NAME = "TomoTV";
const CLIENT_VERSION = Constants.expoConfig?.version ?? "0.0.0";
// Platform.OS is "ios" even on Apple TV (react-native-tvos); derive the device
// name from both Platform.OS and Platform.isTV so each platform reports correctly.
function resolveDeviceName(): string {
  if (Platform.OS === "ios") return Platform.isTV ? "Apple TV" : "iOS";
  if (Platform.OS === "android") return Platform.isTV ? "Android TV" : "Android";
  return Platform.OS;
}
const DEVICE_NAME = resolveDeviceName();

const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
  IS_DEMO_MODE: "jellyfin_is_demo_mode",
  DEVICE_ID: "jellyfin_device_id",
  USER_NAME: "jellyfin_user_name",
  AUTH_METHOD: "jellyfin_auth_method",
  SERVER_NAME: "jellyfin_server_name",
  SERVER_ID: "jellyfin_server_id",
  SAVED_SERVERS: "jellyfin_saved_servers",
};

// Demo server credentials (Jellyfin's official public demo server)
// Credentials are fetched dynamically as the demo server resets hourly
export const DEMO_SERVER_STABLE = "https://demo.jellyfin.org/stable";
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = ""; // Empty password

// Video quality presets (matches settings page)
interface QualityPreset {
  label: string;
  bitrate: number;
  width?: number;
  height?: number;
  level?: number;
}

// "Original" carries no resolution or level caps, so the server stream-copies
// (remuxes) compatible video instead of re-encoding it. Its bitrate is a
// ceiling no real file reaches, present because the HLS endpoint expects one.
// VideoLevel must stay unset on it: H.264 and HEVC report levels on different
// scales (H.264 5.1 = 51, HEVC 5.1 = 153), and a single scalar cap would
// wrongly block HEVC stream copy.
const QUALITY_PRESETS: QualityPreset[] = [
  { label: "480p", bitrate: 1500000, width: 854, height: 480, level: 41 },
  { label: "540p", bitrate: 2500000, width: 960, height: 540, level: 41 },
  { label: "720p", bitrate: 4000000, width: 1280, height: 720, level: 41 },
  { label: "1080p", bitrate: 8000000, width: 1920, height: 1080, level: 41 },
  { label: "4K", bitrate: 20000000, width: 3840, height: 2160, level: 51 },
  { label: "Original", bitrate: 120000000 },
];

const DEFAULT_QUALITY = 5; // Original

// Standardized timeout constants
const API_TIMEOUTS = {
  SHORT: 5000, // 5s - For very quick operations
  RESOLVE: 8000, // 8s - Racing connect candidates; a cold Jellyfin can be slow on its first request
  QUICK: 10000, // 10s - For simple queries, listing items
  NORMAL: 15000, // 15s - For fetches with moderate data
  EXTENDED: 30000, // 30s - For large data fetches (library items)
} as const;

// Transcoding quality constants
const TRANSCODING = {
  AUDIO_BITRATE: 192000, // 192kbps AAC
  MAX_AUDIO_CHANNELS: 2, // Stereo output on capped presets
  SURROUND_AUDIO_CHANNELS: 6, // On "Original": lets 5.1 AC3/EAC3 stream-copy
} as const;

// Jellyfin time constants
export const JELLYFIN_TIME = {
  TICKS_PER_SECOND: 10000000, // Jellyfin uses 100-nanosecond intervals (ticks)
} as const;

// Cached config for synchronous URL functions
// Will be populated from SecureStore on first load
let cachedConfig = {
  server: "",
  apiKey: "",
  userId: "",
};

// Promise that resolves when config is first loaded
let configInitPromise: Promise<void> | null = null;
let configInitialized = false;

// Reachability of the saved connection, evaluated once per app launch.
// "unknown" until the first evaluation; cached afterwards so we don't re-probe
// (and stall) on every settings focus.
type SavedConnectionStatus = "unknown" | "connected" | "needs_restore" | "none";
let savedConnectionStatus: SavedConnectionStatus = "unknown";

// Old storage keys for migration (deprecated format)
const OLD_STORAGE_KEYS = {
  SERVER_IP: "jellyfin_server_ip",
  SERVER_PORT: "jellyfin_server_port",
  SERVER_PROTOCOL: "jellyfin_server_protocol",
} as const;

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

// Auth-change pub/sub so UI (e.g. the tab bar) can react synchronously to login/logout.
const authListeners = new Set<() => void>();

/** Subscribe to login/logout transitions. Returns an unsubscribe function. */
export function subscribeAuthChange(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

function notifyAuthChange(): void {
  authListeners.forEach((cb) => cb());
}

/**
 * Fire the auth-change refresh path after connection recovery confirms the
 * server is reachable again without any credential/URL change (a transient
 * blip). Consumers that show a load error re-fetch through the same
 * subscription that handles login.
 */
export function notifyServerRecovered(): void {
  notifyAuthChange();
}

// Favorite-change pub/sub. Carries the toggled item id and its new state so subscribers can repaint
// that exact card in place — the browse's per-item UserData.IsFavorite is unreliable and the heart
// cache is add-only, so a removal has no other way to clear the heart without a full (racy) refetch.
const favoriteListeners = new Set<(itemId: string, favorite: boolean) => void>();

/** Subscribe to favorite toggles. Returns an unsubscribe function. */
export function subscribeFavoriteChange(cb: (itemId: string, favorite: boolean) => void): () => void {
  favoriteListeners.add(cb);
  return () => favoriteListeners.delete(cb);
}

function notifyFavoriteChange(itemId: string, favorite: boolean): void {
  favoriteListeners.forEach((cb) => cb(itemId, favorite));
}

// Played-change pub/sub, mirroring the favorite one: carries the item id and its new
// state so subscribers repaint that exact card's checkmark in place, no refetch.
const playedListeners = new Set<(itemId: string, played: boolean) => void>();

/** Subscribe to played-state changes (manual toggles, playback completion). Returns unsubscribe. */
export function subscribePlayedChange(cb: (itemId: string, played: boolean) => void): () => void {
  playedListeners.add(cb);
  return () => playedListeners.delete(cb);
}

function notifyPlayedChange(itemId: string, played: boolean): void {
  playedListeners.forEach((cb) => cb(itemId, played));
}

// Resume-change pub/sub, mirroring the played one: fired whenever the server's resume
// state for an item was just rewritten (playback stop, resume persist, manual clear).
// A Continue Watching view fetched DURING those writes can catch the server mid-update
// (a Resume query concurrent with Sessions/Stopped transiently omits the item), so the
// row must refetch after the LAST write lands — this signal is that trigger.
const resumeListeners = new Set<() => void>();

/** Subscribe to resume-state changes. Returns unsubscribe. */
export function subscribeResumeChange(cb: () => void): () => void {
  resumeListeners.add(cb);
  return () => resumeListeners.delete(cb);
}

function notifyResumeChange(): void {
  resumeListeners.forEach((cb) => cb());
}

/**
 * Record a played-state change without an HTTP call: override map + subscriber repaint,
 * plus dropping cached played/unplayed-filtered listings (a just-finished item must not
 * resurface from a cached "Unplayed" view). Used by the playback reporter, where the
 * server has already been updated by the Stopped report itself.
 */
export function markItemPlayed(itemId: string, played: boolean): void {
  markPlayed(itemId, played);
  notifyPlayedChange(itemId, played);
  if (cachedConfig.userId) invalidateByPrefix(`filtered:${cachedConfig.userId}:`);
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
  signOut()
    .catch((error) => logger.error("Sign-out after 401 rejection failed", error, { service: "JellyfinAPI" }))
    .finally(() => {
      handlingUnauthorized = false;
    });
}

/**
 * Throw for a failed AUTHENTICATED data response. A 401 routes through the session-expiry
 * sign-out above; every other status throws `message` unchanged. Auth flows (login, Quick
 * Connect, demo validation) keep their own status handling and must NOT use this.
 */
function throwRequestError(response: Response, message: string): never {
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
 * Get Jellyfin configuration from SecureStore
 * Returns empty strings when the user hasn't configured a server yet
 * Also updates the cache for synchronous functions
 */
export async function getConfig(): Promise<{
  server: string;
  apiKey: string;
  userId: string;
  deviceId: string;
}> {
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

    logger.debug("Config loaded", {
      service: "JellyfinAPI",
      hasStoredUrl: !!serverUrl,
      server: config.server,
      hasApiKey: !!config.apiKey,
      hasUserId: !!config.userId,
    });

    return config;
  } catch (error) {
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

/**
 * Refresh the config cache - call this after updating settings
 */
export async function refreshConfig(): Promise<void> {
  await getConfig();
}

/**
 * Fetch demo credentials from Jellyfin API
 * Demo server resets hourly, so credentials must be fetched fresh each time
 * @param demoServerUrl - The demo server URL to use (stable or unstable)
 */
async function fetchDemoCredentials(demoServerUrl: string): Promise<{ apiKey: string; userId: string }> {
  const url = `${demoServerUrl}/Users/AuthenticateByName`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for real-world conditions

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: demoServerUrl,
        Authorization: getAuthHeader("demo-device"),
      },
      body: JSON.stringify({
        Username: DEMO_USERNAME,
        Pw: DEMO_PASSWORD,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 503 || response.status === 502) {
        throw new Error("Demo server is temporarily unavailable. Please try again in a few moments.");
      } else if (response.status >= 500) {
        throw new Error("Demo server is experiencing technical difficulties. Please try again later.");
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Demo credentials are invalid. The demo server may have been reset.");
      } else {
        throw new Error(`Unable to connect to demo server (error ${response.status}). Please try again.`);
      }
    }

    // Validate response is JSON before parsing
    let data;
    try {
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        throw new Error("Demo server returned invalid response format. The server may be down or experiencing issues.");
      }
      data = await response.json();
    } catch (jsonError) {
      if (jsonError instanceof Error && jsonError.message.includes("Demo server returned invalid")) {
        throw jsonError;
      }
      throw new Error("Demo server returned invalid data. Please try again later.");
    }

    if (!data.AccessToken || !data.User?.Id) {
      throw new Error("Invalid demo server response: missing credentials");
    }

    logger.info("Demo credentials fetched successfully", {
      service: "JellyfinAPI",
      userId: data.User.Id,
      demoServer: demoServerUrl,
    });

    return {
      apiKey: data.AccessToken,
      userId: data.User.Id,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Demo server connection timed out. Please check your internet connection.");
    }
    throw error;
  }
}

/**
 * Connect to demo server
 * Fetches fresh credentials and stores them in SecureStore
 * @param clearCaches - Whether to clear library/folder caches (default: true). Set to false when refreshing credentials mid-session.
 */
export async function connectToDemoServer(clearCaches: boolean = true): Promise<void> {
  let demoServerUrl: string | null = null;
  let apiKey: string | null = null;
  let userId: string | null = null;

  try {
    logger.info("Attempting to connect to demo server", {
      service: "JellyfinAPI",
      serverUrl: DEMO_SERVER_STABLE,
    });

    // Fetch fresh credentials from demo server with retry logic
    const credentials = await retryWithBackoff(() => fetchDemoCredentials(DEMO_SERVER_STABLE), {
      maxAttempts: 2, // Lighter retry (2 attempts vs 3 for library)
      initialDelayMs: 1000, // 1s between retries
    });

    demoServerUrl = DEMO_SERVER_STABLE;
    apiKey = credentials.apiKey;
    userId = credentials.userId;

    logger.info("Successfully fetched credentials from demo server", {
      service: "JellyfinAPI",
      serverUrl: DEMO_SERVER_STABLE,
    });
  } catch (error) {
    logger.error("Failed to connect to demo server", {
      service: "JellyfinAPI",
      serverUrl: DEMO_SERVER_STABLE,
      error: error instanceof Error ? error.message : "unknown",
    });

    const baseMessage = "Unable to connect to demo server. It may be temporarily down. " + "Please try again later or configure your own Jellyfin server in Settings.";

    // If we have a specific error from the server, throw that
    // Otherwise throw the generic helpful message
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(baseMessage);
  }

  try {
    // Write credentials first (atomic - all 3 must succeed: server URL, API key, user ID)
    await Promise.all([
      SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, demoServerUrl),
      SecureStore.setItemAsync(STORAGE_KEYS.API_KEY, apiKey),
      SecureStore.setItemAsync(STORAGE_KEYS.USER_ID, userId),
    ]);

    // Verify all 3 were written successfully
    const [verifyUrl, verifyKey, verifyUserId] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
      SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
      SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
    ]);

    if (verifyUrl !== demoServerUrl || verifyKey !== apiKey || verifyUserId !== userId) {
      // Rollback if any write failed
      await Promise.all([
        SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_URL).catch(() => {}),
        SecureStore.deleteItemAsync(STORAGE_KEYS.API_KEY).catch(() => {}),
        SecureStore.deleteItemAsync(STORAGE_KEYS.USER_ID).catch(() => {}),
      ]);
      throw new Error("Failed to save demo credentials. Please try again.");
    }

    // Refresh config cache with new credentials
    await refreshConfig();

    // Validate credentials by making a lightweight API call BEFORE marking demo mode active
    const deviceId = await getOrCreateDeviceId();
    try {
      await retryWithBackoff(
        async () => {
          const url = `${demoServerUrl}/Users/${userId}/Views`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.SHORT);

          try {
            const response = await fetch(url, {
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(deviceId, apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error("Invalid credentials");
            }

            return response;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 1 }, // No retry for validation
      );
    } catch {
      // Rollback - clear everything if validation fails
      await Promise.all([
        SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_URL).catch(() => {}),
        SecureStore.deleteItemAsync(STORAGE_KEYS.API_KEY).catch(() => {}),
        SecureStore.deleteItemAsync(STORAGE_KEYS.USER_ID).catch(() => {}),
      ]);

      // CRITICAL: Refresh config cache after rollback to clear demo credentials
      await refreshConfig();

      throw new Error("Demo credentials are invalid. The demo server may be experiencing issues.");
    }

    // Only mark demo mode active AFTER validation succeeds
    await SecureStore.setItemAsync(STORAGE_KEYS.IS_DEMO_MODE, "true");

    // Fetch and store server name (non-blocking)
    try {
      const infoResponse = await fetch(`${demoServerUrl}/System/Info/Public`, {
        headers: { Accept: "application/json" },
      });
      if (infoResponse.ok) {
        const serverInfo = await infoResponse.json();
        if (serverInfo.ServerName) {
          await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_NAME, serverInfo.ServerName);
        }
      }
    } catch {
      // Non-critical — URL fallback will be used
    }

    // Clear manager caches to prevent stale data (defensive - don't fail on cache clear errors)
    // Skip cache clearing when refreshing credentials mid-session to preserve UI state
    if (clearCaches) {
      await clearContentCaches("after demo connect");
    } else {
      logger.debug("Skipping cache clear (preserving UI state)", {
        service: "JellyfinAPI",
      });
    }

    setSavedConnectionStatus("connected");

    logger.info("Connected to demo server", {
      service: "JellyfinAPI",
      server: demoServerUrl,
    });

    notifyAuthChange();
  } catch (error) {
    logger.error("Failed to connect to demo server", error, {
      service: "JellyfinAPI",
    });

    // Don't double-wrap error messages that already contain user-friendly text
    if (error instanceof Error && (error.message.includes("Demo server") || error.message.includes("Failed to save") || error.message.includes("Invalid credentials"))) {
      throw error;
    }

    // Wrap other errors with context
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Unable to connect to demo server: ${errorMessage}`);
  }
}

/**
 * Check if demo mode is active
 * Returns true if the app is connected to the demo server
 */
export async function isDemoMode(): Promise<boolean> {
  try {
    const flag = await SecureStore.getItemAsync(STORAGE_KEYS.IS_DEMO_MODE);
    return flag === "true";
  } catch (error) {
    logger.error("Error checking demo mode", error, {
      service: "JellyfinAPI",
    });
    return false;
  }
}

/**
 * Disconnect from demo server
 * Clears all credentials and returns to unconfigured state
 */
export async function disconnectFromDemo(): Promise<void> {
  try {
    // Clear all credentials and demo flag
    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_URL),
      SecureStore.deleteItemAsync(STORAGE_KEYS.API_KEY),
      SecureStore.deleteItemAsync(STORAGE_KEYS.USER_ID),
      SecureStore.deleteItemAsync(STORAGE_KEYS.IS_DEMO_MODE),
    ]);

    // Refresh config to reset to defaults
    await refreshConfig();
    setSavedConnectionStatus("none");

    // Clear manager caches (stale server content). Resume history is server-side.
    await clearContentCaches("after demo disconnect");

    logger.info("Disconnected from demo server", {
      service: "JellyfinAPI",
    });
  } catch (error) {
    logger.error("Error disconnecting from demo", error, {
      service: "JellyfinAPI",
    });
    throw new Error("Failed to disconnect from demo server");
  }
}

// ============================================================
// Authentication API Functions
// ============================================================

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
 * Get or create a persistent device ID for this installation.
 * Stored in SecureStore so it survives app restarts but not reinstalls.
 */
async function getOrCreateDeviceId(): Promise<string> {
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
 * Stable cache-key fragment for a LibraryFilters selection. Read functions cache their mapped
 * result keyed by folder + this fragment so a filtered listing never collides with the unfiltered
 * one (or with a differently-filtered one). Ordering is normalized so equivalent selections match.
 */
function filtersCacheKey(filters?: LibraryFilters): string {
  if (!filters) return "none";
  const parts = [
    filters.favorite ? "fav" : "",
    filters.played ? "played" : "",
    filters.unplayed ? "unplayed" : "",
    filters.shuffle ? "shuffle" : "",
    filters.genres.length ? `g=${[...filters.genres].sort().join("|")}` : "",
    filters.artistIds.length ? `a=${[...filters.artistIds].sort().join(",")}` : "",
    filters.years.length ? `y=${[...filters.years].sort((a, b) => a - b).join(",")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("&") : "none";
}

/**
 * Evict cached reads whose contents change when an item's played / resume position changes:
 * the Continue Watching list, the recently-played anchors the row derives next-up from, and
 * that item's own detail (which carries UserData resume ticks).
 */
function invalidateResumeAndItem(userId: string, itemId: string): void {
  if (!userId) return;
  invalidateByPrefix(`resume:${userId}:`);
  invalidateByPrefix(`recentPlayed:${userId}:`);
  invalidateByPrefix(`details:${userId}:${itemId}`);
  notifyResumeChange();
}

/**
 * Evict cached reads whose contents change when an item's favorite state changes: that item's
 * detail, plus every browse and play-queue set (favorite-filtered listings add/drop the item).
 * Hearts on the unfiltered browse repaint from favoritesCache, so those need no refetch.
 */
function invalidateFavoriteReads(userId: string, itemId: string): void {
  if (!userId) return;
  invalidateByPrefix(`details:${userId}:${itemId}`);
  invalidateByPrefix(`folder:${userId}:`);
  invalidateByPrefix(`filtered:${userId}:`);
}

/**
 * Evict cached reads whose contents change when an item's played state changes: the
 * Continue Watching list (a played item leaves it), that item's detail (stale UserData),
 * and every played/unplayed-filtered listing. No `folder:` eviction — unfiltered
 * membership doesn't change, and the played override map repaints checkmarks on cached data.
 */
function invalidatePlayedReads(userId: string, itemId: string): void {
  if (!userId) return;
  invalidateByPrefix(`resume:${userId}:`);
  invalidateByPrefix(`recentPlayed:${userId}:`);
  notifyResumeChange();
  invalidateByPrefix(`details:${userId}:${itemId}`);
  invalidateByPrefix(`filtered:${userId}:`);
  // The authoritative played set backing the library-root browse (fetchViewRootFiltered).
  invalidateByPrefix(`playedIds:${userId}`);
}

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
 * Resolve a user-entered server address to a working Jellyfin base URL.
 *
 * Accepts a full URL (used as-is) or a bare IP/hostname (auto-discovers the
 * protocol and port by probing candidates concurrently). Returns the first
 * candidate that responds as a valid Jellyfin server, along with its info.
 */
export async function resolveServerConnection(input: string): Promise<{ url: string; info: JellyfinPublicServerInfo }> {
  const candidates = buildServerUrlCandidates(input);
  if (candidates.length === 0) {
    throw new Error("Please enter a server address.");
  }

  // Single candidate (a full URL): probe directly so its specific error surfaces.
  if (candidates.length === 1) {
    const info = await checkServerInfo(candidates[0]);
    return { url: candidates[0], info };
  }

  // Multiple candidates: race them and take the first that works, so a reachable
  // server connects immediately instead of waiting on the candidates that will
  // time out. A cold Jellyfin can exceed the routine health-check budget on its
  // first request, so the race gets a wider timeout.
  try {
    return await Promise.any(
      candidates.map(async (url) => {
        const info = await checkServerInfo(url, API_TIMEOUTS.RESOLVE);
        return { url, info };
      }),
    );
  } catch (error) {
    // Nothing worked. The rejection is an AggregateError whose `errors` preserves
    // candidate order, so report what was tried and how each attempt failed
    // instead of collapsing every cause into one unactionable sentence. Read
    // `errors` structurally rather than via instanceof, so this can't itself
    // throw if the runtime's Promise.any rejects with something else.
    const aggregate = error as { errors?: unknown };
    const failures: unknown[] = Array.isArray(aggregate?.errors) ? aggregate.errors : [];
    const breakdown = candidates.map((url, index) => `  ${url}  ${describeProbeFailure(failures[index])}`).join("\n");

    throw new Error(
      [
        `Couldn't reach a Jellyfin server at ${input.trim()}.`,
        breakdown,
        "",
        "If Jellyfin uses a different port, paste the full URL (e.g. http://192.168.1.100:8096).",
        "If this is your first connection, allow Local Network access in Settings > General > Privacy & Security.",
      ].join("\n"),
    );
  }
}

/**
 * Mark the saved-connection status. Call after a manual connect/restore (connected)
 * or sign out (none) so the cached launch evaluation stays accurate.
 */
export function setSavedConnectionStatus(status: Exclude<SavedConnectionStatus, "unknown">): void {
  savedConnectionStatus = status;
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
 * Add or update a saved server (deduped by normalized url). New servers default
 * to their connection string as the display name; existing servers keep their
 * (possibly user-renamed) name and just bump lastConnectedAt to sort to front.
 */
export async function upsertSavedServer(url: string, name?: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return;

  const servers = await getSavedServers();
  const existing = servers.find((s) => s.id === normalized);
  if (existing) {
    existing.lastConnectedAt = Date.now();
  } else {
    servers.push({ id: normalized, name: name?.trim() || normalized, url: normalized, lastConnectedAt: Date.now() });
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
  if (savedConnectionStatus !== "unknown" && !force) {
    return savedConnectionStatus;
  }

  const [url, apiKey, userId] = await Promise.all([SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL), SecureStore.getItemAsync(STORAGE_KEYS.API_KEY), SecureStore.getItemAsync(STORAGE_KEYS.USER_ID)]);

  if (!url || !apiKey || !userId) {
    savedConnectionStatus = "none";
    return savedConnectionStatus;
  }

  try {
    const info = await checkServerInfo(url);
    savedConnectionStatus = "connected";
    // Backfill the server's stable Id for installs that logged in before it was stored
    if (info.Id) {
      const storedId = await SecureStore.getItemAsync(STORAGE_KEYS.SERVER_ID);
      if (!storedId) {
        await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_ID, info.Id);
      }
    }
  } catch {
    savedConnectionStatus = "needs_restore";
  }
  return savedConnectionStatus;
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
  await upsertSavedServer(cleanUrl);
  await refreshConfig();
  setSavedConnectionStatus("connected");
  await clearContentCaches("after URL recovery");
  logger.info("Adopted recovered server URL", { service: "JellyfinAPI", url: cleanUrl });
  notifyAuthChange();
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
  return { url: workingUrl, serverName: serverName || workingUrl };
}

/**
 * Check if Quick Connect is enabled on the server.
 */
export async function checkQuickConnectEnabled(serverUrl: string): Promise<boolean> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const url = `${cleanUrl}/QuickConnect/Enabled`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.SHORT);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return false;
    }

    // Jellyfin returns the boolean directly as the response body (e.g. "true" or "false")
    const text = await response.text();
    return text.trim().toLowerCase() === "true";
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Initiate a Quick Connect session. Returns a code to display and a secret for polling.
 */
export async function initiateQuickConnect(serverUrl: string): Promise<QuickConnectResult> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const deviceId = await getOrCreateDeviceId();
  const url = `${cleanUrl}/QuickConnect/Initiate`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: getAuthHeader(deviceId),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Quick Connect initiation failed: ${response.status}`);
    }

    const data: QuickConnectResult = await response.json();

    if (!data.Code || !data.Secret) {
      throw new Error("Invalid Quick Connect response: missing Code or Secret");
    }

    logger.info("Quick Connect initiated", {
      service: "JellyfinAPI",
      code: data.Code,
    });

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Quick Connect request timed out.");
    }
    throw error;
  }
}

/**
 * Poll Quick Connect status. Returns updated result with Authenticated flag.
 */
export async function pollQuickConnect(serverUrl: string, secret: string): Promise<QuickConnectResult> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const url = `${cleanUrl}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.SHORT);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Quick Connect poll failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Quick Connect poll timed out.");
    }
    throw error;
  }
}

/**
 * Authenticate with a Quick Connect secret after user approves.
 * Returns an access token and user info.
 */
export async function authenticateWithQuickConnect(serverUrl: string, secret: string): Promise<JellyfinAuthResult> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const deviceId = await getOrCreateDeviceId();
  const url = `${cleanUrl}/Users/AuthenticateWithQuickConnect`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: getAuthHeader(deviceId),
      },
      body: JSON.stringify({ Secret: secret }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Quick Connect authentication failed: ${response.status}`);
    }

    const data: JellyfinAuthResult = await response.json();

    if (!data.AccessToken || !data.User?.Id) {
      throw new Error("Invalid auth response: missing AccessToken or User");
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Authentication request timed out.");
    }
    throw error;
  }
}

/**
 * Authenticate with username and password.
 * Returns an access token and user info.
 */
export async function authenticateByName(serverUrl: string, username: string, password: string): Promise<JellyfinAuthResult> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const deviceId = await getOrCreateDeviceId();
  const url = `${cleanUrl}/Users/AuthenticateByName`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: getAuthHeader(deviceId),
      },
      body: JSON.stringify({ Username: username, Pw: password }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new Error("Invalid username or password.");
    }

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const data: JellyfinAuthResult = await response.json();

    if (!data.AccessToken || !data.User?.Id) {
      throw new Error("Invalid auth response: missing AccessToken or User");
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Authentication request timed out.");
    }
    throw error;
  }
}

/**
 * Clear every content cache that holds data from the current server. Called on
 * any credential or server-URL change so nothing stale survives the switch.
 */
async function clearContentCaches(context: string): Promise<void> {
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
}

/**
 * Save auth credentials atomically and refresh the config cache.
 * Works for both Quick Connect and Username/Password auth results.
 * `serverId` is the server's stable system Id (from /System/Info/Public); it lets
 * LAN-change recovery match this server again after its IP changes.
 */
export async function saveAuthResult(
  serverUrl: string,
  accessToken: string,
  userId: string,
  userName: string,
  serverName: string,
  method: "quickconnect" | "password" | "apikey",
  serverId?: string,
): Promise<void> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");

  // Save all credential keys atomically
  await Promise.all([
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, cleanUrl),
    SecureStore.setItemAsync(STORAGE_KEYS.API_KEY, accessToken),
    SecureStore.setItemAsync(STORAGE_KEYS.USER_ID, userId),
    SecureStore.setItemAsync(STORAGE_KEYS.USER_NAME, userName),
    SecureStore.setItemAsync(STORAGE_KEYS.AUTH_METHOD, method),
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_NAME, serverName),
    // A stale Id from a previous server must never survive into this login
    serverId ? SecureStore.setItemAsync(STORAGE_KEYS.SERVER_ID, serverId) : SecureStore.deleteItemAsync(STORAGE_KEYS.SERVER_ID).catch(() => {}),
    // Clear demo mode flag when signing in with real credentials
    SecureStore.deleteItemAsync(STORAGE_KEYS.IS_DEMO_MODE).catch(() => {}),
  ]);

  // Persist this server as a saved destination (no credentials stored).
  // New servers default to their connection string as the title; user renames persist.
  await upsertSavedServer(cleanUrl);

  // Refresh config cache so all API calls pick up the new credentials
  await refreshConfig();
  setSavedConnectionStatus("connected");

  // Clear manager caches to prevent stale data from old server
  await clearContentCaches("after auth");

  logger.info("Auth credentials saved", {
    service: "JellyfinAPI",
    serverUrl: cleanUrl,
    userName,
    method,
  });

  notifyAuthChange();
}

/**
 * Sign out: clear all credential keys and reset config.
 */
export async function signOut(): Promise<void> {
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
 * Read the stored username (for display in connected state).
 */
export async function getStoredUserName(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.USER_NAME);
}

/**
 * Read the stored auth method (for display in connected state).
 */
export async function getStoredAuthMethod(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.AUTH_METHOD);
}

/**
 * Read the stored server name (for display in connected state).
 */
export async function getStoredServerName(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.SERVER_NAME);
}

/**
 * Get video quality settings from SecureStore
 * Returns quality preset index or default (Original)
 */
async function getQualitySettings(): Promise<QualityPreset & { index: number }> {
  try {
    const savedQuality = await SecureStore.getItemAsync(STORAGE_KEYS.VIDEO_QUALITY);
    const qualityIndex = savedQuality ? parseInt(savedQuality, 10) : DEFAULT_QUALITY;

    // Validate index is within bounds
    const validIndex = qualityIndex >= 0 && qualityIndex < QUALITY_PRESETS.length ? qualityIndex : DEFAULT_QUALITY;
    return { index: validIndex, ...QUALITY_PRESETS[validIndex] };
  } catch (error) {
    logger.error("Error reading quality settings", error);
    return { index: DEFAULT_QUALITY, ...QUALITY_PRESETS[DEFAULT_QUALITY] };
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

/**
 * Fetch primary library/view name from Jellyfin
 * Returns the first Movie/Video library name found
 */
export async function fetchLibraryName(): Promise<string> {
  try {
    const config = await getConfig();

    if (!config.server || !config.apiKey || !config.userId) {
      return "LIBRARY";
    }

    return await retryWithBackoff(
      async () => {
        const url = `${config.server}/Users/${config.userId}/Views`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: getAuthHeader(config.deviceId, config.apiKey),
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            logger.warn("Failed to fetch library name", {
              service: "JellyfinAPI",
              status: response.status,
            });
            return "LIBRARY";
          }

          const data = (await response.json()) as JellyfinFolderResponse;

          // Debug: log the response
          logger.debug("Jellyfin Views response", {
            service: "JellyfinAPI",
            itemsCount: data.Items?.length || 0,
            items: data.Items?.map((item) => ({
              name: item.Name,
              collectionType: item.CollectionType,
            })),
          });

          // Find first Movie or mixed collection, or just any library with content
          let library = data.Items?.find((item) => item.CollectionType === "movies" || item.CollectionType === "mixed");

          // If no movie/mixed library, just use the first one
          if (!library && data.Items && data.Items.length > 0) {
            library = data.Items[0];
            logger.debug("Using first available library", {
              service: "JellyfinAPI",
              name: library.Name,
              collectionType: library.CollectionType,
            });
          }

          if (library) {
            logger.debug("Found library", {
              service: "JellyfinAPI",
              name: library.Name,
              collectionType: library.CollectionType,
            });
          } else {
            logger.warn("No libraries found", {
              service: "JellyfinAPI",
            });
          }

          return library?.Name || "LIBRARY";
        } catch (error) {
          clearTimeout(timeoutId);
          logger.warn("Error fetching library name", error, {
            service: "JellyfinAPI",
          });
          return "LIBRARY";
        }
      },
      { maxAttempts: 2 },
    );
  } catch (error) {
    logger.warn("Error fetching library name", error, {
      service: "JellyfinAPI",
    });
    return "LIBRARY";
  }
}

/**
 * Fetch library videos with pagination support
 * Use this for incremental loading with infinite scroll
 */
export async function fetchLibraryVideos({ limit = 60, startIndex = 0 }: { limit?: number; startIndex?: number } = {}): Promise<{ items: JellyfinVideoItem[]; total?: number }> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    logger.error("Jellyfin server not configured", {
      service: "JellyfinAPI",
      hasServer: !!config.server,
      hasApiKey: !!config.apiKey,
      hasUserId: !!config.userId,
      server: config.server || "not set",
    });
    throw new Error("Jellyfin server not configured. Please go to Settings and configure your server connection.");
  }

  logger.debug("Fetching library videos", {
    service: "JellyfinAPI",
    server: config.server,
    limit,
    startIndex,
  });

  return retryWithBackoff(
    async () =>
      requestLibraryItems(config, {
        startIndex,
        limit,
        timeoutMs: 30000,
      }),
    { maxAttempts: 3 },
  );
}

/**
 * Parse year(s) from search query
 * Supports patterns like:
 * - Full years: "2023", "action 2023", "(2020)"
 * - Year ranges: "2019-2023"
 * - Decades: "90s", "1990s", "80s"
 * - Partial years: "199" → 1990-1999, "20" → 2000-2009
 * Returns the remaining search term and extracted years
 */
function parseYearsFromQuery(query: string): { term: string; years: number[] } {
  const years: number[] = [];
  let term = query;

  // Pattern 1: Year range like "2019-2023" or "2019 - 2023"
  const rangeMatch = term.match(/\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/);
  if (rangeMatch) {
    const [fullMatch] = rangeMatch;
    const [startYear, endYear] = fullMatch.split(/\s*-\s*/).map(Number);
    if (startYear <= endYear && endYear - startYear <= 10) {
      for (let y = startYear; y <= endYear; y++) {
        years.push(y);
      }
      term = term.replace(fullMatch, "").trim();
    }
  }

  // Pattern 2: Year in parentheses like "(2023)"
  const parenMatch = term.match(/\((\d{4})\)/);
  if (parenMatch && years.length === 0) {
    const year = parseInt(parenMatch[1], 10);
    if (year >= 1900 && year <= 2100) {
      years.push(year);
      term = term.replace(parenMatch[0], "").trim();
    }
  }

  // Pattern 3: Decade shorthand like "90s", "1990s", "80s"
  const decadeMatch = term.match(/\b(19)?(\d)0s\b/i);
  if (decadeMatch && years.length === 0) {
    const century = decadeMatch[1] ? 1900 : 2000;
    const decade = parseInt(decadeMatch[2], 10) * 10;
    // For "90s" without prefix, assume 1990s if >= 30, else 2000s
    const baseYear = decadeMatch[1] ? century + decade : decade >= 30 ? 1900 + decade : 2000 + decade;
    for (let y = baseYear; y < baseYear + 10; y++) {
      years.push(y);
    }
    term = term.replace(decadeMatch[0], "").trim();
  }

  // Pattern 4: Standalone year at end like "action 2023"
  const endYearMatch = term.match(/\s+(19|20)\d{2}$/);
  if (endYearMatch && years.length === 0) {
    const year = parseInt(endYearMatch[0].trim(), 10);
    if (year >= 1900 && year <= 2100) {
      years.push(year);
      term = term.replace(endYearMatch[0], "").trim();
    }
  }

  // Pattern 5: Just a full 4-digit year by itself like "2023"
  if (years.length === 0 && /^(19|20)\d{2}$/.test(term.trim())) {
    years.push(parseInt(term.trim(), 10));
    term = "";
  }

  // Pattern 6: 3-digit partial year like "199" → 1990-1999, "202" → 2020-2029
  if (years.length === 0 && /^(19|20)\d$/.test(term.trim())) {
    const partial = term.trim();
    const baseYear = parseInt(partial + "0", 10);
    for (let y = baseYear; y < baseYear + 10; y++) {
      years.push(y);
    }
    term = "";
  }

  // Pattern 7: 2-digit century prefix like "19" → 1900-1999, "20" → 2000-2099
  if (years.length === 0 && /^(19|20)$/.test(term.trim())) {
    const century = parseInt(term.trim(), 10) * 100;
    // Limit to reasonable range to avoid too many years
    const currentYear = new Date().getFullYear();
    const endYear = Math.min(century + 99, currentYear + 5);
    for (let y = century; y <= endYear; y++) {
      years.push(y);
    }
    term = "";
  }

  return { term: term.trim(), years };
}

/**
 * Fetch episodes from a Series
 * Returns empty array on failure (with logging) to allow partial results
 */
async function fetchSeriesEpisodes(config: JellyfinConfig, seriesId: string, seriesName: string | undefined, limit: number = 50): Promise<JellyfinVideoItem[]> {
  const query = new URLSearchParams({
    ParentId: seriesId,
    Recursive: "true",
    IncludeItemTypes: "Episode",
    Fields: "Path,MediaStreams,Genres,ProductionYear,SeriesName",
    Limit: String(limit),
    SortBy: "SortName",
    SortOrder: "Ascending",
  });

  const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn("Failed to fetch series episodes", {
        service: "JellyfinAPI",
        seriesId,
        seriesName: seriesName || "unknown",
        status: response.status,
      });
      return [];
    }

    const data: JellyfinVideosResponse = await response.json();
    return data.Items || [];
  } catch (error) {
    clearTimeout(timeoutId);
    logger.warn("Error fetching series episodes", {
      service: "JellyfinAPI",
      seriesId,
      seriesName: seriesName || "unknown",
      error: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}

/**
 * Remote search for videos using Jellyfin's SearchTerm filter
 * Supports searching by:
 * - Title/name (default)
 * - Path/folder name (via SearchTerm)
 * - Year: "action 2023", "(2020)", "2019-2023"
 * - Series name (automatically expands to episodes)
 */
export async function searchVideos(searchTerm: string, { limit = 60, startIndex = 0 }: { limit?: number; startIndex?: number } = {}): Promise<{ items: JellyfinVideoItem[]; total?: number }> {
  const trimmed = searchTerm.trim();
  if (!trimmed) {
    return { items: [], total: 0 };
  }

  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured. Update settings before searching.");
  }

  // Parse year from search query
  const { term, years } = parseYearsFromQuery(trimmed);

  logger.debug("Search query parsed", {
    service: "JellyfinAPI",
    originalQuery: trimmed,
    parsedTerm: term || "(empty)",
    parsedYears: years.length > 0 ? `${years[0]}${years.length > 1 ? `-${years[years.length - 1]}` : ""}` : "(none)",
    yearCount: years.length,
  });

  const cacheKey = `search:${config.userId}:${term}:${years.join(",")}:${startIndex}:${limit}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          // First search: playable items + Series (to expand into episodes)
          const result = await requestLibraryItems(config, {
            startIndex,
            limit,
            searchTerm: term || undefined,
            years: years.length > 0 ? years : undefined,
            includeAllTypes: true,
            includeSeries: true, // Also search for Series to expand
            timeoutMs: 15000,
          });

          // Separate playable items from Series
          const playableItems: JellyfinVideoItem[] = [];
          const seriesItems: JellyfinVideoItem[] = [];

          for (const item of result.items) {
            if (item.Type === "Series") {
              seriesItems.push(item);
            } else {
              playableItems.push(item);
            }
          }

          // If we found Series, fetch their episodes
          if (seriesItems.length > 0) {
            logger.debug("Expanding series to episodes", {
              service: "JellyfinAPI",
              seriesCount: seriesItems.length,
              seriesNames: seriesItems.map((s) => s.Name).join(", "),
            });

            // Pass series name for better error logging
            const episodePromises = seriesItems.map((series) => fetchSeriesEpisodes(config, series.Id, series.Name, 20));
            const episodeResults = await Promise.all(episodePromises);

            for (const episodes of episodeResults) {
              playableItems.push(...episodes);
            }
          }

          // Deduplicate: episodes may appear in both direct results and series expansion
          const seen = new Set<string>();
          const uniqueItems = playableItems.filter((item) => {
            if (seen.has(item.Id)) return false;
            seen.add(item.Id);
            return true;
          });

          // Preserve original server total for proper pagination
          // Only use uniqueItems.length if server didn't provide total
          return {
            items: uniqueItems,
            total: result.total ?? uniqueItems.length,
          };
        },
        { maxAttempts: 3 },
      ),
    CACHE.SEARCH_TTL_MS,
  );
}

/**
 * Jellyfin BaseItemKind allowlists.
 *
 * /Items queries treat IncludeItemTypes as a strict allowlist: any kind not named is
 * silently dropped by the server, which is how Music Videos libraries rendered empty
 * (issue #46). Every supported kind must appear in exactly one of these lists.
 *
 * Deliberately unsupported kinds: Book (needs a reader), live TV kinds and plugin
 * Channels (separate endpoints and features), and metadata kinds (Genre, Person,
 * Studio, Year, internal folders) which never appear as folder children.
 */
const FOLDER_ITEM_TYPES = ["Folder", "CollectionFolder", "UserView", "Series", "Season", "BoxSet", "MusicAlbum", "MusicArtist", "PhotoAlbum", "Playlist"] as const;
// Streamable through the player; AudioBook rides the existing Audio path
const PLAYABLE_ITEM_TYPES = ["Movie", "Video", "Episode", "Audio", "MusicVideo", "Trailer", "AudioBook"] as const;
// Flat library list: standalone videos only, Episode/Audio stay excluded
const STANDALONE_VIDEO_TYPES = ["Movie", "Video", "MusicVideo", "Trailer"] as const;
// Opened in the photo viewer, never queued for playback
const VIEWABLE_ITEM_TYPES = ["Photo"] as const;

const BROWSE_ITEM_TYPES = [...FOLDER_ITEM_TYPES, ...PLAYABLE_ITEM_TYPES, ...VIEWABLE_ITEM_TYPES].join(",");

const FOLDER_TYPE_SET = new Set<string>(FOLDER_ITEM_TYPES);

/**
 * Check if item is a folder type
 */
export function isFolder(item: JellyfinItem): boolean {
  return FOLDER_TYPE_SET.has(item.Type);
}

/**
 * Check if item is a photo (opened in the photo viewer, not the player)
 */
export function isPhoto(item: JellyfinItem): boolean {
  return item.Type === "Photo";
}

/**
 * Recursive leaf-item count for one library root. The server refuses to compute real counts
 * for CollectionFolder/UserView: their ChildCount is a random 1-9 and RecursiveItemCount is
 * never populated. This runs the same query the server's GetRecursiveChildCount uses
 * and reads TotalRecordCount. Returns undefined on any failure so callers render no
 * badge rather than a wrong number.
 *
 * MediaTypes is the only filter Jellyfin 10.11 applies correctly on recursive
 * view-root queries (verified against 10.11.1 per library type):
 * - IsFolder=false is ignored — folders get counted (a folder→folder→video library
 *   reports 3, not 1)
 * - IncludeItemTypes and Filters=IsNotFolder return TotalRecordCount 0 for
 *   music/musicvideos/photos/tvshows libraries
 * Folders have no MediaType, so they're excluded, and unsupported leaf kinds
 * (e.g. Book) are not counted — matching what the app can actually open.
 */
async function fetchViewItemCount(config: JellyfinConfig, viewId: string): Promise<number | undefined> {
  const query = new URLSearchParams({
    ParentId: viewId,
    Recursive: "true",
    MediaTypes: "Video,Audio,Photo",
    Limit: "1",
    EnableImages: "false",
    EnableUserData: "false",
  });

  const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return typeof data.TotalRecordCount === "number" ? data.TotalRecordCount : undefined;
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

/**
 * Fetch user's library views (root libraries)
 * Returns the top-level folders like "Movies", "TV Shows", etc.
 */
export async function fetchUserViews(): Promise<{ items: JellyfinItem[]; total?: number }> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `views:${config.userId}`;
  return cachedRequest(
    cacheKey,
    async () => {
      const result = await retryWithBackoff(
        async () => {
          const url = `${config.server}/Users/${config.userId}/Views`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

          try {
            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throwRequestError(response, `Failed to fetch: ${response.status}`);
            }

            const data = await response.json();
            const items = data.Items || [];
            return {
              items,
              total: items.length,
            };
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 3 },
      );

      // ChildCount on views is garbage (random 1-9 from the server); replace it with a real
      // recursive count per view, fetched in parallel. Single attempt each: a missing count
      // just hides the badge.
      const items: JellyfinItem[] = await Promise.all(
        result.items.map(async (view: JellyfinItem) => ({
          ...view,
          ChildCount: undefined,
          RecursiveItemCount: await fetchViewItemCount(config, view.Id),
        })),
      );

      return { items, total: result.total };
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Append the flattened filter params for an active LibraryFilters selection to a query.
 * Shared by the paginated grid fetch (fetchFolderContents) and the full-set queue fetch
 * (fetchFilteredVideos) so the query shape can never drift between them.
 *
 * All shapes verified against a real Jellyfin 10.11 server (see CLAUDE-lessons-learned):
 * - Recursive flatten of the subtree (Jellyfin web behavior).
 * - Artist filter needs IncludeItemTypes=Audio,MusicVideo; MediaTypes silently drops ArtistIds.
 *   Otherwise MediaTypes=Video,Audio,Photo (IncludeItemTypes zeroes out music/musicvideos/
 *   photos/tvshows view-roots). Folders carry no MediaType, so the flatten excludes them.
 * - Genres is PIPE-delimited; ArtistIds, Years and status Filters are COMMA-delimited.
 * Does NOT set SortBy — the caller controls ordering.
 */
function appendFlattenFilterParams(query: URLSearchParams, filters: LibraryFilters): void {
  query.append("Recursive", "true");

  const byArtist = filters.artistIds.length > 0;
  if (byArtist) {
    query.append("IncludeItemTypes", "Audio,MusicVideo");
  } else {
    query.append("MediaTypes", "Video,Audio,Photo");
  }

  const statusFilters = [filters.favorite && "IsFavorite", filters.played && "IsPlayed", filters.unplayed && "IsUnplayed"].filter(Boolean);
  if (statusFilters.length > 0) {
    query.append("Filters", statusFilters.join(","));
  }
  if (filters.genres.length > 0) {
    query.append("Genres", filters.genres.join("|"));
  }
  if (filters.years.length > 0) {
    query.append("Years", filters.years.join(","));
  }
  if (byArtist) {
    query.append("ArtistIds", filters.artistIds.join(","));
  }
}

/**
 * Fetch the COMPLETE filtered leaf-item set under a folder (all pages), for building a play
 * queue that covers the whole filtered library rather than only the loaded grid pages.
 *
 * Always fetched with a stable SortName order so pagination is consistent (SortBy=Random would
 * reshuffle per request and duplicate/miss items across pages). Shuffle is applied client-side
 * by the caller, giving a fresh random order on every play without a coverage gap.
 */
export async function fetchFilteredVideos(parentId: string, filters: LibraryFilters): Promise<JellyfinVideoItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  // Same view-root hole as the browse (see fetchViewRootFiltered): asking a library root for
  // favorites returns nothing, which handed the player an empty queue and the photo viewer the
  // unfiltered folder. Never shuffled here — the caller owns ordering, per this function's contract.
  if (hasUserDataFilters(filters) && (await isLibraryViewRoot(parentId))) {
    return resolveViewRootMatches(config, parentId, filters, false);
  }

  const cacheKey = `filtered:${config.userId}:${parentId}:${filtersCacheKey(filters)}`;
  return cachedRequest(
    cacheKey,
    async () => {
      const PAGE_SIZE = 500;
      const allItems: JellyfinVideoItem[] = [];
      let startIndex = 0;
      let hasMore = true;

      while (hasMore) {
        const query = new URLSearchParams({
          ParentId: parentId,
          Fields: "Path,MediaStreams,Genres,ProductionYear,ImageTags,PrimaryImageAspectRatio",
          EnableUserData: "true",
          StartIndex: String(startIndex),
          Limit: String(PAGE_SIZE),
          SortBy: "SortName",
          SortOrder: "Ascending",
        });
        appendFlattenFilterParams(query, filters);

        const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.EXTENDED);

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: getAuthHeader(config.deviceId, config.apiKey),
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch filtered videos: ${response.status}`);
          }

          const data: JellyfinVideosResponse = await response.json();
          const items = data.Items || [];
          allItems.push(...items);

          const total = data.TotalRecordCount;
          startIndex += items.length;
          hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Request timed out fetching filtered videos.");
          }
          throw error;
        }
      }

      // Favorite-filtered results are all favorites — seed the favorites cache so the regular
      // (unfiltered) browse can paint hearts from this same fetch without a separate request.
      if (filters.favorite) addFavoriteIds(allItems.map((item) => item.Id));

      logger.info("Fetched full filtered set for queue", { service: "JellyfinAPI", parentId, totalVideos: allItems.length });
      return allItems;
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Collect EVERY item of a paged /Users/{id}/Items query (500 per page) — the shared loop behind
 * the id-set and leaf-list fetchers. `buildQuery` returns the full parameter set for one page;
 * this drives StartIndex/Limit, aborts each page at API_TIMEOUTS.EXTENDED, and THROWS on any
 * failed page so a partial set is never mistaken for a complete one. `label` names the set in
 * error messages ("Failed to fetch <label>: 500" / "Request timed out fetching <label>.").
 */
async function fetchAllItemPages(config: JellyfinConfig, buildQuery: (startIndex: number, limit: number) => URLSearchParams, label: string): Promise<JellyfinItem[]> {
  const PAGE_SIZE = 500;
  const all: JellyfinItem[] = [];
  let startIndex = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${config.server}/Users/${config.userId}/Items?${buildQuery(startIndex, PAGE_SIZE).toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.EXTENDED);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throwRequestError(response, `Failed to fetch ${label}: ${response.status}`);
      }

      const data: JellyfinFolderResponse = await response.json();
      const items = data.Items || [];
      all.push(...items);

      const total = data.TotalRecordCount;
      startIndex += items.length;
      hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out fetching ${label}.`);
      }
      throw error;
    }
  }

  return all;
}

/** The ids-only query shape shared by the favorite/played id-set fetchers. */
function buildIdSetQuery(startIndex: number, limit: number): URLSearchParams {
  return new URLSearchParams({
    Fields: "",
    EnableUserData: "true",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: "SortName",
    SortOrder: "Ascending",
  });
}

/**
 * Load the current user's favorite leaf-item ids and seed the favorites cache. Omit `parentId` for
 * ALL favorites across every library — the authoritative set used to paint hearts. Uses the proven
 * recursive `Filters=IsFavorite` shape (reliable, unlike the non-recursive browse's per-item
 * UserData, which the server leaves stale after a change), ids-only. Not request-cached, so a
 * re-seed always reflects the live server.
 */
export async function fetchFavoriteIds(parentId?: string): Promise<Set<string>> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const items = await fetchAllItemPages(
    config,
    (startIndex, limit) => {
      const query = buildIdSetQuery(startIndex, limit);
      if (parentId) query.append("ParentId", parentId);
      appendFlattenFilterParams(query, { ...EMPTY_FILTERS, favorite: true });
      return query;
    },
    "favorite ids",
  );

  const ids = items.map((item) => item.Id);
  addFavoriteIds(ids);
  return new Set(ids);
}

/**
 * Is this id one of the user's library roots (the CollectionFolder /Users/{id}/Views returns)?
 * Cached with the views themselves, so this costs nothing after the first browse. Failures
 * answer false: the caller then takes the normal server-side path, which is the status quo.
 */
async function isLibraryViewRoot(parentId: string): Promise<boolean> {
  try {
    const views = await fetchUserViews();
    return views.items.some((view) => view.Id === parentId);
  } catch {
    return false;
  }
}

/** Filters the server can answer at a view root — everything except the user-data ones. */
function withoutUserDataFilters(filters: LibraryFilters): LibraryFilters {
  return { ...filters, favorite: false, played: false, unplayed: false };
}

/**
 * Every leaf under a library view root, all pages. No user-data filters: those are applied
 * client-side by the caller, because the server can't answer them here (see fetchViewRootFiltered).
 */
async function fetchViewRootLeaves(config: JellyfinConfig, parentId: string, filters: LibraryFilters): Promise<JellyfinItem[]> {
  const base = withoutUserDataFilters(filters);
  // Shuffle is applied after matching, never in this query — it must not fork the cache key.
  const cacheKey = `viewLeaves:${config.userId}:${parentId}:${filtersCacheKey({ ...base, shuffle: false })}`;
  return cachedRequest(
    cacheKey,
    () =>
      fetchAllItemPages(
        config,
        (startIndex, limit) => {
          const query = new URLSearchParams({
            ParentId: parentId,
            Fields: "Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
            StartIndex: String(startIndex),
            Limit: String(limit),
            SortBy: "SortName",
            SortOrder: "Ascending",
          });
          appendFlattenFilterParams(query, base);
          return query;
        },
        "library leaves",
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * The current user's played leaf-item ids, from the shape that is known to work: recursive,
 * NO ParentId, Filters=IsPlayed. The mirror of fetchFavoriteIds, and used the same way — as the
 * authoritative set the view-root browse intersects against.
 */
async function fetchPlayedIds(config: JellyfinConfig): Promise<Set<string>> {
  const cacheKey = `playedIds:${config.userId}`;
  const ids = await cachedRequest(
    cacheKey,
    async () => {
      const items = await fetchAllItemPages(
        config,
        (startIndex, limit) => {
          const query = buildIdSetQuery(startIndex, limit);
          appendFlattenFilterParams(query, { ...EMPTY_FILTERS, played: true });
          return query;
        },
        "played ids",
      );
      return items.map((item) => item.Id);
    },
    CACHE.DEFAULT_TTL_MS,
  );

  return new Set(ids);
}

/**
 * Filtered browse rooted at a LIBRARY VIEW ROOT, for the filters the server refuses to answer there.
 *
 * Verified against 10.11.1 on a photos library: `ParentId=<view root>&Recursive&MediaTypes=…` returns
 * all 65 leaves but with EMPTY user data (0 of 65 report IsFavorite, though 6 of them are favorites),
 * and adding `Filters=IsFavorite` returns 0 items — while the identical query with NO ParentId returns
 * those 6 favorites. Recursive view-root queries go through Jellyfin's per-collection-type view builder,
 * which drops user data and ignores ItemFilter, so IsFavorite/IsPlayed/IsUnplayed can never match there.
 * Same family as the IncludeItemTypes note on fetchViewItemCount.
 *
 * So: take the membership from the query that works (leaves under the root) and the user state from the
 * query that works (the root-scoped id sets), and intersect. Ordering and paging then happen here, on a
 * complete set, so TotalRecordCount is exact.
 *
 * NOT covered: an artist filter at a view root still rides IncludeItemTypes (appendFlattenFilterParams
 * needs it — MediaTypes silently drops ArtistIds), which is the param that zeroes out here. Unverified
 * and left alone.
 */
async function resolveViewRootMatches(config: JellyfinConfig, parentId: string, filters: LibraryFilters, shuffle: boolean): Promise<JellyfinItem[]> {
  // BOTH sets, whichever filter is on: they decide what matches AND what the cards render, so a
  // favourites-only view still needs the played set to keep checkmarks, and vice versa. Both are
  // cached (the favourites one app-wide, already loaded for the hearts on the unfiltered browse).
  // Every fetch here THROWS on failure: swallowing one would render "No items match" over a
  // transient error, and the caller's error state (with retry) is the honest answer.
  const [leaves, playedIds] = await Promise.all([fetchViewRootLeaves(config, parentId, filters), fetchPlayedIds(config), isFavoritesLoaded() ? Promise.resolve() : fetchFavoriteIds()]);

  const favoriteIds = getFavoriteIds();
  const playedOverrides = getPlayedOverrides();
  const isPlayed = (item: JellyfinItem) => playedOverrides.get(item.Id) ?? playedIds.has(item.Id);

  // Stamp the state we just resolved onto the items. The view root returned them with EMPTY
  // UserData, so without this the grid paints no heart and no checkmark, and the long-press
  // sheet offers "Mark as Favorite" on an item that already IS one (toggling the wrong way).
  // Downstream is untouched: useFolderContents leaves a filtered view's UserData alone.
  let matched = leaves
    .filter((item) => {
      if (filters.favorite && !favoriteIds.has(item.Id)) return false;
      if (filters.played && !isPlayed(item)) return false;
      if (filters.unplayed && isPlayed(item)) return false;
      return true;
    })
    .map((item) => ({ ...item, UserData: { ...item.UserData, IsFavorite: favoriteIds.has(item.Id), Played: isPlayed(item) } }));

  // Shuffle is a sort, and the server-side SortBy=Random this path can't use would reshuffle per
  // page anyway; one shuffle of the complete set gives a stable order for the whole scroll.
  if (shuffle) {
    matched = [...matched];
    for (let i = matched.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [matched[i], matched[j]] = [matched[j], matched[i]];
    }
  }

  logger.debug("View-root filtered set resolved client-side", {
    service: "JellyfinAPI",
    parentId,
    leaves: leaves.length,
    matched: matched.length,
    filters: { favorite: filters.favorite, played: filters.played, unplayed: filters.unplayed },
  });

  return matched;
}

/** True when this selection asks for state the server won't report at a library root. */
function hasUserDataFilters(filters?: LibraryFilters): boolean {
  return !!filters && (filters.favorite || filters.played || filters.unplayed);
}

/** One page of the view-root resolution, with an exact total (the whole set is in hand). */
async function fetchViewRootFiltered(config: JellyfinConfig, parentId: string, filters: LibraryFilters, startIndex: number, limit: number): Promise<{ items: JellyfinItem[]; total?: number }> {
  const matched = await resolveViewRootMatches(config, parentId, filters, filters.shuffle);
  return { items: matched.slice(startIndex, startIndex + limit), total: matched.length };
}

/**
 * Fetch contents of a folder by ParentId
 * Returns direct children only (folders and videos)
 *
 * @param parentId - The folder ID to fetch contents for (null for root views)
 * @param options - Pagination options
 */
export async function fetchFolderContents(
  parentId: string | null,
  { limit = 60, startIndex = 0, filters }: { limit?: number; startIndex?: number; filters?: LibraryFilters } = {},
): Promise<{ items: JellyfinItem[]; total?: number }> {
  // If no parentId, return user views (root level)
  if (!parentId) {
    return fetchUserViews();
  }

  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  // Shuffle is a sort, not a content filter: it must not flip the browse to a recursive flatten on
  // its own (that would flatten a nested library just by randomizing it). Only real content filters
  // trigger the flatten; shuffle only swaps SortBy on whichever path we take.
  const hasContentFilters = !!filters && (filters.favorite || filters.played || filters.unplayed || filters.genres.length > 0 || filters.artistIds.length > 0 || filters.years.length > 0);
  const shuffle = !!filters && filters.shuffle;

  // A library root can't answer user-data filters — it returns items with no user data at all, so
  // Filters=IsFavorite/IsPlayed/IsUnplayed match nothing and the grid reads "No items match the
  // current filters" over a library full of favorites. Resolve those here instead.
  if (filters && hasUserDataFilters(filters) && (await isLibraryViewRoot(parentId))) {
    return fetchViewRootFiltered(config, parentId, filters, startIndex, limit);
  }

  const cacheKey = `folder:${config.userId}:${parentId}:${startIndex}:${limit}:${filtersCacheKey(filters)}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            ParentId: parentId,
            Fields: "Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
            StartIndex: String(startIndex),
            Limit: String(limit),
            SortBy: shuffle ? "Random" : "SortName",
            SortOrder: "Ascending",
          });

          if (hasContentFilters) {
            appendFlattenFilterParams(query, filters!);
          } else {
            // Non-recursive browse keeps the strict kind allowlist (the issue #46 fix).
            query.append("IncludeItemTypes", BROWSE_ITEM_TYPES);
          }

          const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.EXTENDED);

          try {
            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throwRequestError(response, `Failed to fetch folder contents: ${response.status}`);
            }

            const data: JellyfinFolderResponse = await response.json();
            const items = data.Items || [];
            // When the Favorite filter is on, every returned item is a favorite — seed the cache so the
            // regular browse can reuse these ids for hearts without a separate fetch.
            if (filters?.favorite) addFavoriteIds(items.map((item) => item.Id));
            return {
              items,
              total: data.TotalRecordCount,
            };
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 3 },
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Fetch the names for one genre-entity endpoint (/Genres or /MusicGenres) scoped to a library.
 * Plain entity queries — NOT the view-root recursive item queries that Jellyfin 10.11 routes
 * through per-collection-type view builders (see CLAUDE-lessons-learned).
 */
async function fetchGenreNames(config: { server: string; apiKey: string; userId: string; deviceId: string }, endpoint: "/Genres" | "/MusicGenres", parentId: string): Promise<string[]> {
  return retryWithBackoff(
    async () => {
      const query = new URLSearchParams({
        ParentId: parentId,
        UserId: config.userId,
        SortBy: "SortName",
        SortOrder: "Ascending",
      });

      const url = `${config.server}${endpoint}?${query.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throwRequestError(response, `Failed to fetch ${endpoint}: ${response.status}`);
        }

        const data: { Items?: JellyfinNamedItem[] } = await response.json();
        return (data.Items || []).map((item) => item.Name);
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
    { maxAttempts: 3 },
  );
}

/**
 * Fetch the genre names present in a library (or any folder subtree), for the Filters panel.
 * Server-populated, never hardcoded — real libraries have genres like "90s" or "Big Band".
 *
 * Merges /Genres and /MusicGenres: video genres and music genres are separate entities in
 * Jellyfin, and music-typed items (Audio, MusicVideo) index theirs under /MusicGenres.
 */
export async function fetchLibraryGenres(parentId: string): Promise<string[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `genres:${config.userId}:${parentId}`;
  return cachedRequest(
    cacheKey,
    async () => {
      // Merge both entity types; one endpoint failing must not blank the other's results.
      const results = await Promise.allSettled([fetchGenreNames(config, "/Genres", parentId), fetchGenreNames(config, "/MusicGenres", parentId)]);
      results.forEach((result) => {
        if (result.status === "rejected") {
          logger.warn("Genre endpoint failed", result.reason, { service: "JellyfinAPI", parentId });
        }
      });

      const merged = [...new Set(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])))].sort((a, b) => a.localeCompare(b));
      // Empty is a valid state (items without genre tags), not an error — log it so a hidden
      // Genres section is explainable from the console.
      logger.debug("Library genres fetched", { service: "JellyfinAPI", parentId, genreCount: merged.length });
      return merged;
    },
    CACHE.FACET_TTL_MS,
  );
}

/**
 * Fetch the artists present in a library (or any folder subtree), for the Filters panel.
 * Returns empty for libraries without artist-bearing items (movies, shows), which hides
 * the Artists section.
 */
export async function fetchLibraryArtists(parentId: string): Promise<JellyfinNamedItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `artists:${config.userId}:${parentId}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            ParentId: parentId,
            UserId: config.userId,
            SortBy: "SortName",
            SortOrder: "Ascending",
          });

          const url = `${config.server}/Artists?${query.toString()}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

          try {
            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throwRequestError(response, `Failed to fetch artists: ${response.status}`);
            }

            const data: { Items?: JellyfinNamedItem[] } = await response.json();
            const artists = data.Items || [];
            logger.debug("Library artists fetched", { service: "JellyfinAPI", parentId, artistCount: artists.length });
            return artists;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 3 },
      ),
    CACHE.FACET_TTL_MS,
  );
}

/**
 * Fetch the production years present in a library (or any folder subtree), for the Filters panel.
 * Server-populated like genres/artists. /Years is a plain entity endpoint (Name is the year), NOT a
 * view-root recursive item query. Returns descending (newest first) and drops any non-numeric name.
 * Empty for libraries whose items carry no year, which hides the Years section.
 */
export async function fetchLibraryYears(parentId: string): Promise<number[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `years:${config.userId}:${parentId}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            ParentId: parentId,
            UserId: config.userId!,
            SortBy: "SortName",
            SortOrder: "Descending",
          });

          const url = `${config.server}/Years?${query.toString()}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

          try {
            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throwRequestError(response, `Failed to fetch years: ${response.status}`);
            }

            const data: { Items?: JellyfinNamedItem[] } = await response.json();
            const years = (data.Items || [])
              .map((item) => Number(item.Name))
              .filter((year) => Number.isFinite(year))
              .sort((a, b) => b - a);
            logger.debug("Library years fetched", { service: "JellyfinAPI", parentId, yearCount: years.length });
            return years;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 3 },
      ),
    CACHE.FACET_TTL_MS,
  );
}

/**
 * Mark or unmark an item as favorite for the current user.
 * POST adds, DELETE removes (same endpoint). Notifies favorite subscribers on success.
 */
export async function setVideoFavorite(itemId: string, favorite: boolean): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  await retryWithBackoff(
    async () => {
      const url = `${config.server}/Users/${config.userId}/FavoriteItems/${itemId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

      try {
        const response = await fetch(url, {
          method: favorite ? "POST" : "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throwRequestError(response, `Failed to ${favorite ? "mark" : "unmark"} favorite: ${response.status}`);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
    { maxAttempts: 3 },
  );

  // Keep the favorites cache correct, then let subscribers repaint the toggled card in place.
  markFavorite(itemId, favorite);
  notifyFavoriteChange(itemId, favorite);
  invalidateFavoriteReads(config.userId, itemId);
}

/**
 * Mark or unmark an item as played for the current user.
 * POST adds, DELETE removes (same endpoint). Notifies played subscribers on success.
 * NOTE: DELETE also resets PlaybackPositionTicks — Jellyfin has no "unwatch without
 * clearing resume" path, the same trade-off clearResumePosition already makes.
 */
export async function setVideoPlayed(itemId: string, played: boolean): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  await retryWithBackoff(
    async () => {
      const url = `${config.server}/Users/${config.userId}/PlayedItems/${itemId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

      try {
        const response = await fetch(url, {
          method: played ? "POST" : "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throwRequestError(response, `Failed to ${played ? "mark" : "unmark"} played: ${response.status}`);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
    { maxAttempts: 3 },
  );

  // Keep the played overrides correct, then let subscribers repaint the toggled card in place.
  markPlayed(itemId, played);
  notifyPlayedChange(itemId, played);
  invalidatePlayedReads(config.userId, itemId);
}

/**
 * Body shape shared by the three /Sessions/Playing* reports.
 * PlayMethod: "Transcode" for HLS transcoding, "DirectStream" for /stream?Static=true.
 */
export interface PlaybackReportBody {
  ItemId: string;
  MediaSourceId: string;
  PlaySessionId: string;
  PositionTicks: number;
  IsPaused: boolean;
  PlayMethod: "DirectStream" | "Transcode";
  AudioStreamIndex?: number;
  CanSeek: boolean;
}

/**
 * POST a playback report to the server. Fire-and-forget by design: reporting is
 * best-effort telemetry — a failed ping must never break or delay playback, so this
 * never throws and never retries (a retry would duplicate session events server-side).
 * Success responses are 204 No Content.
 */
async function postPlaybackReport(path: "/Sessions/Playing" | "/Sessions/Playing/Progress" | "/Sessions/Playing/Stopped", body: PlaybackReportBody): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey) {
    logger.warn("Cannot report playback: server not configured", { service: "JellyfinAPI", path });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.SHORT);

  try {
    const response = await fetch(`${config.server}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`Playback report failed: ${response.status}`, { service: "JellyfinAPI", path, itemId: body.ItemId });
    } else {
      logger.debug("Playback report sent", {
        service: "JellyfinAPI",
        path,
        itemId: body.ItemId,
        positionSeconds: Math.round(body.PositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND),
        isPaused: body.IsPaused,
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    logger.warn("Playback report error", error, { service: "JellyfinAPI", path, itemId: body.ItemId });
  }
}

/** Report playback started. Registers the session in the server dashboard. */
export async function reportPlaybackStart(body: PlaybackReportBody): Promise<void> {
  await postPlaybackReport("/Sessions/Playing", body);
}

/** Report current position/pause state. The server persists it as the item's resume point. */
export async function reportPlaybackProgress(body: PlaybackReportBody): Promise<void> {
  await postPlaybackReport("/Sessions/Playing/Progress", body);
}

/**
 * Report playback stopped at the final position. The server stores the resume point,
 * auto-marks the item played past its completion threshold, and cleans up any
 * transcode session tied to the PlaySessionId.
 */
export async function reportPlaybackStopped(body: PlaybackReportBody): Promise<void> {
  await postPlaybackReport("/Sessions/Playing/Stopped", body);
  // The server just updated this item's resume point — drop the stale Continue Watching cache.
  // cachedConfig is populated by postPlaybackReport's getConfig() call above.
  invalidateResumeAndItem(cachedConfig.userId, body.ItemId);
}

/**
 * Write item UserData fields verbatim (POST /Users/{userId}/Items/{itemId}/UserData).
 * Unlike the /Sessions/Playing* reports, this path has NO server-side resume gates
 * (verified in Jellyfin 10.11 UserDataManager: DTO values are copied as-is), so it
 * persists resume positions the Sessions pipeline discards — e.g. items shorter than
 * the server's MinResumeDurationSeconds, which it zeroes and mis-marks Played.
 * Never throws; returns false when the write failed so the caller can retry the
 * session-closing persist (a lost final write leaves stale resume state on the server).
 */
export async function updateUserItemData(itemId: string, data: { PlaybackPositionTicks?: number; Played?: boolean }): Promise<boolean> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    logger.warn("Cannot update item user data: server not configured", { service: "JellyfinAPI", itemId });
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.SHORT);

  try {
    const response = await fetch(`${config.server}/Users/${config.userId}/Items/${itemId}/UserData`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`User data update failed: ${response.status}`, { service: "JellyfinAPI", itemId });
      return false;
    }
    invalidateResumeAndItem(config.userId, itemId);
    logger.debug("Resume position persisted", {
      service: "JellyfinAPI",
      itemId,
      positionSeconds: data.PlaybackPositionTicks != null ? Math.round(data.PlaybackPositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND) : undefined,
      played: data.Played,
    });
    return true;
  } catch (error) {
    clearTimeout(timeoutId);
    logger.warn("User data update error", error, { service: "JellyfinAPI", itemId });
    return false;
  }
}

/**
 * Fetch the server-side resume list (items with a saved playback position) for the
 * Continue Watching row. Non-critical display data: never throws. Returns null on
 * failure so callers can tell a transient error from a genuinely empty list.
 */
export async function fetchResumeItems(limit = 20): Promise<JellyfinVideoItem[] | null> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return null;
  }

  const query = new URLSearchParams({
    Limit: String(limit),
    // ParentId is Fields-gated (like in the browse queries) — the CW binge queue
    // builds from SeriesId ?? ParentId, so without it no queue ever forms.
    Fields: "Path,MediaStreams,ImageTags,PrimaryImageAspectRatio,ParentId",
    EnableUserData: "true",
    MediaTypes: "Video,Audio",
  });

  // Cached (short TTL) and invalidated on playback stop / resume clear. The fetcher THROWS on
  // failure so a transient error is never cached as an empty list; the outer catch returns null.
  const cacheKey = `resume:${config.userId}:${limit}`;
  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        // A row-fetch log without this line means the cache served the row.
        logger.debug("Resume fetch hit network", { service: "JellyfinAPI" });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

        try {
          const response = await fetch(`${config.server}/Users/${config.userId}/Items/Resume?${query.toString()}`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: getAuthHeader(config.deviceId, config.apiKey),
            },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch resume items: ${response.status}`);
          }

          const data = await response.json();
          return (data.Items ?? []) as JellyfinVideoItem[];
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      },
      CACHE.RESUME_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to fetch resume items", error, { service: "JellyfinAPI" });
    return null;
  }
}

/**
 * Fetch the most recently FINISHED items, newest first — the anchors the Continue Watching
 * row derives its next-up cards from. The resume list can't answer "what was I bingeing":
 * an item leaves it the moment the server marks it played, taking the whole series/folder
 * off the row. Anchoring on played items instead survives that, and covers the low end too
 * (30s into the next episode is below the server's resume floor, so the finished episode is
 * still the newest anchor).
 *
 * Query shape follows appendFlattenFilterParams (verified against 10.11): MediaTypes, never
 * IncludeItemTypes, which zeroes out music/musicvideos/photos/tvshows view-roots on recursive
 * queries. No ParentId — the anchors can come from any library.
 *
 * Non-critical display data: never throws. Returns null on failure so callers can tell a
 * transient error from a genuinely empty list.
 */
export async function fetchRecentlyPlayed(limit = 12): Promise<JellyfinVideoItem[] | null> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return null;
  }

  const query = new URLSearchParams({
    Limit: String(limit),
    Recursive: "true",
    MediaTypes: "Video,Audio",
    Filters: "IsPlayed",
    SortBy: "DatePlayed",
    SortOrder: "Descending",
    // ParentId is Fields-gated (same as the resume query) and it IS the container key
    // next-up groups by, so without it no anchor can be resolved.
    Fields: "ParentId,ImageTags,PrimaryImageAspectRatio",
    EnableUserData: "true",
  });

  // Same TTL and invalidation as the resume list (invalidateResumeAndItem / invalidatePlayedReads),
  // so one playback stop refreshes both halves of the row. The fetcher THROWS on failure so a
  // transient error is never cached as an empty list; the outer catch returns null.
  const cacheKey = `recentPlayed:${config.userId}:${limit}`;
  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        logger.debug("Recently played fetch hit network", { service: "JellyfinAPI" });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.QUICK);

        try {
          const response = await fetch(`${config.server}/Users/${config.userId}/Items?${query.toString()}`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: getAuthHeader(config.deviceId, config.apiKey),
            },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch recently played items: ${response.status}`);
          }

          const data = await response.json();
          return (data.Items ?? []) as JellyfinVideoItem[];
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      },
      CACHE.RESUME_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to fetch recently played items", error, { service: "JellyfinAPI" });
    return null;
  }
}

/**
 * Clear an item's resume position ("Remove from Continue Watching") by marking it
 * unplayed — DELETE /PlayedItems resets both Played and PlaybackPositionTicks without
 * marking the item watched (which would pollute the Played filter).
 */
export async function clearResumePosition(itemId: string): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

  try {
    const response = await fetch(`${config.server}/Users/${config.userId}/PlayedItems/${itemId}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throwRequestError(response, `Failed to clear resume position: ${response.status}`);
    }

    // Item removed from Continue Watching — drop the stale resume list and item detail.
    invalidateResumeAndItem(config.userId, itemId);
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Fetch contents of a playlist using the playlist-specific endpoint
 * Playlists require a different API endpoint than regular folders
 *
 * @param playlistId - The playlist ID to fetch contents for
 * @param options - Pagination options
 */
export async function fetchPlaylistContents(playlistId: string, { limit = 60, startIndex = 0 }: { limit?: number; startIndex?: number } = {}): Promise<{ items: JellyfinItem[]; total?: number }> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `playlist:${config.userId}:${playlistId}:${startIndex}:${limit}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            userId: config.userId!,
            StartIndex: String(startIndex),
            Limit: String(limit),
            Fields: "Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
          });

          const url = `${config.server}/Playlists/${playlistId}/Items?${query.toString()}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.EXTENDED);

          try {
            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throwRequestError(response, `Failed to fetch playlist contents: ${response.status}`);
            }

            const data: JellyfinFolderResponse = await response.json();
            const items = data.Items || [];

            // Debug logging to diagnose playlist item structure
            logger.debug("Playlist contents fetched", {
              service: "JellyfinAPI",
              playlistId,
              itemCount: items.length,
              firstItemId: items[0]?.Id,
              firstItemName: items[0]?.Name,
              firstItemType: items[0]?.Type,
            });

            return {
              items,
              total: data.TotalRecordCount,
            };
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 3 },
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Fetch full metadata for a set of item IDs in a single request.
 * Used to hydrate the locally-tracked Continue Watching list (which stores only
 * playback position, not titles/posters). Items missing from the response
 * (deleted on the server) are dropped, and the result is re-ordered to match
 * the input `ids` so caller-supplied ordering (e.g. most-recent-first) survives.
 */
export async function fetchItemsByIds(ids: string[]): Promise<JellyfinVideoItem[]> {
  if (ids.length === 0) {
    return [];
  }

  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `items:${config.userId}:${ids.join(",")}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            Ids: ids.join(","),
            Recursive: "true",
            Fields: "Path,MediaStreams,Genres,ProductionYear,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
          });

          const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);

          try {
            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throwRequestError(response, `Failed to fetch items by ids: ${response.status}`);
            }

            const data: JellyfinVideosResponse = await response.json();
            const byId = new Map((data.Items || []).map((item) => [item.Id, item]));

            // Preserve caller order; silently drop ids the server no longer knows.
            return ids.map((id) => byId.get(id)).filter((item): item is JellyfinVideoItem => item !== undefined);
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        { maxAttempts: 3 },
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Get thumbnail URL for a folder
 * Returns empty string if config not yet loaded (prevents broken image requests)
 */
export function getFolderThumbnailUrl(itemId: string, maxHeight: number = 300): string {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    return "";
  }
  return `${cachedConfig.server}/Items/${itemId}/Images/Primary?api_key=${cachedConfig.apiKey}&maxHeight=${maxHeight}&quality=90`;
}

type JellyfinConfig = {
  server: string;
  apiKey: string;
  userId: string;
  deviceId: string;
};

async function requestLibraryItems(
  config: JellyfinConfig,
  {
    startIndex = 0,
    limit = 200,
    searchTerm,
    years,
    includeAllTypes = false,
    includeSeries = false,
    timeoutMs = 30000,
  }: {
    startIndex?: number;
    limit?: number;
    searchTerm?: string;
    years?: number[];
    includeAllTypes?: boolean;
    includeSeries?: boolean;
    timeoutMs?: number;
  },
): Promise<{ items: JellyfinVideoItem[]; total?: number }> {
  // includeAllTypes (search): every playable kind across all libraries.
  // Default (flat library list): standalone videos only.
  // Series: only when includeSeries=true (expanded to episodes by the caller).
  // Photos are excluded from both paths — they only surface via folder browsing.
  // See the BaseItemKind allowlists next to isFolder() for the full picture.
  let itemTypes: string = includeAllTypes ? PLAYABLE_ITEM_TYPES.join(",") : STANDALONE_VIDEO_TYPES.join(",");
  if (includeSeries) {
    itemTypes += ",Series";
  }

  const query = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: itemTypes,
    Fields: "Path,MediaStreams,Genres,ProductionYear,ImageTags,PrimaryImageAspectRatio",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: "DateCreated",
    SortOrder: "Descending",
  });

  if (searchTerm) {
    query.append("SearchTerm", searchTerm);
  }

  if (years && years.length > 0) {
    query.append("Years", years.join(","));
  }

  const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

  logger.debug("Requesting library items", {
    service: "JellyfinAPI",
    url,
    server: config.server,
    userId: config.userId,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error("Failed to fetch videos", {
        service: "JellyfinAPI",
        status: response.status,
        statusText: response.statusText,
        url,
      });
      throwRequestError(response, `Failed to fetch videos: ${response.status} ${response.statusText}`);
    }

    const data: JellyfinVideosResponse = await response.json();
    return {
      items: data.Items || [],
      total: data.TotalRecordCount,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out. Please check your network connection and Jellyfin server.");
    }
    throw error;
  }
}

/**
 * Get video stream URL for a specific item
 * Uses /Videos/{id}/stream?Static=true for proper HTTP range support (seeking)
 * Returns empty string if config not yet loaded
 * @param itemId - The video item ID
 * @param videoItem - Optional video item for extracting MediaSourceId
 */
export function getVideoStreamUrl(itemId: string, videoItem?: JellyfinVideoItem | null): string {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    logger.warn("getVideoStreamUrl called before config loaded", { service: "JellyfinAPI" });
    return "";
  }

  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;
  const url = `${cachedConfig.server}/Videos/${itemId}/stream` + `?Static=true` + `&MediaSourceId=${mediaSourceId}` + `&api_key=${cachedConfig.apiKey}`;

  logger.debug("Generated direct play stream URL", {
    service: "JellyfinAPI",
    server: cachedConfig.server,
    itemId,
    mediaSourceId,
  });

  return url;
}

/**
 * Get HLS transcoding URL with configurable quality
 *
 * Uses master.m3u8 HLS endpoint with stream copy (remux) allowed: when the
 * source video is H.264/HEVC within the preset's caps, the server repackages
 * the original bits into fMP4 HLS segments instead of re-encoding, so an
 * H.264-in-MKV file plays at original quality with near-zero server CPU.
 * Sources the server can't copy (AV1, VP9, over-cap bitrate, burn-in
 * subtitles) fall back to an H.264/AAC encode capped by the quality preset.
 * Subtitles are included as togglable WebVTT tracks using SubtitleMethod=Hls.
 * All subtitle tracks (external .srt and embedded streams) are available via native controls.
 * Quality settings are loaded from user preferences.
 *
 * Segments are fMP4 (SegmentContainer=mp4): Apple's HLS spec requires fMP4
 * for HEVC, and AVPlayer handles it for H.264 equally well.
 *
 * @param itemId - The video item ID
 * @param videoItem - Optional video item with MediaStreams for subtitle detection
 * @param burnInSubtitleIndex - Optional subtitle stream index to burn into the video (SubtitleMethod=Encode, for image-based formats like PGS)
 */
export async function getTranscodingStreamUrl(
  itemId: string,
  videoItem?: JellyfinVideoItem | null,
  audioStreamIndex?: number,
  startTimeTicks?: number,
  burnInSubtitleIndex?: number,
  playSessionId?: string,
): Promise<string> {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    logger.warn("getTranscodingStreamUrl called before config loaded", { service: "JellyfinAPI" });
    throw new Error("Configuration not loaded. Please wait for app to initialize.");
  }

  // Get user's quality preferences
  const quality = await getQualitySettings();

  // Get MediaSourceId from video details if available, fallback to itemId
  // This is important for playlist items where MediaSourceId may differ from item Id
  const mediaSourceId = videoItem?.MediaSources?.[0]?.Id || itemId;

  // Capped presets keep today's compatibility contract (H.264-target encode,
  // stereo AAC) and only stream-copy sources already inside their caps. The
  // uncapped "Original" preset also admits AC3/EAC3 and 5.1 audio, which
  // AVPlayer plays natively in HLS, so surround tracks copy instead of
  // downmixing.
  const capped = quality.width !== undefined;

  // Use HLS master.m3u8 endpoint; the server decides copy vs encode per stream
  let url =
    `${cachedConfig.server}/Videos/${itemId}/master.m3u8?` +
    `api_key=${cachedConfig.apiKey}` +
    `&MediaSourceId=${mediaSourceId}` +
    `&VideoCodec=h264,hevc` +
    `&AudioCodec=${capped ? "aac" : "aac,ac3,eac3"}` +
    `&VideoBitrate=${quality.bitrate}` +
    `&AudioBitrate=${TRANSCODING.AUDIO_BITRATE}` + // 192kbps AAC when audio must encode
    (capped ? `&MaxWidth=${quality.width}` + `&MaxHeight=${quality.height}` + `&VideoLevel=${quality.level}` : ``) +
    `&TranscodingMaxAudioChannels=${capped ? TRANSCODING.MAX_AUDIO_CHANNELS : TRANSCODING.SURROUND_AUDIO_CHANNELS}` +
    `&SegmentContainer=mp4` + // fMP4: required for HEVC in HLS
    `&MinSegments=1` +
    `&SegmentLength=10` + // 10 second segments (was 8)
    `&BreakOnNonKeyFrames=false` + // Force keyframes at segment boundaries
    `&EnableAutoStreamCopy=true` +
    // Burning in subtitles renders them into the frames, which rules out
    // copying the source video stream
    `&AllowVideoStreamCopy=${burnInSubtitleIndex === undefined ? "true" : "false"}`;

  // Burn-in path: image-based subtitles (PGS/DVDSUB) cannot be delivered as WebVTT,
  // so the server renders the selected track into the video frames instead
  if (burnInSubtitleIndex !== undefined) {
    url += `&SubtitleStreamIndex=${burnInSubtitleIndex}` + `&SubtitleMethod=Encode`;

    logger.info("Transcoding with burned-in subtitle", {
      service: "JellyfinAPI",
      itemId,
      mediaSourceId,
      subtitleStreamIndex: burnInSubtitleIndex,
      quality: quality.label,
      bitrate: `${quality.bitrate / 1000000}Mbps`,
      server: cachedConfig.server,
    });
  }

  // Check for subtitles (both external and embedded) and include them as HLS tracks
  // Skipped when burning in: SubtitleMethod is single-valued and already set to Encode
  if (videoItem && videoItem.MediaStreams) {
    // Include ALL subtitle tracks (external .srt files AND embedded subtitles)
    // Previously only included IsExternal=true, which missed embedded subtitle streams
    const subtitleStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined);

    if (burnInSubtitleIndex !== undefined) {
      // Burn-in already configured above; no WebVTT tracks in this session
    } else if (subtitleStreams.length > 0) {
      // Use SubtitleMethod=Hls to include all subtitles as separate WebVTT streams
      // DO NOT set SubtitleStreamIndex - this includes ALL subtitle tracks
      url += `&SubtitleMethod=Hls`;

      const externalCount = subtitleStreams.filter((s) => s.IsExternal).length;
      const embeddedCount = subtitleStreams.length - externalCount;

      logger.info("Transcoding with HLS subtitle tracks", {
        service: "JellyfinAPI",
        itemId,
        mediaSourceId,
        subtitleCount: subtitleStreams.length,
        externalSubtitles: externalCount,
        embeddedSubtitles: embeddedCount,
        languages: subtitleStreams.map((s) => s.Language || "und").join(", "),
        quality: quality.label,
        bitrate: `${quality.bitrate / 1000000}Mbps`,
        server: cachedConfig.server,
      });
    } else {
      logger.info("Transcoding without subtitles", {
        service: "JellyfinAPI",
        itemId,
        mediaSourceId,
        quality: quality.label,
        bitrate: `${quality.bitrate / 1000000}Mbps`,
        server: cachedConfig.server,
      });
    }

    // Include ALL audio tracks in HLS manifest
    const audioStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio" && stream.Index !== undefined);

    if (audioStreams.length > 1) {
      logger.info("Multiple audio tracks available", {
        service: "JellyfinAPI",
        itemId,
        audioTrackCount: audioStreams.length,
        languages: audioStreams.map((s) => s.Language || "und").join(", "),
      });
    }
  }

  // If specific audio track requested, only serve that track
  if (audioStreamIndex !== undefined) {
    url += `&AudioStreamIndex=${audioStreamIndex}`;
    logger.info("Transcoding with specific audio track", {
      service: "JellyfinAPI",
      itemId,
      audioStreamIndex,
    });
  }

  // If resuming from a seek crash, start transcoding from the given position
  if (startTimeTicks !== undefined && startTimeTicks > 0) {
    url += `&StartTimeTicks=${Math.round(startTimeTicks)}`;
    logger.info("Transcoding with StartTimeTicks (seek recovery)", {
      service: "JellyfinAPI",
      itemId,
      startTimeTicks,
      startTimeSeconds: startTimeTicks / JELLYFIN_TIME.TICKS_PER_SECOND,
    });
  }

  // Tie the server's transcode session to the playback reports (Sessions/Playing*)
  // so the server can clean up the HLS session when Stopped is reported
  if (playSessionId) {
    url += `&PlaySessionId=${playSessionId}`;
  }

  logger.debug("Generated transcoding stream URL", {
    service: "JellyfinAPI",
    server: cachedConfig.server,
    itemId,
    urlPreview: url.substring(0, 150) + "...",
  });

  // Log full URL for debugging (helps inspect HLS manifest for multi-audio/subtitle tracks)
  logger.info("Full HLS transcoding URL generated", {
    service: "JellyfinAPI",
    itemId,
    fullUrl: url,
  });

  return url;
}

/**
 * Get poster image URL for a specific item
 * Posters are better for movie/video displays (2:3 aspect ratio)
 * Returns empty string if config not yet loaded (prevents broken image requests)
 */
export function getPosterUrl(itemId: string, maxHeight: number = 450): string {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    return "";
  }
  return `${cachedConfig.server}/Items/${itemId}/Images/Primary?api_key=${cachedConfig.apiKey}&maxHeight=${maxHeight}&quality=90`;
}

/**
 * Get a full-screen image URL for a Photo item (the Primary image IS the photo)
 * Width is capped at 4K so multi-megapixel originals don't stall the Apple TV
 * Returns empty string if config not yet loaded (prevents broken image requests)
 */
export function getPhotoUrl(itemId: string, maxWidth: number = 3840): string {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    return "";
  }
  return `${cachedConfig.server}/Items/${itemId}/Images/Primary?api_key=${cachedConfig.apiKey}&maxWidth=${maxWidth}&quality=90`;
}

/**
 * Get a tiny, server-blurred poster URL for use as an ambient background wash.
 * The image is requested small (48px tall) and upscaled full-screen by the renderer,
 * which is what produces the soft blur, so no client-side blur pass is needed. The optional
 * imageTag only matters for the stable cacheKey the caller builds; it isn't in the URL.
 */
export function getBackdropBlurUrl(itemId: string): string {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    return "";
  }
  return `${cachedConfig.server}/Items/${itemId}/Images/Primary?api_key=${cachedConfig.apiKey}&maxHeight=48&quality=60&blur=20`;
}

/**
 * Check if item has a poster image
 */
export function hasPoster(item: JellyfinVideoItem): boolean {
  return item.ImageTags?.Primary !== undefined;
}

/**
 * Format duration from RunTimeTicks to readable format
 * RunTimeTicks are in 100-nanosecond intervals
 * @param ticks - RunTimeTicks from Jellyfin
 * @returns Formatted string like "1h 23m" or "45m"
 */
export function formatDuration(ticks: number): string {
  const totalSeconds = ticks / JELLYFIN_TIME.TICKS_PER_SECOND;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Fetch detailed video item information including media streams
 */
export async function fetchVideoDetails(itemId: string): Promise<JellyfinVideoItem | null> {
  try {
    const config = await getConfig();

    // Cached per item (invalidated on favorite / playback changes). The retry closure throws on
    // failure, so the outer catch — not the cache — supplies the null fallback.
    const cacheKey = `details:${config.userId}:${itemId}`;
    return await cachedRequest(
      cacheKey,
      () =>
        retryWithBackoff(
          async () => {
            // Use GetPlaybackInfo endpoint for reliable MediaStreams data
            const url = `${config.server}/Items/${itemId}/PlaybackInfo?UserId=${config.userId}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.NORMAL);
            let itemTimeoutId: ReturnType<typeof setTimeout> | undefined;

            try {
              const response = await fetch(url, {
                method: "GET",
                headers: {
                  Accept: "application/json",
                  Authorization: getAuthHeader(config.deviceId, config.apiKey),
                },
                signal: controller.signal,
              });

              clearTimeout(timeoutId);

              if (!response.ok) {
                throwRequestError(response, `Failed to fetch video details: ${response.status} ${response.statusText}`);
              }

              const playbackInfoResponse = await response.json();

              // Extract MediaSources from PlaybackInfoResponse
              const mediaSource = playbackInfoResponse.MediaSources?.[0];

              if (!mediaSource) {
                throw new Error("No media sources available for this video");
              }

              // Construct a JellyfinVideoItem-compatible object from the playback info
              // We still need basic item metadata, so fetch it separately
              // EnableUserData populates UserData.PlaybackPositionTicks for server-side resume
              const itemUrl = `${config.server}/Users/${config.userId}/Items/${itemId}?Fields=Path,Overview&EnableUserData=true`;
              // Own timeout: the first controller's timer was already cleared above, so
              // without this a hung server stalls the player at FETCHING_METADATA forever.
              const itemController = new AbortController();
              itemTimeoutId = setTimeout(() => itemController.abort(), API_TIMEOUTS.NORMAL);
              const itemResponse = await fetch(itemUrl, {
                method: "GET",
                headers: {
                  Accept: "application/json",
                  Authorization: getAuthHeader(config.deviceId, config.apiKey),
                },
                signal: itemController.signal,
              });

              clearTimeout(itemTimeoutId);

              if (!itemResponse.ok) {
                throw new Error(`Failed to fetch item metadata: ${itemResponse.status}`);
              }

              const itemData = await itemResponse.json();

              // Merge item metadata with MediaSources from PlaybackInfo
              const data: JellyfinVideoItem = {
                ...itemData,
                MediaSources: playbackInfoResponse.MediaSources,
                MediaStreams: mediaSource.MediaStreams || [],
              };

              // Debug logging to help diagnose multi-audio track issues
              const audioStreams = mediaSource.MediaStreams?.filter((s: JellyfinMediaStream) => s.Type === "Audio") || [];

              logger.info("Video details fetched via PlaybackInfo endpoint", {
                service: "JellyfinAPI",
                itemId: data.Id,
                name: data.Name,
                type: data.Type,
                hasMediaSources: !!data.MediaSources,
                mediaSourceCount: data.MediaSources?.length || 0,
                mediaSourceId: mediaSource.Id,
                hasMediaStreams: !!mediaSource.MediaStreams,
                mediaStreamCount: mediaSource.MediaStreams?.length || 0,
                audioTrackCount: audioStreams.length,
                audioTracks: audioStreams.map((s: JellyfinMediaStream) => ({
                  index: s.Index,
                  language: s.Language || "und",
                  codec: s.Codec,
                  channels: s.Channels,
                  displayTitle: s.DisplayTitle,
                })),
              });

              return data;
            } catch (error) {
              clearTimeout(timeoutId);
              if (itemTimeoutId !== undefined) clearTimeout(itemTimeoutId);
              if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Request timed out. Please check your network connection.");
              }
              throw error;
            }
          },
          { maxAttempts: 3 },
        ),
      CACHE.DEFAULT_TTL_MS,
    );
  } catch (error) {
    logger.error("Error fetching video details from Jellyfin", error, {
      service: "JellyfinAPI",
    });
    return null;
  }
}

/**
 * Fetch all playable videos recursively under a folder
 * Used by the play queue to build a sequential playlist from a folder hierarchy
 * Fetches in pages of 500 items, sorted by SortName for natural folder order
 *
 * Carries UserData and image fields: the Continue Watching row resolves its next-up card
 * from this same list (services/nextUp.ts), so it needs played/resume state to pick the
 * next unplayed item and image tags to render it as a card.
 *
 * @param parentId - The folder ID to fetch videos recursively from
 * @returns Array of all playable video items under the folder
 */
export async function fetchRecursiveVideos(parentId: string): Promise<JellyfinVideoItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `recursive:${config.userId}:${parentId}`;
  return cachedRequest(
    cacheKey,
    async () => {
      const PAGE_SIZE = 500;
      const allItems: JellyfinVideoItem[] = [];
      let startIndex = 0;
      let hasMore = true;

      while (hasMore) {
        const query = new URLSearchParams({
          ParentId: parentId,
          Recursive: "true",
          // MediaTypes, NOT IncludeItemTypes: the kind allowlist returns zero on a recursive query
          // rooted at a library VIEW ROOT (verified 10.11.1 — "Photos Tomo TV" answered
          // totalVideos:0 while the same subtree holds 60 leaves), which left every library-root
          // press with an empty binge queue. Video,Audio covers exactly PLAYABLE_ITEM_TYPES:
          // folders carry no MediaType and Photos are MediaType Photo, so both stay excluded.
          MediaTypes: "Video,Audio",
          Fields: "Path,MediaStreams,Genres,ProductionYear,ParentId,ImageTags,PrimaryImageAspectRatio",
          EnableUserData: "true",
          StartIndex: String(startIndex),
          Limit: String(PAGE_SIZE),
          SortBy: "SortName",
          SortOrder: "Ascending",
        });

        const url = `${config.server}/Users/${config.userId}/Items?${query.toString()}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.EXTENDED);

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: getAuthHeader(config.deviceId, config.apiKey),
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch recursive videos: ${response.status}`);
          }

          const data: JellyfinVideosResponse = await response.json();
          const items = data.Items || [];
          allItems.push(...items);

          const total = data.TotalRecordCount;
          startIndex += items.length;
          hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Request timed out fetching recursive videos.");
          }
          throw error;
        }
      }

      logger.info("Fetched recursive videos for queue", {
        service: "JellyfinAPI",
        parentId,
        totalVideos: allItems.length,
      });

      return allItems;
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Can AVPlayer decode this video codec natively (direct play / stream copy)?
 * Delegates to the single registry in services/localRemux.ts (REMUXABLE_CODECS):
 * H.264 (h264/avc*) and HEVC (hevc/h265/hvc1/hev1). Everything else returns
 * false and is routed downstream, where the local remux engine transcodes what
 * it can on device (including AV1 behind its hardware probe) and the server
 * handles the rest. Prefix (not substring) matching, per the codec-matching
 * lesson: unrelated codecs that merely contain an entry must not slip through.
 */
export function isCodecSupported(codec: string): boolean {
  const codecLower = codec.toLowerCase();
  return REMUXABLE_CODECS.some((known) => codecLower.startsWith(known));
}

/**
 * Check if item is audio-only (no video stream)
 * Audio-only files should be handled differently or filtered out
 */
export function isAudioOnly(videoItem: JellyfinVideoItem | null): boolean {
  if (!videoItem || !videoItem.MediaStreams) {
    return false;
  }

  // Check if there's a video stream
  const hasVideo = videoItem.MediaStreams.some((stream) => stream.Type === "Video");
  const hasAudio = videoItem.MediaStreams.some((stream) => stream.Type === "Audio");

  // Audio-only: has audio but no video
  return !hasVideo && hasAudio;
}

/**
 * Check if video must go through the HLS endpoint instead of direct play.
 * Returns false when AVPlayer can play the file as-is (H.264/HEVC in MP4/MOV).
 * Returns true otherwise; the HLS endpoint then stream-copies (remuxes)
 * H.264/HEVC out of foreign containers like MKV and only re-encodes what
 * AVPlayer genuinely can't decode (see getTranscodingStreamUrl).
 */
export function needsTranscoding(videoItem: JellyfinVideoItem | null): boolean {
  if (!videoItem || !videoItem.MediaStreams) {
    return false; // Default to direct play if no info available
  }

  // Find the video stream
  const videoStream = videoItem.MediaStreams.find((stream) => stream.Type === "Video");

  if (!videoStream || !videoStream.Codec) {
    return false; // No video stream info, try direct play
  }

  const supported = isCodecSupported(videoStream.Codec);

  // Check container format: AVPlayer only supports MP4/MOV/M4V containers
  const container = videoItem.MediaSources?.[0]?.Container?.toLowerCase();
  const avplayerContainers = ["mp4", "mov", "m4v"];
  // Container is ffprobe's format_name: comma-separated demuxer aliases
  // (e.g., "mov,mp4,m4a,3gp,3g2,mj2" for QuickTime/MP4 family).
  // Check if ANY token matches, consistent with jellyfin-web's includesAny().
  const unsupportedContainer = container ? !container.split(",").some((c) => avplayerContainers.includes(c.trim())) : false;

  logger.debug("Codec/container check result", {
    service: "CodecCheck",
    codec: videoStream.Codec,
    container: container || "unknown",
    codecSupported: supported,
    unsupportedContainer,
  });

  return !supported || unsupportedContainer;
}

/**
 * Check if a subtitle codec is image-based (bitmap subtitles)
 * Image-based formats cannot be converted to WebVTT by Jellyfin, so they are
 * silently dropped from HLS manifests and must be burned into the video instead.
 * Matches the server's MediaStream.IsTextSubtitleStream classification.
 */
export function isImageBasedSubtitleCodec(codec: string | undefined): boolean {
  if (!codec) {
    return false;
  }
  const codecLower = codec.toLowerCase();
  if (codecLower === "sup" || codecLower === "sub") {
    return true; // Raw PGS (.sup) / VobSub (.sub) streams
  }
  return (
    codecLower.includes("pgs") || // pgssub, hdmv_pgs_subtitle (Blu-ray)
    codecLower.includes("dvdsub") ||
    codecLower.includes("dvd_subtitle") || // DVD subtitles (ffprobe name)
    codecLower.includes("vobsub") ||
    codecLower.includes("dvbsub") ||
    codecLower.includes("dvb_subtitle") || // DVB broadcast subtitles
    codecLower.includes("xsub") // DivX subtitles
  );
}

/**
 * Pick the subtitle stream to burn into the video during transcoding
 * Returns a candidate only when the item has subtitle streams and ALL of them
 * are image-based (PGS/DVDSUB). Mixed files keep the SubtitleMethod=Hls path so
 * text tracks stay selectable in the native player controls.
 * Priority: IsDefault > IsForced > first stream.
 */
export function getBurnInSubtitleStream(videoItem: JellyfinVideoItem | null): JellyfinMediaStream | null {
  if (!videoItem || !videoItem.MediaStreams) {
    return null;
  }

  const subtitleStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined);

  if (subtitleStreams.length === 0) {
    return null;
  }

  // AVPlayer on tvOS cannot select HLS text-subtitle renditions (documented limitation — the
  // official Jellyfin Swiftfin client disables subtitle selection in its Native/AVPlayer player
  // for the same reason). So a FORCED text subtitle (meant to always show) is burned in via
  // SubtitleMethod=Encode, like image subs. Non-forced text subs (incl. default full tracks) are
  // NOT burned in — that would force subtitles onto any file with a default track (e.g. a
  // multi-audio file) — they keep the SubtitleMethod=Hls path and stay off unless the user picks.
  const allImageBased = subtitleStreams.every((stream) => isImageBasedSubtitleCodec(stream.Codec));

  const candidate = allImageBased
    ? // Image subs can never render on AVPlayer, so one always burns in.
      subtitleStreams.find((stream) => stream.IsDefault) || subtitleStreams.find((stream) => stream.IsForced) || subtitleStreams[0]
    : // A text track exists: only a forced one burns in.
      subtitleStreams.find((stream) => stream.IsForced) || null;

  if (!candidate) {
    return null;
  }

  logger.info("Selected subtitle for burn-in", {
    service: "Subtitles",
    itemId: videoItem.Id,
    streamIndex: candidate.Index,
    codec: candidate.Codec,
    language: candidate.Language || "und",
    isDefault: candidate.IsDefault || false,
    isForced: candidate.IsForced || false,
    imageBased: isImageBasedSubtitleCodec(candidate.Codec),
    totalSubtitles: subtitleStreams.length,
  });

  return candidate;
}

/**
 * Subtitle track interface for react-native-video
 * These tracks are passed to VideoSource.subtitleTracks
 */
export interface SubtitleTrack {
  uri: string;
  language: string;
  label: string;
  type: "text/vtt" | "text/srt";
}

/**
 * Get all subtitle tracks available for a video
 * Returns external subtitle files in VTT format for react-native-video
 */
export function getSubtitleTracks(videoItem: JellyfinVideoItem | null): SubtitleTrack[] {
  if (!videoItem || !videoItem.MediaStreams) {
    return [];
  }

  // Find all subtitle streams
  const subtitleStreams = videoItem.MediaStreams.filter((stream) => stream.Type === "Subtitle");

  if (subtitleStreams.length === 0) {
    return [];
  }

  const tracks: SubtitleTrack[] = [];

  for (const stream of subtitleStreams) {
    // Only include external subtitle files (not embedded/burned-in)
    // IsExternal indicates the subtitle is in a separate file (like .srt)
    if (stream.IsExternal && stream.Index !== undefined) {
      // Always request VTT format for best compatibility with video players
      // Jellyfin will convert SRT to VTT automatically if needed
      const track: SubtitleTrack = {
        uri: getSubtitleUrl(videoItem.Id, stream.Index, "vtt"),
        language: stream.Language || "und",
        label: stream.DisplayTitle || stream.Language || "Unknown",
        type: "text/vtt", // Always VTT since we request .vtt format
      };
      tracks.push(track);
      logger.debug("Found external subtitle", {
        service: "Subtitles",
        label: track.label,
        language: track.language,
        uri: track.uri,
      });
    }
  }

  return tracks;
}

/**
 * Get subtitle URL for a specific stream index
 * Returns empty string if config not yet loaded
 * @param itemId - The video item ID
 * @param streamIndex - The subtitle stream index from MediaStreams
 * @param format - Subtitle format (default: 'vtt' for best compatibility)
 */
export function getSubtitleUrl(itemId: string, streamIndex: number, format: string = "vtt"): string {
  if (!cachedConfig.server || !cachedConfig.apiKey) {
    return "";
  }
  // Jellyfin subtitle stream endpoint (from SubtitleController.cs)
  // Format: /Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}
  // The format extension is required (e.g., .vtt, .srt)
  // For most cases, mediaSourceId is the same as itemId
  // VTT format is preferred as it works better with HTML5 video players
  return `${cachedConfig.server}/Videos/${itemId}/${itemId}/Subtitles/${streamIndex}/Stream.${format}?api_key=${cachedConfig.apiKey}`;
}
