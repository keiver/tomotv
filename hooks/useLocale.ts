import { languageChoice, locale, subscribeLocale, type Locale } from "@/services/i18n";
import { useSyncExternalStore } from "react";

/** The language the app renders in, following every pick. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, locale);
}

/** The viewer's pick, null while the app follows the device. */
export function useLanguageChoice(): Locale | null {
  return useSyncExternalStore(subscribeLocale, languageChoice);
}
