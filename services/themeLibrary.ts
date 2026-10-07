/**
 * The viewer's own themes, kept as one JSON list in the user's display preferences on the Jellyfin
 * server, so every device signed in as that user shows them. A save the server does not take waits
 * on this device, per account, and goes up with the next load.
 */
import { type CardTheme, parseCardTheme } from "@/services/cardTheme";
import { editDisplayPreferences, getConfig, getDisplayPreferences } from "@/services/jellyfinApi";
import type { PreferencesOwner } from "@/services/jellyfin/displayPreferences";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const THEMES_ID = "tomotv-themes";
export const THEMES_CLIENT = "Tomo TV";
export const THEMES_KEY = "themes";
export const PENDING_THEMES_KEY = "app_pending_themes";

export interface SavedThemes {
  /** What the server holds. */
  themes: CardTheme[];
  /** Saved here, not yet on the server. */
  pending: CardTheme[];
}

/** The server's list, skipping any entry this build cannot read; the first of a repeated id wins. */
export function parseThemeList(raw: unknown): CardTheme[] {
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const list = doc && typeof doc === "object" ? (doc as { themes?: unknown }).themes : null;
  if (!Array.isArray(list)) return [];
  const themes: CardTheme[] = [];
  for (const entry of list) {
    const theme = parseCardTheme(entry);
    if (theme && !themes.some((kept) => kept.id === theme.id)) themes.push(theme);
  }
  return themes;
}

export function serializeThemeList(themes: readonly CardTheme[]): string {
  return JSON.stringify({ v: 1, themes });
}

/** Replaces the theme with the same id in place, else appends it. */
export function upsertTheme(themes: readonly CardTheme[], theme: CardTheme): CardTheme[] {
  return themes.some((kept) => kept.id === theme.id) ? themes.map((kept) => (kept.id === theme.id ? theme : kept)) : [...themes, theme];
}

/** The signed-in account: its pending-list key, and the owner its server writes are bound to. */
async function currentAccount(): Promise<{ key: string; owner: PreferencesOwner }> {
  const { server, userId } = await getConfig();
  return { key: `${server}|${userId}`, owner: { server: server ?? "", userId: userId ?? "" } };
}

function readPending(account: string): CardTheme[] {
  try {
    const all = JSON.parse((Settings.get(PENDING_THEMES_KEY) as string | undefined) ?? "{}") as Record<string, unknown>;
    return parseThemeList({ themes: all[account] });
  } catch {
    return [];
  }
}

function writePending(account: string, themes: CardTheme[]): void {
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse((Settings.get(PENDING_THEMES_KEY) as string | undefined) ?? "{}") as Record<string, unknown>;
  } catch {
    all = {};
  }
  if (themes.length > 0) all[account] = themes;
  else delete all[account];
  Settings.set({ [PENDING_THEMES_KEY]: JSON.stringify(all) });
}

/** Merges `changes` into the server's list in one read and write; `remove` drops ids first. */
function pushThemes(owner: PreferencesOwner, changes: readonly CardTheme[], remove: readonly string[] = []): Promise<void> {
  return editDisplayPreferences(
    THEMES_ID,
    THEMES_CLIENT,
    (current) => {
      const kept = parseThemeList(current[THEMES_KEY]).filter((theme) => !remove.includes(theme.id));
      return { ...current, [THEMES_KEY]: serializeThemeList(changes.reduce(upsertTheme, kept)) };
    },
    owner,
  );
}

/** The server's list could not be read for the account the load began under: its waiting themes, and those this load uploaded. */
export class ThemesUnavailableError extends Error {
  constructor(
    readonly pending: CardTheme[],
    readonly uploaded: CardTheme[] = [],
  ) {
    super("The saved themes could not be read from the server.");
  }
}

/** The server's themes, after sending up any this device saved while the server was out of reach. Every read
 *  and write is bound to the account the load began under; a failed read throws ThemesUnavailableError. */
export async function loadThemes(): Promise<SavedThemes> {
  const { key: account, owner } = await currentAccount();
  const pending = readPending(account);
  let uploaded: CardTheme[] = [];
  if (pending.length > 0) {
    try {
      await pushThemes(owner, pending);
      writePending(account, []);
      uploaded = pending;
    } catch (error) {
      logger.warn("Pending themes did not reach the server", error, { service: "ThemeLibrary" });
    }
  }
  let prefs: Awaited<ReturnType<typeof getDisplayPreferences>>;
  try {
    prefs = await getDisplayPreferences(THEMES_ID, THEMES_CLIENT, owner);
  } catch {
    throw new ThemesUnavailableError(readPending(account), uploaded);
  }
  // A waiting save is newer than the server's copy of the same theme.
  const waiting = readPending(account);
  const themes = parseThemeList(prefs.CustomPrefs?.[THEMES_KEY]).filter((theme) => !waiting.some((kept) => kept.id === theme.id));
  return { themes, pending: waiting };
}

const listeners = new Set<() => void>();
let saving = 0;

/** A save is on its way: a list read meanwhile may still hold the theme as it was. */
export function themeSaveInFlight(): boolean {
  return saving > 0;
}

/** Told after every save and delete settles: the editor saves as it closes, after the list has read. */
export function subscribeThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** "synced" once the server took it; "pending" when it waits on this device for the next load. */
export async function saveTheme(theme: CardTheme): Promise<"synced" | "pending"> {
  saving += 1;
  try {
    const { key: account, owner } = await currentAccount();
    try {
      await pushThemes(owner, [theme]);
      writePending(
        account,
        readPending(account).filter((kept) => kept.id !== theme.id),
      );
      return "synced";
    } catch (error) {
      logger.warn("Theme save waits for the server", error, { service: "ThemeLibrary" });
      writePending(account, upsertTheme(readPending(account), theme));
      return "pending";
    }
  } finally {
    saving -= 1;
    notify();
  }
}

/** Throws when the server refuses the write; a delete is never queued. */
export async function deleteTheme(id: string): Promise<void> {
  const { key: account, owner } = await currentAccount();
  writePending(
    account,
    readPending(account).filter((kept) => kept.id !== id),
  );
  try {
    await pushThemes(owner, [], [id]);
  } finally {
    notify();
  }
}
