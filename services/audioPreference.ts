/**
 * The viewer's audio language, remembered across items in the account's Jellyfin settings.
 * The pick rules live in the engine package (@keiver/tomo-engine, trackLanguage.ts).
 */
import { getTrackSettingsSync, readTrackSettings, recordAudioPick, type TrackSettings } from "@/services/jellyfin/trackSettings";
import { audioLanguageToStore } from "@keiver/tomo-engine";

export { audioLanguageToStore, preferredAudioIndexIn, preferredAudioStreamIndex } from "@keiver/tomo-engine";

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
