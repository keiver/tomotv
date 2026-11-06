/** The saved-account index at STORAGE_KEYS.ACCOUNTS and the per-account token keys. */
import { SavedAccount } from "@/types/jellyfin";
import * as SecureStore from "expo-secure-store";
import { accountTokenKey, STORAGE_KEYS } from "./constants";

/** Normalize a server URL the same way the saved-server list does. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function writeIndex(accounts: SavedAccount[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));
}

let indexQueue: Promise<unknown> = Promise.resolve();

/** Runs one read-modify-write of the index at a time, so a pruning read never overwrites a save. */
function withIndex<T>(task: () => Promise<T>): Promise<T> {
  const run = indexQueue.then(task, task);
  indexQueue = run.catch(() => {});
  return run;
}

/**
 * Read the saved accounts, most-recently-used first.
 *
 * One-time seed: only when the index has NEVER been written, adopt the active
 * session as the first account (its token was minted under the install-wide
 * device id, so that id becomes the account's). Sessions predating the stored
 * server Id can't be keyed and get saved on their next login instead.
 */
export function getSavedAccounts(): Promise<SavedAccount[]> {
  return withIndex(readAccounts);
}

async function readAccounts(): Promise<SavedAccount[]> {
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

  // An account whose token was dropped (server rejected it) can only fail, so it leaves the index.
  // A throwing read (locked device) is not a missing token and keeps the account.
  const tokens = await Promise.all(accounts.map((a) => SecureStore.getItemAsync(accountTokenKey(a.serverId, a.userId)).catch(() => "")));
  const live = accounts.filter((_, i) => tokens[i] !== null);
  if (live.length !== accounts.length) await writeIndex(live);

  return live.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
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

/** Save or refresh one account and its token (keyed by serverId + userId). */
export function upsertAccount(account: Omit<SavedAccount, "lastUsedAt">, token: string): Promise<void> {
  return withIndex(async () => {
    const accounts = await readAccounts();
    const next = accounts.filter((a) => !(a.serverId === account.serverId && a.userId === account.userId));
    next.push({ ...account, serverUrl: normalizeUrl(account.serverUrl), lastUsedAt: Date.now() });
    await SecureStore.setItemAsync(accountTokenKey(account.serverId, account.userId), token);
    await writeIndex(next);
  });
}

/** Forget one account: its token and its index entry. */
export function removeAccount(serverId: string, userId: string): Promise<void> {
  return withIndex(async () => {
    await SecureStore.deleteItemAsync(accountTokenKey(serverId, userId)).catch(() => {});
    const accounts = await readAccounts();
    await writeIndex(accounts.filter((a) => !(a.serverId === serverId && a.userId === userId)));
  });
}

/** Point every account saved on one server (by system Id) at its new address. Tokens are untouched. */
export function relocateAccounts(serverId: string, serverUrl: string): Promise<void> {
  return withIndex(async () => {
    const accounts = await readAccounts();
    if (!accounts.some((a) => a.serverId === serverId)) return;
    const url = normalizeUrl(serverUrl);
    await writeIndex(accounts.map((a) => (a.serverId === serverId ? { ...a, serverUrl: url } : a)));
  });
}
