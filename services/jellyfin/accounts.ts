/**
 * Saved accounts: one remembered sign-in per (server, user), so picking a saved
 * server reconnects with its stored token instead of forcing a re-login.
 *
 * The index at STORAGE_KEYS.ACCOUNTS holds metadata only; each token lives at its
 * own SecureStore key (accountTokenKey). The active-session keys stay the single
 * source of truth for everything downstream — this module is the layer above that
 * fills them (activateAccount) or is filled from them (saveAuthResult's upsert).
 *
 * Demo sessions are never saved: the demo server resets hourly, so its tokens are
 * not worth remembering, and demo.ts never calls saveAuthResult.
 */
import { SavedAccount, SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import { warmBitrateMemory } from "./bitrateTest";
import { accountTokenKey, STORAGE_KEYS } from "./constants";
import { buildServerUrlCandidates, checkServerInfo, removeSavedServer, upsertSavedServer } from "./connection";
import { notifyAuthChange } from "./events";
import { clearContentCaches, refreshConfig, setSavedConnectionStatus, validateAccessToken } from "./session";

/** Normalize a server URL the same way the saved-server list does. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function writeIndex(accounts: SavedAccount[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));
}

/**
 * Read the saved accounts, most-recently-used first.
 *
 * One-time seed: only when the index has NEVER been written, adopt the active
 * session as the first account (its token was minted under the install-wide
 * device id, so that id becomes the account's). Sessions predating the stored
 * server Id can't be keyed and get saved on their next login instead.
 */
export async function getSavedAccounts(): Promise<SavedAccount[]> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEYS.ACCOUNTS);

  if (raw === null) {
    const seeded = await seedFromActiveSession();
    await writeIndex(seeded);
    return seeded;
  }

  let accounts: SavedAccount[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) accounts = parsed as SavedAccount[];
  } catch {
    accounts = [];
  }

  return accounts.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

async function seedFromActiveSession(): Promise<SavedAccount[]> {
  const [serverUrl, token, userId, userName, authMethod, serverName, serverId, isDemo, deviceId] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
    SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
    SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
    SecureStore.getItemAsync(STORAGE_KEYS.USER_NAME),
    SecureStore.getItemAsync(STORAGE_KEYS.AUTH_METHOD),
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_NAME),
    SecureStore.getItemAsync(STORAGE_KEYS.SERVER_ID),
    SecureStore.getItemAsync(STORAGE_KEYS.IS_DEMO_MODE),
    SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID),
  ]);

  if (!serverUrl || !token || !userId || !serverId || !deviceId || isDemo) return [];

  await SecureStore.setItemAsync(accountTokenKey(serverId, userId), token);
  return [
    {
      serverId,
      serverUrl: normalizeUrl(serverUrl),
      serverName: serverName || normalizeUrl(serverUrl),
      userId,
      userName: userName || "",
      authMethod: authMethod === "quickconnect" || authMethod === "apikey" ? authMethod : "password",
      deviceId,
      lastUsedAt: Date.now(),
    },
  ];
}

/** Saved accounts on one server card: matched by system Id, url as the fallback. */
export async function getAccountsForServer(server: SavedServer): Promise<SavedAccount[]> {
  const accounts = await getSavedAccounts();
  return accounts.filter((a) => (server.serverId ? a.serverId === server.serverId : normalizeUrl(a.serverUrl) === server.url));
}

/** Save or refresh one account and its token (keyed by serverId + userId). */
export async function upsertAccount(account: Omit<SavedAccount, "lastUsedAt">, token: string): Promise<void> {
  const accounts = await getSavedAccounts();
  const next = accounts.filter((a) => !(a.serverId === account.serverId && a.userId === account.userId));
  next.push({ ...account, serverUrl: normalizeUrl(account.serverUrl), lastUsedAt: Date.now() });
  await SecureStore.setItemAsync(accountTokenKey(account.serverId, account.userId), token);
  await writeIndex(next);
}

/** Forget one account: its token and its index entry. */
export async function removeAccount(serverId: string, userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(accountTokenKey(serverId, userId)).catch(() => {});
  const accounts = await getSavedAccounts();
  await writeIndex(accounts.filter((a) => !(a.serverId === serverId && a.userId === userId)));
}

/**
 * Remove a saved server card and every account saved on it. Lives here rather
 * than in connection.ts so connection stays free of account imports.
 */
export async function removeSavedServerAndAccounts(server: SavedServer): Promise<void> {
  const accounts = await getAccountsForServer(server);
  for (const account of accounts) {
    await removeAccount(account.serverId, account.userId);
  }
  await removeSavedServer(server.id);
}

export type ActivateAccountResult = "connected" | "needs_login" | "unreachable";

/**
 * Adopt a saved account as the active session, validating its token first.
 *
 * - "connected": token confirmed live, active slot rewritten, caches cleared.
 * - "needs_login": no stored token, or the server rejected it (the dead token is
 *   deleted; the metadata stays so the login can be prefilled).
 * - "unreachable": the server didn't answer — nothing is deleted, mirroring the
 *   recovery ladder's rule that a network failure must never destroy credentials.
 */
export async function activateAccount(account: SavedAccount): Promise<ActivateAccountResult> {
  const token = await SecureStore.getItemAsync(accountTokenKey(account.serverId, account.userId));
  if (!token) return "needs_login";

  // Reach the server: exact saved URL first, then protocol/port candidates for
  // the same host (the restoreLastConnection pattern).
  let workingUrl: string;
  try {
    await checkServerInfo(account.serverUrl);
    workingUrl = account.serverUrl;
  } catch {
    const host = account.serverUrl.replace(/^https?:\/\//i, "");
    const candidates = buildServerUrlCandidates(host).filter((c) => c !== account.serverUrl);
    try {
      workingUrl = await Promise.any(
        candidates.map(async (candidate) => {
          await checkServerInfo(candidate);
          return candidate;
        }),
      );
    } catch {
      return "unreachable";
    }
  }

  const verdict = await validateAccessToken(workingUrl, token, account.deviceId);
  if (verdict === "unreachable") return "unreachable";
  if (verdict === "invalid") {
    logger.warn("Saved token rejected by server, dropping it", { service: "JellyfinAPI", serverName: account.serverName, userName: account.userName });
    await SecureStore.deleteItemAsync(accountTokenKey(account.serverId, account.userId)).catch(() => {});
    return "needs_login";
  }

  // Adopt: the same active-slot writes and tail as saveAuthResult.
  await Promise.all([
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, workingUrl),
    SecureStore.setItemAsync(STORAGE_KEYS.API_KEY, token),
    SecureStore.setItemAsync(STORAGE_KEYS.USER_ID, account.userId),
    SecureStore.setItemAsync(STORAGE_KEYS.USER_NAME, account.userName),
    SecureStore.setItemAsync(STORAGE_KEYS.AUTH_METHOD, account.authMethod),
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_NAME, account.serverName),
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_ID, account.serverId),
    SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, account.deviceId),
    SecureStore.deleteItemAsync(STORAGE_KEYS.IS_DEMO_MODE).catch(() => {}),
  ]);

  await refreshConfig();
  await upsertSavedServer(workingUrl, account.serverName, account.serverId);
  setSavedConnectionStatus("connected");

  // Bump recency and persist a corrected URL in one index write.
  await upsertAccount({ ...account, serverUrl: workingUrl }, token);

  await clearContentCaches("after account switch");
  logger.info("Switched to saved account", { service: "JellyfinAPI", serverName: account.serverName, userName: account.userName });
  notifyAuthChange();
  // The link to THIS server may never have been measured; meter it once the
  // post-switch library refetch has had its moment (skips fresh memory).
  warmBitrateMemory();
  return "connected";
}
