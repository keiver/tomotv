/**
 * The app's user-visible strings, one JSON catalogue per language.
 *
 * English is the shape: every other catalogue is `Partial<Strings>` and a key it
 * does not carry falls back rather than rendering a key name at a viewer. Adding
 * a string means adding it to locales/en.json, since the type is derived.
 *
 * Vocabulary comes from applestore/l10n-glossary.json, which is Jellyfin's own
 * translations for the product nouns and Apple's for the platform ones, so the
 * app and the store listing say the same words.
 */
import deCatalogue from "./locales/de.json";
import enCatalogue from "./locales/en.json";
import esCatalogue from "./locales/es.json";
import frCatalogue from "./locales/fr.json";

export const en = enCatalogue;

export type StringKey = keyof typeof en;
export type Catalogue = Partial<Record<StringKey, string>>;

export const de: Catalogue = deCatalogue;
export const fr: Catalogue = frCatalogue;
export const es: Catalogue = esCatalogue;

export const catalogues: Record<string, Catalogue> = { en, de, fr, es };
