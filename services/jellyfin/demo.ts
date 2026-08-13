/**
 * Jellyfin's public demo server: fetch its rotating credentials, sign in, and sign out.
 *
 * The demo server resets hourly, so credentials are never persisted long-term and are
 * re-fetched on every connect. Credential writes are validated and rolled back on failure
 * so a half-written login can never masquerade as a real one.
 */
import { logger } from "@/utils/logger";
import { retryWithBackoff } from "@/utils/retry";
import * as SecureStore from "expo-secure-store";
import { API_TIMEOUTS, DEMO_PASSWORD, DEMO_SERVER_NAME, DEMO_SERVER_STABLE, DEMO_USERNAME, STORAGE_KEYS } from "./constants";
import { notifyAuthChange } from "./events";
import { fetchWithTimeout } from "./http";
import { clearContentCaches, getAuthHeader, getOrCreateDeviceId, refreshConfig, setSavedConnectionStatus } from "./session";
/**
 * Fetch demo credentials from Jellyfin API
 * Demo server resets hourly, so credentials must be fetched fresh each time
 * @param demoServerUrl - The demo server URL to use (stable or unstable)
 */
async function fetchDemoCredentials(demoServerUrl: string): Promise<{ apiKey: string; userId: string }> {
  const url = `${demoServerUrl}/Users/AuthenticateByName`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
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
      },
      15000, // 15s timeout for real-world conditions
    );

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
      // CRITICAL: Refresh config cache after rollback — getConfig serves the cache,
      // so without this it would keep the pre-connect credentials the store no longer has
      await refreshConfig();
      throw new Error("Failed to save demo credentials. Please try again.");
    }

    // Refresh config cache with new credentials
    await refreshConfig();

    // Validate credentials by making a lightweight API call BEFORE marking demo mode active
    const deviceId = await getOrCreateDeviceId();
    try {
      await retryWithBackoff(
        async () => {
          const url = `${demoServerUrl}/UserViews?userId=${userId}`;
          const response = await fetchWithTimeout(
            url,
            {
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(deviceId, apiKey),
              },
            },
            API_TIMEOUTS.SHORT,
          );

          if (!response.ok) {
            throw new Error("Invalid credentials");
          }

          return response;
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

    // Fixed display name instead of the server's self-reported "Stable Demo"
    await SecureStore.setItemAsync(STORAGE_KEYS.SERVER_NAME, DEMO_SERVER_NAME);

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
