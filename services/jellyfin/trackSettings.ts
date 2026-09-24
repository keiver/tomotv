/**
 * The account's audio and subtitle settings, Jellyfin's own Playback settings, so every device
 * signed in as the user shares the viewer's last pick. The last read answers offline.
 */
import * as SecureStore from "expo-secure-store";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS, STORAGE_KEYS } from "./constants";
import { subscribeAuthChange } from "./events";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getCachedConfig, getConfig } from "./session";

export type SubtitleMode = "Default" | "Always" | "OnlyForced" | "None" | "Smart";
const MODES: readonly string[] = ["Default", "Always", "OnlyForced", "None", "Smart"];

export interface TrackSettings {
  audioLanguage: string | null;
  playDefaultAudio: boolean;
  subtitleMode: SubtitleMode;
  subtitleLanguage: string | null;
}

/** What Jellyfin holds for a user nobody has configured. */
export const JELLYFIN_DEFAULTS: TrackSettings = { audioLanguage: null, playDefaultAudio: true, subtitleMode: "Default", subtitleLanguage: null };

type ServerConfiguration = Record<string, unknown> & {
  AudioLanguagePreference?: string | null;
  PlayDefaultAudioTrack?: boolean;
  SubtitleMode?: string;
  SubtitleLanguagePreference?: string | null;
};

type Change = Partial<TrackSettings>;
/** `pending` is a pick the server has not taken yet, pushed before anything is adopted from it. */
type Entry = { settings: TrackSettings; pending?: Change };
type Stored = Record<string, Entry>;

export function fromServer(configuration: ServerConfiguration): TrackSettings {
  return {
    audioLanguage: configuration.AudioLanguagePreference || null,
    playDefaultAudio: configuration.PlayDefaultAudioTrack !== false,
    subtitleMode: MODES.includes(configuration.SubtitleMode ?? "") ? (configuration.SubtitleMode as SubtitleMode) : "Default",
    subtitleLanguage: configuration.SubtitleLanguagePreference || null,
  };
}

/** The whole configuration back with only the changed fields replaced: the POST overwrites every field. */
export function toServer(configuration: ServerConfiguration, change: Change): ServerConfiguration {
  const next = { ...configuration };
  if (change.audioLanguage !== undefined) next.AudioLanguagePreference = change.audioLanguage;
  if (change.playDefaultAudio !== undefined) next.PlayDefaultAudioTrack = change.playDefaultAudio;
  if (change.subtitleMode !== undefined) next.SubtitleMode = change.subtitleMode;
  if (change.subtitleLanguage !== undefined) next.SubtitleLanguagePreference = change.subtitleLanguage;
  return next;
}

let stored: Stored = {};
/** The Keychain is read once; after that memory is ahead of it, since writes persist behind it. */
let primed = false;
let primeFailed = false;
let priming: Promise<void> | null = null;
let refreshing: Promise<void> | null = null;
/** Writes one at a time, so two quick picks cannot post over each other. */
let writeChain: Promise<unknown> = Promise.resolve();
/** Accounts the server refused a write for (403) or that are shared (demo): their picks stay on this device. */
const localOnly = new Set<string>();

function accountKey(server: string, userId: string): string | null {
  return server && userId ? `${server}|${userId}` : null;
}

function currentAccount(): string | null {
  const { server, userId } = getCachedConfig();
  return accountKey(server, userId);
}

function parse(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Stored) : {};
  } catch {
    return {};
  }
}

function persist(): void {
  SecureStore.setItemAsync(STORAGE_KEYS.TRACK_SETTINGS, JSON.stringify(stored)).catch((error) => {
    logger.warn("Could not persist the track settings", { service: "TrackSettings", error });
  });
}

export function primeTrackSettings(): Promise<void> {
  if (primed) return Promise.resolve();
  if (priming) return priming;
  priming = (async () => {
    try {
      // A pick recorded before the read landed is newer than anything on disk.
      stored = { ...parse(await SecureStore.getItemAsync(STORAGE_KEYS.TRACK_SETTINGS)), ...stored };
      primed = true;
      primeFailed = false;
    } catch (error) {
      // A locked Keychain on cold launch: the defaults answer, and the next read retries.
      logger.warn("Could not read the stored track settings", { service: "TrackSettings", error });
      primeFailed = true;
    } finally {
      priming = null;
    }
  })();
  return priming;
}

/** The signed-in account's settings as last known; Jellyfin's defaults before any read. */
export function getTrackSettingsSync(): TrackSettings {
  if (primeFailed && !priming) void primeTrackSettings();
  const account = currentAccount();
  return (account && stored[account]?.settings) || JELLYFIN_DEFAULTS;
}

/** Waits for the Keychain and, briefly, for a refresh in flight: a slow server never holds up playback. */
export async function readTrackSettings(waitMs = 1500): Promise<TrackSettings> {
  await primeTrackSettings();
  const inFlight = refreshing;
  if (inFlight) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([inFlight, new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
    clearTimeout(timer);
  }
  return getTrackSettingsSync();
}

type Session = { server: string; userId: string; deviceId: string; apiKey: string };

async function fetchConfiguration(session: Session): Promise<ServerConfiguration> {
  const response = await fetchWithTimeout(
    `${session.server}/Users/Me`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(session.deviceId, session.apiKey) } },
    API_TIMEOUTS.QUICK,
  );
  if (!response.ok) throw new Error(`Failed to read the user settings: ${response.status}`);
  const user = (await response.json()) as { Configuration?: ServerConfiguration };
  return user.Configuration ?? {};
}

async function signedIn(): Promise<{ session: Session; account: string } | null> {
  const session = await getConfig();
  const account = accountKey(session.server, session.userId);
  return account && session.apiKey ? { session, account } : null;
}

/** Posts this account's pending pick into the server's configuration; a 403 keeps it on this device. */
function pushPending(account: string): Promise<void> {
  const run = writeChain.then(async () => {
    const signed = await signedIn();
    const pending = stored[account]?.pending;
    if (!signed || signed.account !== account || !pending) return;
    if (localOnly.has(account) || (await SecureStore.getItemAsync(STORAGE_KEYS.IS_DEMO_MODE).catch(() => null))) {
      localOnly.add(account);
      stored = { ...stored, [account]: { settings: stored[account].settings } };
      persist();
      return;
    }
    const { session } = signed;
    const next = toServer(await fetchConfiguration(session), pending);
    // The account can switch while the read was in flight; its configuration must not land on another user.
    if ((await signedIn())?.account !== account) return;
    const response = await fetchWithTimeout(
      `${session.server}/Users/Configuration?userId=${session.userId}`,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: getAuthHeader(session.deviceId, session.apiKey) }, body: JSON.stringify(next) },
      API_TIMEOUTS.NORMAL,
    );
    if (response.status === 403) {
      logger.warn("The server does not let this user change playback settings; keeping the pick on this device", { service: "TrackSettings" });
      localOnly.add(account);
    } else if (!response.ok) {
      throw new Error(`Failed to write the user settings: ${response.status}`);
    }
    // A pick made while this one was posting stays pending for the next push.
    const latest = stored[account];
    const settings = response.ok ? { ...fromServer(next), ...(latest.pending === pending ? {} : latest.pending) } : latest.settings;
    stored = { ...stored, [account]: latest.pending === pending ? { settings } : { settings, pending: latest.pending } };
    persist();
  });
  writeChain = run.catch(() => undefined);
  return run;
}

function record(change: Change): void {
  const account = currentAccount();
  if (!account) return;
  const entry = stored[account] ?? { settings: JELLYFIN_DEFAULTS };
  stored = { ...stored, [account]: { settings: { ...entry.settings, ...change }, pending: { ...entry.pending, ...change } } };
  persist();
  pushPending(account).catch((error) => logger.warn("Could not sync the track settings, retrying on the next refresh", { service: "TrackSettings", error }));
}

/** Jellyfin only follows a language once it stops preferring the file's default track. */
export function recordAudioPick(language: string): void {
  record({ audioLanguage: language, playDefaultAudio: false });
}

export function recordSubtitlePick(pick: { kind: "off" } | { kind: "language"; tag: string }): void {
  record(pick.kind === "off" ? { subtitleMode: "None" } : { subtitleMode: "Always", subtitleLanguage: pick.tag });
}

/** The device-wide subtitle choice from before settings synced, handed to the first untouched account once. */
async function migrateLegacySubtitle(account: string, settings: TrackSettings): Promise<void> {
  const legacy = await SecureStore.getItemAsync(STORAGE_KEYS.SUBTITLE_PREFERENCE).catch(() => null);
  if (!legacy) return;
  await SecureStore.deleteItemAsync(STORAGE_KEYS.SUBTITLE_PREFERENCE).catch(() => undefined);
  if (settings.subtitleMode !== "Default" || settings.subtitleLanguage || currentAccount() !== account) return;
  recordSubtitlePick(legacy === "off" ? { kind: "off" } : { kind: "language", tag: legacy });
}

async function runRefresh(): Promise<void> {
  await primeTrackSettings();
  const signed = await signedIn();
  if (!signed) return;
  const { session, account } = signed;
  try {
    if (stored[account]?.pending && !localOnly.has(account)) {
      await pushPending(account);
      return;
    }
    const settings = fromServer(await fetchConfiguration(session));
    // A pick made during the read wins over what the read returned.
    if (stored[account]?.pending || (await signedIn())?.account !== account) return;
    stored = { ...stored, [account]: { settings } };
    persist();
    await migrateLegacySubtitle(account, settings);
  } catch (error) {
    logger.warn("Could not refresh the track settings, using the last known ones", { service: "TrackSettings", error });
  }
}

/** Adopts the server's settings, or pushes a pick the server has not taken yet. */
export function refreshTrackSettings(): Promise<void> {
  if (!refreshing) refreshing = runRefresh().finally(() => (refreshing = null));
  return refreshing;
}

/** Test seam; `unprimed` makes the next read go to the Keychain. */
export function resetTrackSettingsForTests(unprimed = false): void {
  stored = {};
  primed = !unprimed;
  primeFailed = false;
  refreshing = null;
  localOnly.clear();
  writeChain = Promise.resolve();
}

void primeTrackSettings();
subscribeAuthChange(() => void refreshTrackSettings());
