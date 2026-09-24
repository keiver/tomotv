/**
 * The viewer's audio language, remembered across items in the account's Jellyfin settings.
 * Language is the key because an index means nothing on the next item.
 */
import { getTrackSettingsSync, readTrackSettings, recordAudioPick, type TrackSettings } from "@/services/jellyfin/trackSettings";
import { canonicalLanguage } from "@/services/subtitlePreference";

type AudioStream = { Index: number; Language: string; IsDefault?: boolean };

/** ISO 639-2 codes that name no language, plus Jellyfin's "Unknown". */
const NOT_A_LANGUAGE = new Set(["und", "unknown", "mul", "mis", "zxx"]);

/** One spelling of a language worth storing, or null for a tag no other item could match. */
export function audioLanguageToStore(tag: string | null | undefined): string | null {
  const canonical = canonicalLanguage(tag ?? "");
  return canonical && !NOT_A_LANGUAGE.has(canonical) ? canonical : null;
}

/** The stream carrying the stored language, the file's default among several, else the first. */
export function preferredAudioStreamIndex(tracks: AudioStream[], tag: string | null): number | null {
  const wanted = audioLanguageToStore(tag);
  if (!wanted) return null;
  const matches = tracks.filter((track) => canonicalLanguage(track.Language) === wanted);
  return (matches.find((track) => track.IsDefault) ?? matches[0])?.Index ?? null;
}

// MARK: - Storage

/** Jellyfin's rule: while it prefers the file's default track, no language is remembered. */
export function rememberedAudioLanguage(settings: TrackSettings): string | null {
  if (settings.playDefaultAudio || settings.audioLanguage?.toLowerCase() === "originallanguage") return null;
  return audioLanguageToStore(settings.audioLanguage);
}

/** For report callbacks, which cannot await. */
export function getAudioPreferenceSync(): string | null {
  return rememberedAudioLanguage(getTrackSettingsSync());
}

/** At item start: waits briefly for the refresh the item kicked off. */
export async function readAudioPreference(): Promise<string | null> {
  return rememberedAudioLanguage(await readTrackSettings());
}

/** `language` is Jellyfin's spelling of the stream's language, the one its settings expect. */
export function saveAudioPreference(language: string): void {
  if (audioLanguageToStore(language)) recordAudioPick(language);
}
