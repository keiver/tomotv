/**
 * subtitlePreference.ts
 *
 * The viewer's subtitle choice, remembered across items.
 *
 * Why this exists: the app never set `selectedTextTrack`, so react-native-video
 * applied its default criteria on every load, `{type: "none"}`, which falls
 * through RCTPlayerOperations to `selectMediaOptionAutomatically(in:)`.
 * Automatic selection is driven by AVPlayer.mediaSelectionCriteria for .legible,
 * which nothing ever set, so it fell back to system defaults and resolved to
 * Off. The pick itself is per-AVPlayerItem state and `<Video key={sourceUri}>`
 * remounts the player per item, so turning subtitles on never survived to the
 * next video.
 *
 * The native mechanism was being invoked but never configured. This supplies it:
 * a language-keyed preference fed back as `selectedTextTrack`, which seeds AVKit's
 * own picker rather than replacing it. It lives in the account's Jellyfin settings
 * (services/jellyfin/trackSettings.ts), so every device signed in as the user shares it.
 *
 * The pick rules live in the engine package (@keiver/tomo-engine, trackLanguage.ts).
 */
import { getTrackSettingsSync, recordSubtitlePick, type TrackSettings } from "@/services/jellyfin/trackSettings";
import { canonicalLanguage, knownLanguage, type SubtitlePreference } from "@keiver/tomo-engine";

export {
  canonicalLanguage,
  knownLanguage,
  nextPreference,
  observedFromReport,
  reportedSpelling,
  sameSubtitlePreference,
  selectedTextTrackFor,
  subtitleShownFor,
  type ObservedSubtitle,
  type ReportedTrack,
  type SelectedTextTrack,
  type SubtitlePreference,
} from "@keiver/tomo-engine";

const SYSTEM: SubtitlePreference = { kind: "system" };

/**
 * The account's Jellyfin subtitle settings as a preference. Smart shows the preferred language only
 * under audio known to be in another language, else automatic selection, which covers forced ones.
 */
export function subtitlePreferenceFrom(settings: TrackSettings, playingAudioLanguage?: string | null): SubtitlePreference {
  const tag = settings.subtitleLanguage;
  const audio = knownLanguage(playingAudioLanguage);
  if (settings.subtitleMode === "None") return { kind: "off" };
  if (settings.subtitleMode === "Always" && tag) return { kind: "language", tag };
  if (settings.subtitleMode === "Smart" && tag && audio && audio !== canonicalLanguage(tag)) return { kind: "language", tag };
  return SYSTEM;
}

/** Synchronous: the player prop has to be stable at render. */
export function getSubtitlePreferenceSync(playingAudioLanguage?: string | null): SubtitlePreference {
  return subtitlePreferenceFrom(getTrackSettingsSync(), playingAudioLanguage);
}

/** `tag` is Jellyfin's spelling of the stream's language, the one its settings expect. */
export async function saveSubtitlePreference(preference: SubtitlePreference): Promise<void> {
  if (preference.kind !== "system") recordSubtitlePick(preference);
}
