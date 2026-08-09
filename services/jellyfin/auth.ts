/**
 * Signing in: Quick Connect, username/password, and persisting the result.
 *
 * `signOut` is deliberately NOT here — it lives in session.ts, because the 401 handler
 * inside session must be able to call it without session depending on this module.
 */
import { JellyfinAuthResult, QuickConnectResult } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, STORAGE_KEYS } from "./constants";
import { notifyAuthChange } from "./events";
import { clearContentCaches, getAuthHeader, getOrCreateDeviceId, refreshConfig, setSavedConnectionStatus } from "./session";
import { upsertSavedServer } from "./connection";
/**
 * Check if Quick Connect is enabled on the server.
 */
export async function checkQuickConnectEnabled(serverUrl: string): Promise<boolean> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
  const url = `${cleanUrl}/QuickConnect/Enabled`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      API_TIMEOUTS.SHORT,
    );

    if (!response.ok) {
      return false;
    }

    // Jellyfin returns the boolean directly as the response body (e.g. "true" or "false")
    const text = await response.text();
    return text.trim().toLowerCase() === "true";
  } catch {
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

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: getAuthHeader(deviceId),
        },
      },
      API_TIMEOUTS.QUICK,
    );

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

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      API_TIMEOUTS.SHORT,
    );

    if (!response.ok) {
      throw new Error(`Quick Connect poll failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
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

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: getAuthHeader(deviceId),
        },
        body: JSON.stringify({ Secret: secret }),
      },
      API_TIMEOUTS.QUICK,
    );

    if (!response.ok) {
      throw new Error(`Quick Connect authentication failed: ${response.status}`);
    }

    const data: JellyfinAuthResult = await response.json();

    if (!data.AccessToken || !data.User?.Id) {
      throw new Error("Invalid auth response: missing AccessToken or User");
    }

    return data;
  } catch (error) {
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

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: getAuthHeader(deviceId),
        },
        body: JSON.stringify({ Username: username, Pw: password }),
      },
      API_TIMEOUTS.QUICK,
    );

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
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Authentication request timed out.");
    }
    throw error;
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

  // Refresh config cache so all API calls pick up the new credentials. Before
  // upsertSavedServer: if that throws, the cache must already match the store.
  await refreshConfig();

  // Persist this server as a saved destination (no credentials stored).
  // New servers default to their connection string as the title; user renames persist.
  await upsertSavedServer(cleanUrl);

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
