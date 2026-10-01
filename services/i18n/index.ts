/**
 * The app's language.
 *
 * No dependency: react-native's own SettingsManager carries the device's
 * AppleLocale and AppleLanguages, which is what expo-localization reads too.
 * The tag is reduced to its base ("de-DE" and "de-AT" are both "de"), because
 * the store lists one German, one French and one Spanish.
 *
 * The viewer's pick in Settings wins over the device; without one the device decides. Both are
 * read synchronously at import, so the first frame is already in the right language, and a pick
 * notifies subscribers (components/locale-boundary.tsx) so the screens redraw in place.
 */
import { NativeModules, Platform, Settings } from "react-native";

import { logger } from "@/utils/logger";

import { catalogues, en, type StringKey } from "./strings";

export const SUPPORTED_LOCALES = ["en", "de", "fr", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Each language in its own words, the way a picker lists them. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", fr: "Français", es: "Español" };

export const LANGUAGE_KEY = "app_language";

const FALLBACK: Locale = "en";

function baseTag(tag: string | undefined | null): string {
  return String(tag ?? "")
    .replace(/_/g, "-")
    .split("-")[0]
    .toLowerCase();
}

/** What the device is set to, or "" when the module is absent (tests, web). */
function deviceTag(): string {
  if (Platform.OS !== "ios") return "";
  const manager = NativeModules?.SettingsManager;
  // New Architecture: constants live behind getConstants(), not flat on the module.
  const settings = manager?.getConstants?.().settings ?? manager?.settings;
  const languages = settings?.AppleLanguages;
  return baseTag(Array.isArray(languages) && languages.length > 0 ? languages[0] : settings?.AppleLocale);
}

function supported(tag: string): Locale | null {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag) ? (tag as Locale) : null;
}

/** A tag in any spelling ("de-AT", "fr_CA") as a language the app ships, or null. */
export function supportedLocale(tag: string | undefined | null): Locale | null {
  return supported(baseTag(tag));
}

function storedChoice(): Locale | null {
  const stored = Settings.get(LANGUAGE_KEY);
  return typeof stored === "string" ? supportedLocale(stored) : null;
}

const system: Locale = supported(deviceTag()) ?? FALLBACK;
let choice: Locale | null = storedChoice();
let active: Locale = choice ?? system;
const listeners = new Set<() => void>();

/** The language the app is rendering in. */
export function locale(): Locale {
  return active;
}

/** The language the device asks for, as the app resolves it: the default when nothing is picked. */
export function systemLocale(): Locale {
  return system;
}

/** The viewer's pick, or null while the app follows the device. */
export function languageChoice(): Locale | null {
  return choice;
}

/**
 * One string, in the active language.
 *
 * A catalogue that does not carry the key falls back to English rather than
 * showing a key name: a missing translation is a smaller failure than "tab.home"
 * on screen, and it is the state every locale is in while it is being filled.
 */
export function t(key: StringKey): string {
  return catalogues[active]?.[key] ?? en[key];
}

/** Picks a language, or null to follow the device again; persisted, then every subscriber redraws. */
export function setLanguage(next: Locale | null): void {
  if (next === choice) return;
  choice = next;
  try {
    Settings.set({ [LANGUAGE_KEY]: next });
  } catch (error) {
    logger.warn("Language choice not persisted", error, { service: "i18n" });
  }
  active = next ?? system;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: sets the rendered language without a pick or a redraw. */
export function __setLocaleForTests(tag: Locale): void {
  active = tag;
}
