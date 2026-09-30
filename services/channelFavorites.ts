/**
 * Channel favorites live on the server, per user and keyed by channel id. The device list in the
 * Live TV preferences mirrors them: every screen reads it, and it stands alone when no server answers.
 */
import { getStoredServerId } from "@/services/jellyfin/connection";
import { fetchChannels, fetchListedChannels } from "@/services/jellyfin/liveTv";
import { getCachedConfig, getConfig, type JellyfinConfig } from "@/services/jellyfin/session";
import { setVideoFavorite } from "@/services/jellyfin/userData";
import {
  channelFavorite,
  channelListKey,
  favoriteKey,
  getLiveTvPreferences,
  isFavoriteChannel,
  toggleLocalFavoriteChannel,
  updateLiveTvPreferences,
  type ChannelFavorite,
  type ChannelIdentity,
} from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

/** Server and user pairs that have taken the device list once. */
export const SEEDED_KEY = "app_channel_favorites_seeded";
/** A focus or foreground inside this window reuses the last read. */
const SYNC_INTERVAL_MS = 30_000;

let edits = 0;
let writing = 0;
let inFlight: Promise<void> | null = null;
let lastSync = { scope: "", at: 0 };
const absentByScope = new Map<string, Set<string>>();

function seededScopes(): string[] {
  try {
    const raw = Settings.get(SEEDED_KEY);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function markSeeded(scope: string): void {
  const scopes = seededScopes();
  if (scopes.includes(scope)) return;
  try {
    Settings.set({ [SEEDED_KEY]: JSON.stringify([...scopes, scope]) });
  } catch (error) {
    logger.warn("Channel favorites seed mark failed", error, { service: "ChannelFavorites" });
  }
}

/** The device list first so every screen repaints at once, then the server; a refused write puts the device list back. */
export function toggleFavoriteChannel(channel: ChannelIdentity): void {
  const next = !isFavoriteChannel(getLiveTvPreferences(), channel);
  toggleLocalFavoriteChannel(channel);
  edits += 1;
  if (!channel.Id || !getCachedConfig().userId) return;
  const id = channel.Id;
  writing += 1;
  setVideoFavorite(id, next)
    .catch((error) => {
      logger.warn("Channel favorite write failed", error, { service: "ChannelFavorites", channelId: id });
      if (isFavoriteChannel(getLiveTvPreferences(), channel) === next) toggleLocalFavoriteChannel(channel);
    })
    .finally(() => {
      writing -= 1;
    });
}

/**
 * Device entries the server lacks: one no channel here answers is another server's and stays; a first visit carries the rest.
 * After that, one whose id still names its channel was unfavorited elsewhere; a new id (M3U ids hash the stream URL) carries.
 */
export function planCarry(localOnly: readonly ChannelFavorite[], resolved: ReadonlyMap<string, JellyfinItem>, seeded: boolean): { carry: JellyfinItem[]; keep: ChannelFavorite[] } {
  const carry: JellyfinItem[] = [];
  const keep: ChannelFavorite[] = [];
  for (const entry of localOnly) {
    const item = resolved.get(favoriteKey(entry));
    if (!item) keep.push(entry);
    else if (!seeded || item.Id !== entry.id) carry.push(item);
  }
  return { carry, keep };
}

/** The server's favorites in the device list's order, new ones after, then the entries kept off it. */
export function mirrorOf(local: readonly ChannelFavorite[], server: readonly JellyfinItem[], keep: readonly ChannelFavorite[]): ChannelFavorite[] {
  const byKey = new Map<string, ChannelFavorite>();
  for (const item of server) byKey.set(channelListKey(item), channelFavorite(item));
  for (const entry of keep) if (!byKey.has(favoriteKey(entry))) byKey.set(favoriteKey(entry), entry);
  const ordered: ChannelFavorite[] = [];
  for (const entry of local) {
    const match = byKey.get(favoriteKey(entry));
    if (!match) continue;
    ordered.push(match);
    byKey.delete(favoriteKey(entry));
  }
  return ordered.concat([...byKey.values()]);
}

function sameList(a: readonly ChannelFavorite[], b: readonly ChannelFavorite[]): boolean {
  return a.length === b.length && a.every((entry, index) => favoriteKey(entry) === favoriteKey(b[index]) && entry.id === b[index].id);
}

/** The server and user an account's sync is keyed by. */
async function scopeFor(account: JellyfinConfig): Promise<string> {
  return `${(await getStoredServerId()) ?? account.server}|${account.userId}`;
}

/** Whether `account` is still the one signed in. Synchronous, so no switch lands between it and what follows. */
function stillSignedIn(account: JellyfinConfig): boolean {
  const signedIn = getCachedConfig();
  return signedIn.server === account.server && signedIn.apiKey === account.apiKey && signedIn.userId === account.userId;
}

/** A switch writes the stored server before the cached account, so both are read again, the stored one first. */
async function stillScoped(scope: string, account: JellyfinConfig): Promise<boolean> {
  return (await scopeFor(account)) === scope && stillSignedIn(account);
}

async function runSync(scope: string, account: JellyfinConfig): Promise<void> {
  const startEdits = edits;
  const server = (await fetchChannels({ favorite: true })).items;
  if (!stillSignedIn(account)) return;
  const serverKeys = new Set(server.map(channelListKey));
  const localOnly = getLiveTvPreferences().favorites.filter((entry) => !serverKeys.has(favoriteKey(entry)));
  // Another server's entries search by name each time; once per session is enough.
  const absent = absentByScope.get(scope) ?? new Set<string>();
  absentByScope.set(scope, absent);
  const lookup = localOnly.filter((entry) => !absent.has(favoriteKey(entry)));
  const resolved = new Map((lookup.length > 0 ? await fetchListedChannels(lookup) : []).map((item) => [channelListKey(item), item] as const));
  if (!stillSignedIn(account)) return;
  for (const entry of lookup) if (!resolved.has(favoriteKey(entry))) absent.add(favoriteKey(entry));
  const seeded = seededScopes().includes(scope);
  const { carry, keep } = planCarry(localOnly, resolved, seeded);
  // A sign-in that changed during the reads owns the device list from here; the writes carry this account's own credentials.
  if (!(await stillScoped(scope, account))) return;
  const outcomes = await Promise.allSettled(carry.map((item) => setVideoFavorite(item.Id, true, account)));
  const carried = carry.filter((_, index) => outcomes[index].status === "fulfilled");
  const refused = carry.filter((_, index) => outcomes[index].status === "rejected").map(channelFavorite);
  if (refused.length === 0) markSeeded(scope);
  // A toggle during the read, or one still writing, is newer than it.
  if (!(await stillScoped(scope, account)) || edits !== startEdits || writing > 0) return;
  const mirror = mirrorOf(getLiveTvPreferences().favorites, [...server, ...carried], [...keep, ...refused]);
  if (!sameList(mirror, getLiveTvPreferences().favorites)) updateLiveTvPreferences({ favorites: mirror });
  lastSync = { scope, at: Date.now() };
}

/** Reads the server's favorites into the device list; a failed read leaves the device list as it is. */
export function syncChannelFavorites(): Promise<void> {
  let ran: JellyfinConfig | null = null;
  inFlight ??= (async () => {
    const config = await getConfig();
    if (!config.server || !config.apiKey || !config.userId) return;
    const account = { ...config };
    ran = account;
    const scope = await scopeFor(account);
    if (!stillSignedIn(account)) return;
    if (lastSync.scope === scope && Date.now() - lastSync.at < SYNC_INTERVAL_MS) return;
    await runSync(scope, account);
  })()
    .catch((error) => logger.warn("Channel favorites sync failed", error, { service: "ChannelFavorites" }))
    .finally(() => {
      inFlight = null;
      // A sign-in that asked while this read ran was handed it; it gets a read of its own.
      if (ran && !stillSignedIn(ran)) void syncChannelFavorites();
    });
  return inFlight;
}
