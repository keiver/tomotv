/**
 * Each library's saved sort and filters, per account: a copy in the device's defaults so the grid draws
 * the saved order at once and offline, and the account's display preferences on the server so every
 * device signed in as that user shows the same view. The server copy wins on load; a save the server
 * does not take waits here and goes up with the next load.
 */
import { editDisplayPreferences, getCachedConfig, getConfig, getDisplayPreferences, isDemoMode } from "@/services/jellyfinApi";
import type { PreferencesOwner } from "@/services/jellyfin/displayPreferences";
import { THEMES_CLIENT } from "@/services/themeLibrary";
import { EMPTY_FILTERS, type LibraryFilters, type LibrarySortBy } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const LIBRARY_VIEWS_KEY = "app_library_views";
/** The custom key under the library's own display preferences record. */
export const VIEW_PREF_KEY = "view";

const SORT_BY_VALUES: readonly LibrarySortBy[] = [
  "SortName",
  "DateCreated",
  "DateLastContentAdded",
  "PremiereDate",
  "ProductionYear",
  "CommunityRating",
  "CriticRating",
  "OfficialRating",
  "Runtime",
  "DatePlayed",
  "SeriesDatePlayed",
  "PlayCount",
  "Album",
  "AlbumArtist",
  "Artist",
];

type StoredView = { view: LibraryFilters; pending?: true };
type AccountViews = Record<string, StoredView>;

/** Every field falls back to the empty selection on its own, so a document from another build or device still reads. */
export function parseLibraryFilters(raw: unknown): LibraryFilters {
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      doc = null;
    }
  }
  const source = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []);
  return {
    favorite: source.favorite === true,
    played: source.played === true,
    unplayed: source.unplayed === true,
    genres: strings(source.genres),
    artistIds: strings(source.artistIds),
    years: Array.isArray(source.years) ? source.years.filter((entry): entry is number => Number.isInteger(entry)) : [],
    shuffle: source.shuffle === true,
    sortBy: SORT_BY_VALUES.includes(source.sortBy as LibrarySortBy) ? (source.sortBy as LibrarySortBy) : EMPTY_FILTERS.sortBy,
    sortOrder: source.sortOrder === "Descending" ? "Descending" : "Ascending",
  };
}

export function isEmptyFilters(filters: LibraryFilters): boolean {
  return JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS);
}

function accountKey(): string {
  const { server, userId } = getCachedConfig();
  return server && userId ? `${server}|${userId}` : "";
}

function readDocument(): Record<string, unknown> {
  try {
    const raw = Settings.get(LIBRARY_VIEWS_KEY);
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readAccount(account: string): AccountViews {
  const stored = readDocument()[account];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const views: AccountViews = {};
  for (const [libraryId, entry] of Object.entries(stored as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const { view, pending } = entry as Record<string, unknown>;
    views[libraryId] = pending === true ? { view: parseLibraryFilters(view), pending: true } : { view: parseLibraryFilters(view) };
  }
  return views;
}

function writeAccount(account: string, views: AccountViews): void {
  try {
    const doc = readDocument();
    if (Object.keys(views).length > 0) doc[account] = views;
    else delete doc[account];
    Settings.set({ [LIBRARY_VIEWS_KEY]: JSON.stringify(doc) });
  } catch (error) {
    logger.warn("Library views write failed", error, { service: "LibraryViews" });
  }
}

/** Cached per account, so a snapshot reader gets the same object until a write or a switch. */
let current: AccountViews | null = null;
let currentAccount = "";
const listeners = new Set<() => void>();
/** Libraries whose server copy this session has read, per account. */
const loaded = new Set<string>();
/** Accounts whose server refused a write (403) or that are shared (the demo): their views stay on this device. */
const localOnly = new Set<string>();

function views(): AccountViews {
  const account = accountKey();
  if (current && account === currentAccount) return current;
  current = readAccount(account);
  currentAccount = account;
  return current;
}

function replace(account: string, next: AccountViews): void {
  current = next;
  currentAccount = account;
  writeAccount(account, next);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeLibraryViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The saved selection for a library, or the empty selection. */
export function getLibraryView(libraryId: string): LibraryFilters {
  return views()[libraryId]?.view ?? EMPTY_FILTERS;
}

async function owner(): Promise<PreferencesOwner> {
  const { server, userId } = await getConfig();
  return { server: server ?? "", userId: userId ?? "" };
}

async function serverWritable(account: string): Promise<boolean> {
  if (localOnly.has(account)) return false;
  if (await isDemoMode()) {
    localOnly.add(account);
    return false;
  }
  return true;
}

/** Writes the library's record on the server; an empty selection drops the key. */
function push(libraryId: string, filters: LibraryFilters, bound: PreferencesOwner): Promise<void> {
  return editDisplayPreferences(libraryId, THEMES_CLIENT, ({ [VIEW_PREF_KEY]: _dropped, ...rest }) => (isEmptyFilters(filters) ? rest : { ...rest, [VIEW_PREF_KEY]: JSON.stringify(filters) }), bound);
}

/** Marks the library's saved entry as sent, when it is still the one that was sent. */
function markSent(account: string, libraryId: string, sent: LibraryFilters): void {
  if (accountKey() !== account) return;
  const all = views();
  const entry = all[libraryId];
  if (!entry?.pending || entry.view !== sent) return;
  const next = { ...all };
  if (isEmptyFilters(sent)) delete next[libraryId];
  else next[libraryId] = { view: sent };
  replace(account, next);
}

/** Saves the selection here at once, then on the server; a refused or failed write waits for the next load. */
export function setLibraryView(libraryId: string, filters: LibraryFilters): void {
  const account = accountKey();
  const all = views();
  if (isEmptyFilters(filters) && !all[libraryId]) return;
  replace(account, { ...all, [libraryId]: { view: filters, pending: true } });
  notify();
  if (!account) return;
  void (async () => {
    try {
      if (await serverWritable(account)) await push(libraryId, filters, await owner());
      markSent(account, libraryId, filters);
    } catch (error) {
      if (error instanceof Error && /: 403$/.test(error.message)) {
        localOnly.add(account);
        markSent(account, libraryId, filters);
        return;
      }
      logger.warn("Library view save waits for the server", error, { service: "LibraryViews", libraryId });
    }
  })();
}

export function clearLibraryView(libraryId: string): void {
  setLibraryView(libraryId, EMPTY_FILTERS);
}

/**
 * Reads the server's copy once per library and account, after sending up a save that waited here.
 * The server's selection replaces the device's, unless a newer save is still waiting to go up.
 */
export async function loadLibraryView(libraryId: string): Promise<void> {
  const account = accountKey();
  if (!account) return;
  const loadKey = `${account}|${libraryId}`;
  if (loaded.has(loadKey)) return;
  loaded.add(loadKey);
  try {
    if (!(await serverWritable(account))) return;
    const bound = await owner();
    const waiting = views()[libraryId];
    if (waiting?.pending) {
      await push(libraryId, waiting.view, bound);
      markSent(account, libraryId, waiting.view);
    }
    const prefs = await getDisplayPreferences(libraryId, THEMES_CLIENT, bound);
    if (accountKey() !== account) return;
    const raw = prefs.CustomPrefs?.[VIEW_PREF_KEY];
    const remote = raw ? parseLibraryFilters(raw) : EMPTY_FILTERS;
    const local = views()[libraryId];
    if (local?.pending || JSON.stringify(local?.view ?? EMPTY_FILTERS) === JSON.stringify(remote)) return;
    const next = { ...views() };
    if (isEmptyFilters(remote)) delete next[libraryId];
    else next[libraryId] = { view: remote };
    replace(account, next);
    notify();
  } catch (error) {
    // The next launch reads again; until then the device's copy stands.
    loaded.delete(loadKey);
    if (error instanceof Error && /: 403$/.test(error.message)) localOnly.add(account);
    else logger.warn("Library view read failed", error, { service: "LibraryViews", libraryId });
  }
}

/** Test seam: forgets what this session read and which accounts stay local. */
export function resetLibraryViewsForTests(): void {
  current = null;
  currentAccount = "";
  loaded.clear();
  localOnly.clear();
}
