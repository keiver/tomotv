/**
 * The app's language.
 *
 * No dependency: react-native's own SettingsManager carries the device's
 * AppleLocale and AppleLanguages, which is what expo-localization reads too.
 * The tag is reduced to its base ("de-DE" and "de-AT" are both "de"), because
 * the store lists one German, one French and one Spanish.
 *
 * Resolved once, at import. A language change on the device restarts the app,
 * and the screenshot pipeline relaunches it per locale (tomotv://dev-locale).
 */
import { NativeModules, Platform } from "react-native";

import { STORAGE_KEYS } from "@/services/jellyfin/constants";
import { logger } from "@/utils/logger";

import { catalogues, en, type StringKey } from "./strings";

export const SUPPORTED_LOCALES = ["en", "de", "fr", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

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

let active: Locale = supported(deviceTag()) ?? FALLBACK;

/** The language the app is rendering in. */
export function locale(): Locale {
  return active;
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

/**
 * Force a language, for the screenshot pipeline: the captures under each store
 * locale have to show that locale's UI, or the listing shows a German caption
 * over an English app. Dev builds only, and it persists so the capture script
 * can set it once and deep-link every screen after.
 */
export async function setLocaleOverride(tag: string): Promise<Locale | null> {
  const picked = supported(baseTag(tag));
  if (!picked) {
    logger.warn("Locale override ignored, not a supported language", { service: "i18n", tag });
    return null;
  }
  active = picked;
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(STORAGE_KEYS.LOCALE_OVERRIDE, picked);
  } catch (error) {
    logger.warn("Locale override not persisted", error, { service: "i18n" });
  }
  return picked;
}

/** Restores an override across the relaunch the capture script does per screen. */
export async function loadLocaleOverride(): Promise<void> {
  if (!__DEV__) return;
  try {
    const SecureStore = await import("expo-secure-store");
    const stored = await SecureStore.getItemAsync(STORAGE_KEYS.LOCALE_OVERRIDE);
    const picked = stored ? supported(baseTag(stored)) : null;
    if (picked) active = picked;
  } catch {
    // A locked device throws here; the device language is the right answer then.
  }
}

/** Test seam: the module resolves the language once, at import. */
export function __setLocaleForTests(tag: Locale): void {
  active = tag;
}
