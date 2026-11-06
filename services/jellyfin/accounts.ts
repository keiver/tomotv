/**
 * Saved accounts: one remembered sign-in per (server, user), so picking a saved
 * server reconnects with its stored token instead of forcing a re-login.
 *
 * The index at STORAGE_KEYS.ACCOUNTS holds metadata only; each token lives at its
 * own SecureStore key (accountTokenKey). The active-session keys stay the single
 * source of truth for everything downstream: this module is the layer above that
 * fills them (activateAccount) or is filled from them (saveAuthResult's upsert).
 *
 * Demo sessions are never saved: demo.ts never calls saveAuthResult.
 */
import { JellyfinPublicServerInfo, SavedAccount, SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import * as SecureStore from "expo-secure-store";
import { getSavedAccounts, normalizeUrl, removeAccount, upsertAccount } from "./accountIndex";
import { warmBitrateMemory } from "./bitrateTest";
import { accountTokenKey, STORAGE_KEYS } from "./constants";
import { buildServerUrlCandidates, checkServerInfo, getSavedServers, removeSavedServer, upsertSavedServer } from "./connection";
import { notifyAuthChange } from "./events";
import { clearContentCaches, refreshConfig, setSavedConnectionStatus, validateAccessToken } from "./session";

/** The accounts on one server card: matched by system Id, url as the fallback. */
function accountsOn(server: SavedServer, accounts: SavedAccount[]): SavedAccount[] {
  return accounts.filter((a) => (server.serverId ? a.serverId === server.serverId : normalizeUrl(a.serverUrl) === server.url));
}

export async function getAccountsForServer(server: SavedServer): Promise<SavedAccount[]> {
  return accountsOn(server, await getSavedAccounts());
}

/** The saved servers and the accounts on each, keyed by server id; a server with none has no entry. */
export async function getSavedServersWithAccounts(): Promise<{ servers: SavedServer[]; accountsByServer: Record<string, SavedAccount[]> }> {
  const [servers, accounts] = await Promise.all([getSavedServers(), getSavedAccounts()]);
  const accountsByServer: Record<string, SavedAccount[]> = {};
  for (const server of servers) {
    const saved = accountsOn(server, accounts);
    if (saved.length > 0) accountsByServer[server.id] = saved;
  }
  return { servers, accountsByServer };
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
 * - "needs_login": no stored token, or the server rejected it (the account is removed).
 * - "unreachable": the server didn't answer, nothing is deleted, mirroring the
 *   recovery ladder's rule that a network failure must never destroy credentials.
 */
export async function activateAccount(account: SavedAccount): Promise<ActivateAccountResult> {
  const token = await SecureStore.getItemAsync(accountTokenKey(account.serverId, account.userId));
  if (!token) return "needs_login";

  // Reach the server: exact saved URL first, then protocol/port candidates for
  // the same host (the restoreLastConnection pattern).
  let workingUrl: string;
  let info: JellyfinPublicServerInfo;
  try {
    info = await checkServerInfo(account.serverUrl);
    workingUrl = account.serverUrl;
  } catch {
    const host = account.serverUrl.replace(/^https?:\/\//i, "");
    const candidates = buildServerUrlCandidates(host).filter((c) => c !== account.serverUrl);
    try {
      ({ workingUrl, info } = await Promise.any(candidates.map(async (candidate) => ({ workingUrl: candidate, info: await checkServerInfo(candidate) }))));
    } catch {
      return "unreachable";
    }
  }
  // The probe's name is the freshest: a legacy account may carry an address as its name.
  const serverName = info.ServerName || account.serverName;

  const verdict = await validateAccessToken(workingUrl, token, account.deviceId);
  if (verdict === "unreachable") return "unreachable";
  if (verdict === "invalid") {
    logger.warn("Saved token rejected by server, removing the account", { service: "JellyfinAPI", serverName: account.serverName, userName: account.userName });
    await removeAccount(account.serverId, account.userId);
    return "needs_login";
  }

  // Adopt: the same active-slot writes and tail as saveAuthResult.
  await Promise.all([
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_URL, workingUrl),
    SecureStore.setItemAsync(STORAGE_KEYS.API_KEY, token),
    SecureStore.setItemAsync(STORAGE_KEYS.USER_ID, account.userId),
    SecureStore.setItemAsync(STORAGE_KEYS.USER_NAME, account.userName),
    SecureStore.setItemAsync(STORAGE_KEYS.AUTH_METHOD, account.authMethod),
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_NAME, serverName),
    SecureStore.setItemAsync(STORAGE_KEYS.SERVER_ID, account.serverId),
    SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, account.deviceId),
    SecureStore.deleteItemAsync(STORAGE_KEYS.IS_DEMO_MODE).catch(() => {}),
  ]);

  await refreshConfig();
  await upsertSavedServer(workingUrl, serverName, account.serverId);
  setSavedConnectionStatus("connected");

  // Bump recency and persist a corrected URL and name in one index write.
  await upsertAccount({ ...account, serverUrl: workingUrl, serverName }, token);

  await clearContentCaches("after account switch");
  logger.info("Switched to saved account", { service: "JellyfinAPI", serverName, userName: account.userName });
  notifyAuthChange();
  // The link to THIS server may never have been measured; meter it once the
  // post-switch library refetch has had its moment (skips fresh memory).
  warmBitrateMemory();
  return "connected";
}
