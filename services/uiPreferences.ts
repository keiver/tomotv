/**
 * The viewer's choices for this device: one JSON document in the device's defaults, apart from any
 * server or account.
 */
import { type CardTheme, DEFAULT_CARD_THEME, parseCardTheme } from "@/services/cardTheme";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const UI_PREFERENCES_KEY = "app_ui_preferences";

/** What the server may be asked to transcode: a slow link and unplayable files, unplayable files only, nothing. */
export type ServerTranscoding = "linkOrFile" | "fileOnly" | "never";
export const SERVER_TRANSCODING_LEVELS: readonly ServerTranscoding[] = ["linkOrFile", "fileOnly", "never"];

export interface UiPreferences {
  version: 1;
  /** Cards the server left without a poster wear a keyframe the engine grabbed from the file. */
  devicePosters: boolean;
  /** The server's own per-user permission caps every level (services/transcodePolicy.ts). */
  serverTranscoding: ServerTranscoding;
  /** A copy of the chosen theme, so the cards draw it from the first frame, offline, or after it was deleted elsewhere. */
  cardTheme: CardTheme;
  /** The canvas behind every screen: folder artwork over the light, the theme's tint on it, or the clear light alone. */
  background: BackgroundMode;
  /** The music player follows a song's lyrics. */
  showLyrics: boolean;
  /** A song the server has no lyrics for is looked up on lrclib.net. */
  findLyrics: boolean;
  /** The device listens to a song to time its words, or to write lyrics for one that has none. */
  listenForLyrics: boolean;
  /** Lyrics found for a song are saved to the Jellyfin server, where the account may. */
  saveLyrics: boolean;
  /** Which of the server's Media Segments playback seeks past on its own. */
  autoSkip: AutoSkip;
}

export type BackgroundMode = "clear" | "accent" | "artwork";
export const BACKGROUND_MODES: readonly BackgroundMode[] = ["artwork", "accent", "clear"];

export type AutoSkipKind = "intro" | "recap" | "preview" | "commercial";
export const AUTO_SKIP_KINDS: readonly AutoSkipKind[] = ["intro", "recap", "preview", "commercial"];
export type AutoSkip = Record<AutoSkipKind, boolean>;

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  devicePosters: true,
  serverTranscoding: "linkOrFile",
  cardTheme: DEFAULT_CARD_THEME,
  background: "artwork",
  showLyrics: true,
  findLyrics: true,
  listenForLyrics: true,
  saveLyrics: true,
  autoSkip: { intro: false, recap: false, preview: false, commercial: true },
};

/** Before this document carried autoSkip, the commercial switch lived in the live TV preferences. */
const LIVE_TV_PREFERENCES_KEY = "app_live_tv_preferences";

let current: UiPreferences | null = null;
const listeners = new Set<() => void>();

function parseAutoSkip(raw: unknown, legacyCommercial: boolean | undefined): AutoSkip {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const parsed = { ...DEFAULT_UI_PREFERENCES.autoSkip };
  if (!source) {
    if (typeof legacyCommercial === "boolean") parsed.commercial = legacyCommercial;
    return parsed;
  }
  for (const kind of AUTO_SKIP_KINDS) {
    if (typeof source[kind] === "boolean") parsed[kind] = source[kind] as boolean;
  }
  return parsed;
}

/**
 * Every field falls back to its default on its own, so a document from another build still reads.
 * `legacySkipCommercials` is the live TV document's switch, read only when this document has no autoSkip.
 */
export function parseUiPreferences(raw: unknown, legacySkipCommercials?: boolean): UiPreferences {
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      doc = null;
    }
  }
  const source = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  return {
    version: 1,
    devicePosters: typeof source.devicePosters === "boolean" ? source.devicePosters : DEFAULT_UI_PREFERENCES.devicePosters,
    serverTranscoding: SERVER_TRANSCODING_LEVELS.includes(source.serverTranscoding as ServerTranscoding) ? (source.serverTranscoding as ServerTranscoding) : DEFAULT_UI_PREFERENCES.serverTranscoding,
    cardTheme: parseCardTheme(source.cardTheme) ?? DEFAULT_UI_PREFERENCES.cardTheme,
    // Earlier documents: the mode's first name for clear, and before the mode, the retired
    // folder-colour switch, whose "off" meant the clear light.
    background: BACKGROUND_MODES.includes(source.background as BackgroundMode)
      ? (source.background as BackgroundMode)
      : source.background === "tomo" || source.folderTint === false
        ? "clear"
        : DEFAULT_UI_PREFERENCES.background,
    showLyrics: typeof source.showLyrics === "boolean" ? source.showLyrics : DEFAULT_UI_PREFERENCES.showLyrics,
    findLyrics: typeof source.findLyrics === "boolean" ? source.findLyrics : DEFAULT_UI_PREFERENCES.findLyrics,
    listenForLyrics: typeof source.listenForLyrics === "boolean" ? source.listenForLyrics : DEFAULT_UI_PREFERENCES.listenForLyrics,
    saveLyrics: typeof source.saveLyrics === "boolean" ? source.saveLyrics : DEFAULT_UI_PREFERENCES.saveLyrics,
    autoSkip: parseAutoSkip(source.autoSkip, legacySkipCommercials),
  };
}

function legacySkipCommercials(): boolean | undefined {
  try {
    const raw = Settings.get(LIVE_TV_PREFERENCES_KEY);
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    const value = doc && typeof doc === "object" ? (doc as Record<string, unknown>).skipCommercials : undefined;
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

function persist(preferences: UiPreferences): void {
  try {
    Settings.set({ [UI_PREFERENCES_KEY]: JSON.stringify(preferences) });
  } catch (error) {
    logger.warn("UI preferences write failed", error, { service: "UiPreferences" });
  }
}

export function getUiPreferences(): UiPreferences {
  if (!current) {
    const legacy = legacySkipCommercials();
    current = parseUiPreferences(Settings.get(UI_PREFERENCES_KEY), legacy);
    if (legacy === false) persist(current);
  }
  return current;
}

export function updateUiPreferences(patch: Partial<Omit<UiPreferences, "version">>): void {
  current = { ...getUiPreferences(), ...patch };
  persist(current);
  for (const listener of listeners) listener();
}

export function subscribeUiPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
