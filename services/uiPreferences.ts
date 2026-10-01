/**
 * The viewer's interface choices: one JSON document in the device's defaults, apart from any
 * server or account.
 */
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const UI_PREFERENCES_KEY = "app_ui_preferences";

export interface UiPreferences {
  version: 1;
  /** Cards the server left without a poster wear a keyframe the engine grabbed from the file. */
  devicePosters: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = { version: 1, devicePosters: false };

let current: UiPreferences | null = null;
const listeners = new Set<() => void>();

/** Every field falls back to its default on its own, so a document from another build still reads. */
export function parseUiPreferences(raw: unknown): UiPreferences {
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      doc = null;
    }
  }
  const source = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  return { version: 1, devicePosters: source.devicePosters === true };
}

export function getUiPreferences(): UiPreferences {
  if (!current) current = parseUiPreferences(Settings.get(UI_PREFERENCES_KEY));
  return current;
}

export function updateUiPreferences(patch: Partial<Omit<UiPreferences, "version">>): void {
  current = { ...getUiPreferences(), ...patch };
  try {
    Settings.set({ [UI_PREFERENCES_KEY]: JSON.stringify(current) });
  } catch (error) {
    logger.warn("UI preferences write failed", error, { service: "UiPreferences" });
  }
  for (const listener of listeners) listener();
}

export function subscribeUiPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
