/**
 * The languages a subtitle can be searched in, in the spellings each provider takes: ISO 639-1
 * for OpenSubtitles, ISO 639-2/T for the Jellyfin server. The native name is what the chip row
 * shows.
 */
import { canonicalLanguage, knownLanguage } from "@keiver/tomo-engine";
import type { JellyfinVideoItem } from "@/types/jellyfin";

export interface SubtitleLanguage {
  /** ISO 639-1. */
  code: string;
  /** ISO 639-2/T. */
  code3: string;
  english: string;
  native: string;
}

export const ALL_LANGUAGES: readonly SubtitleLanguage[] = [
  { code: "en", code3: "eng", english: "English", native: "English" },
  { code: "es", code3: "spa", english: "Spanish", native: "Español" },
  { code: "fr", code3: "fra", english: "French", native: "Français" },
  { code: "de", code3: "deu", english: "German", native: "Deutsch" },
  { code: "it", code3: "ita", english: "Italian", native: "Italiano" },
  { code: "pt", code3: "por", english: "Portuguese", native: "Português" },
  { code: "nl", code3: "nld", english: "Dutch", native: "Nederlands" },
  { code: "sv", code3: "swe", english: "Swedish", native: "Svenska" },
  { code: "da", code3: "dan", english: "Danish", native: "Dansk" },
  { code: "no", code3: "nor", english: "Norwegian", native: "Norsk" },
  { code: "fi", code3: "fin", english: "Finnish", native: "Suomi" },
  { code: "is", code3: "isl", english: "Icelandic", native: "Íslenska" },
  { code: "pl", code3: "pol", english: "Polish", native: "Polski" },
  { code: "cs", code3: "ces", english: "Czech", native: "Čeština" },
  { code: "sk", code3: "slk", english: "Slovak", native: "Slovenčina" },
  { code: "hu", code3: "hun", english: "Hungarian", native: "Magyar" },
  { code: "ro", code3: "ron", english: "Romanian", native: "Română" },
  { code: "bg", code3: "bul", english: "Bulgarian", native: "Български" },
  { code: "el", code3: "ell", english: "Greek", native: "Ελληνικά" },
  { code: "tr", code3: "tur", english: "Turkish", native: "Türkçe" },
  { code: "ru", code3: "rus", english: "Russian", native: "Русский" },
  { code: "uk", code3: "ukr", english: "Ukrainian", native: "Українська" },
  { code: "sr", code3: "srp", english: "Serbian", native: "Srpski" },
  { code: "hr", code3: "hrv", english: "Croatian", native: "Hrvatski" },
  { code: "sl", code3: "slv", english: "Slovenian", native: "Slovenščina" },
  { code: "bs", code3: "bos", english: "Bosnian", native: "Bosanski" },
  { code: "mk", code3: "mkd", english: "Macedonian", native: "Македонски" },
  { code: "sq", code3: "sqi", english: "Albanian", native: "Shqip" },
  { code: "lt", code3: "lit", english: "Lithuanian", native: "Lietuvių" },
  { code: "lv", code3: "lav", english: "Latvian", native: "Latviešu" },
  { code: "et", code3: "est", english: "Estonian", native: "Eesti" },
  { code: "he", code3: "heb", english: "Hebrew", native: "עברית" },
  { code: "ar", code3: "ara", english: "Arabic", native: "العربية" },
  { code: "fa", code3: "fas", english: "Persian", native: "فارسی" },
  { code: "hi", code3: "hin", english: "Hindi", native: "हिन्दी" },
  { code: "bn", code3: "ben", english: "Bengali", native: "বাংলা" },
  { code: "ta", code3: "tam", english: "Tamil", native: "தமிழ்" },
  { code: "te", code3: "tel", english: "Telugu", native: "తెలుగు" },
  { code: "ml", code3: "mal", english: "Malayalam", native: "മലയാളം" },
  { code: "ur", code3: "urd", english: "Urdu", native: "اردو" },
  { code: "th", code3: "tha", english: "Thai", native: "ไทย" },
  { code: "vi", code3: "vie", english: "Vietnamese", native: "Tiếng Việt" },
  { code: "id", code3: "ind", english: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", code3: "msa", english: "Malay", native: "Bahasa Melayu" },
  { code: "tl", code3: "tgl", english: "Tagalog", native: "Tagalog" },
  { code: "zh", code3: "zho", english: "Chinese", native: "中文" },
  { code: "ja", code3: "jpn", english: "Japanese", native: "日本語" },
  { code: "ko", code3: "kor", english: "Korean", native: "한국어" },
  { code: "ca", code3: "cat", english: "Catalan", native: "Català" },
  { code: "eu", code3: "eus", english: "Basque", native: "Euskara" },
  { code: "gl", code3: "glg", english: "Galician", native: "Galego" },
  { code: "ga", code3: "gle", english: "Irish", native: "Gaeilge" },
  { code: "cy", code3: "cym", english: "Welsh", native: "Cymraeg" },
  { code: "af", code3: "afr", english: "Afrikaans", native: "Afrikaans" },
  { code: "sw", code3: "swa", english: "Swahili", native: "Kiswahili" },
  { code: "ka", code3: "kat", english: "Georgian", native: "ქართული" },
  { code: "hy", code3: "hye", english: "Armenian", native: "Հայերեն" },
  { code: "az", code3: "aze", english: "Azerbaijani", native: "Azərbaycanca" },
  { code: "kk", code3: "kaz", english: "Kazakh", native: "Қазақша" },
  { code: "mn", code3: "mon", english: "Mongolian", native: "Монгол" },
];

const BY_CODE = new Map(ALL_LANGUAGES.map((language) => [language.code, language]));
const BY_CODE3 = new Map(ALL_LANGUAGES.map((language) => [language.code3, language]));
const BY_ENGLISH = new Map(ALL_LANGUAGES.map((language) => [language.english.toLowerCase(), language]));

/** The table row for any spelling (ISO 639-1, 639-2, a BCP 47 tag, an English name), or null. */
export function languageFor(tag: string | null | undefined): SubtitleLanguage | null {
  if (!tag) return null;
  const canonical = knownLanguage(tag);
  if (canonical) {
    const row = BY_CODE.get(canonical) ?? BY_CODE3.get(canonical);
    if (row) return row;
  }
  return BY_ENGLISH.get(tag.trim().toLowerCase()) ?? null;
}

/** The two-letter code a language is stored and compared by, or null for a spelling the table lacks. */
export function languageCode(tag: string | null | undefined): string | null {
  return languageFor(tag)?.code ?? null;
}

export interface LanguageChoiceInput {
  item: Pick<JellyfinVideoItem, "MediaStreams">;
  /** The account's standing subtitle language, if any. */
  stored: string | null;
  /** The device's languages, most preferred first. */
  deviceTags: readonly string[];
}

/**
 * The chips: the account's language, the device's, the film's audio languages, then English. One
 * entry per language, in that order, so the first chip is the one most likely wanted.
 */
export function languageChoices(input: LanguageChoiceInput): SubtitleLanguage[] {
  const audio = (input.item.MediaStreams ?? []).filter((stream) => stream.Type === "Audio").map((stream) => stream.Language ?? "");
  const ordered = [input.stored ?? "", ...input.deviceTags, ...audio, "en"];
  const chosen: SubtitleLanguage[] = [];
  for (const tag of ordered) {
    const row = languageFor(tag);
    if (row && !chosen.some((existing) => existing.code === row.code)) chosen.push(row);
  }
  return chosen;
}

/** Whether a stream's language tag names the given two-letter code. */
export function sameLanguage(tag: string | null | undefined, code: string): boolean {
  return !!tag && canonicalLanguage(tag) === canonicalLanguage(code);
}
