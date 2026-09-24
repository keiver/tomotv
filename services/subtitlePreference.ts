/**
 * subtitlePreference.ts
 *
 * The viewer's subtitle choice, remembered across items.
 *
 * Why this exists: the app never set `selectedTextTrack`, so react-native-video
 * applied its default criteria on every load — `{type: "none"}`, which falls
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
 * Language is the key rather than a track index, because an index means nothing
 * on the next item. RCTPlayerOperations matches `extendedLanguageTag` exactly, which
 * is the playlist's LANGUAGE on both HLS lanes (`eng`) and 639-1 in an MP4 (`en`), so
 * the item's own spelling is applied (planSubtitleApplication).
 */
import { getTrackSettingsSync, recordSubtitlePick, type TrackSettings } from "@/services/jellyfin/trackSettings";

/**
 * What the viewer last settled on.
 *
 * `system` is the unset state and is deliberately NOT the same as `off`: it maps
 * to react-native-video's `"system"` selection type, which is the same automatic
 * path the lib already takes by default. Keeping it distinct is what makes a
 * fresh install behave exactly as it does today — and the initial automatic pick
 * is load-bearing, since the bitmap subtitle overlay reads whatever the
 * playlist's DEFAULT=YES rendition resolved to (see RNVideoPlugin.swift).
 */
export type SubtitlePreference = { kind: "system" } | { kind: "off" } | { kind: "language"; tag: string };

/** What a player report says is on screen right now. */
export type ObservedSubtitle = { kind: "off" } | { kind: "language"; tag: string };

/** The `selectedTextTrack` prop shape react-native-video accepts. */
export type SelectedTextTrack = { type: "system" } | { type: "disabled" } | { type: "language"; value: string };

const SYSTEM: SubtitlePreference = { kind: "system" };

/** A subtitle track as the player reports it, reduced to what this file needs. */
export type ReportedTrack = { language?: string; selected?: boolean };

/**
 * What a player report actually says about the viewer's intent, or null when it
 * says nothing.
 *
 * "Nothing selected" is the dangerous case, because it has two completely
 * different causes and only one of them is a choice:
 *
 *  - The viewer turned subtitles off. A real preference.
 *  - There was nothing to select. A file with no subtitle tracks at all, or none
 *    in the preferred language, reports nothing selected because AVFoundation
 *    found no match, not because anybody asked for that. Reading it as a choice
 *    means one Spanish-only episode wipes a standing English preference, and
 *    every subtitle-less video in the library does the same.
 *
 * So an empty selection only counts when the preference it was applied against
 * was actually available to turn off.
 */
export function observedFromReport(args: { tracks: ReportedTrack[]; applied: SubtitlePreference; renditionLanguage?: string }): ObservedSubtitle | null {
  const { tracks, applied, renditionLanguage } = args;
  if (tracks.length === 0) return null;

  const chosen = tracks.find((track) => track.selected === true);
  if (chosen) return { kind: "language", tag: renditionLanguage || chosen.language || "und" };

  if (applied.kind === "language" && !tracks.some((track) => (track.language || "") === applied.tag)) return null;
  return { kind: "off" };
}

/**
 * Turn a preference into the player prop.
 *
 * Note what `language` costs: RCTPlayerOperations leaves `mediaOption` nil when
 * no option matches and then calls `select(nil, in:)`, so an item with no track
 * in the preferred language gets subtitles switched OFF rather than falling back
 * to automatic. That is the right reading of an explicit preference, but it is a
 * real difference from `system`.
 */
/**
 * ISO 639-2/B codes, which AVFoundation reports where Jellyfin gives 639-2/T. A file's own
 * tag survives into the container, so both spellings of one language reach us.
 */
const BIBLIOGRAPHIC: Record<string, string> = {
  alb: "sqi",
  arm: "hye",
  baq: "eus",
  bur: "mya",
  chi: "zho",
  cze: "ces",
  dut: "nld",
  fre: "fra",
  geo: "kat",
  ger: "deu",
  gre: "ell",
  ice: "isl",
  mac: "mkd",
  mao: "mri",
  may: "msa",
  per: "fas",
  rum: "ron",
  slo: "slk",
  tib: "bod",
  wel: "cym",
};

/** 639-2 to 639-1 for the languages subtitle tracks actually carry. */
const TWO_LETTER: Record<string, string> = {
  ara: "ar",
  ben: "bn",
  bod: "bo",
  bul: "bg",
  ces: "cs",
  cym: "cy",
  dan: "da",
  deu: "de",
  ell: "el",
  eng: "en",
  est: "et",
  eus: "eu",
  fas: "fa",
  fin: "fi",
  fra: "fr",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  hun: "hu",
  hye: "hy",
  ind: "id",
  isl: "is",
  ita: "it",
  jpn: "ja",
  kat: "ka",
  kor: "ko",
  lav: "lv",
  lit: "lt",
  mkd: "mk",
  mri: "mi",
  msa: "ms",
  mya: "my",
  nld: "nl",
  nor: "no",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rus: "ru",
  slk: "sk",
  slv: "sl",
  spa: "es",
  sqi: "sq",
  srp: "sr",
  swe: "sv",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
  zho: "zh",
};

/**
 * One spelling per language, so a remembered tag can be compared with what the player
 * reports. Jellyfin says `fra` and AVFoundation says `fre` or `fr` for the same track;
 * an exact compare drops the preference on the floor and leaves subtitles off.
 */
export function canonicalLanguage(tag: string): string {
  const base = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  const terminologic = BIBLIOGRAPHIC[base] ?? base;
  return TWO_LETTER[terminologic] ?? terminologic;
}

/** ISO 639-2 codes that name no language, plus Jellyfin's "Unknown". */
const NOT_A_LANGUAGE = new Set(["und", "unknown", "mul", "mis", "zxx"]);

/** The canonical language a tag names, or null when it names none. */
export function knownLanguage(tag: string | null | undefined): string | null {
  const canonical = canonicalLanguage(tag ?? "");
  return canonical && !NOT_A_LANGUAGE.has(canonical) ? canonical : null;
}

/** The reported spelling of this language, whichever each side used, or null when none carries it. */
export function reportedSpelling(tag: string, reported: string[]): string | null {
  const wanted = canonicalLanguage(tag);
  if (!wanted) return null;
  return reported.find((candidate) => canonicalLanguage(candidate) === wanted) ?? null;
}

export function selectedTextTrackFor(preference: SubtitlePreference): SelectedTextTrack {
  switch (preference.kind) {
    case "off":
      return { type: "disabled" };
    case "language":
      return { type: "language", value: preference.tag };
    default:
      return { type: "system" };
  }
}

export function sameSubtitlePreference(a: SubtitlePreference, b: SubtitlePreference): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "language" || b.kind !== "language" || canonicalLanguage(a.tag) === canonicalLanguage(b.tag);
}

/**
 * Decide what to store after a player report, or null to store nothing.
 *
 * Pure so the rule can be tested without a player. Four things have to hold, and
 * each one is guarding against a specific way this goes wrong:
 *
 * 1. `viewerDriven` — the report has to reflect somebody actually using the
 *    picker. Loading an item produces a burst of selection changes on its own:
 *    the stored preference gets applied, the auto-seek re-resolves the legible
 *    group, and the engine lane restarts its pipeline. Measured on device: a
 *    track reported selected at 19:51:59.415 and deselected 17ms later with
 *    nobody touching the remote, and the first version of this rule stored that
 *    as "off". The caller sets this only once playback is stable AND the value
 *    has stopped moving.
 * 2. The value actually differs from what is already stored.
 * 3. `trustworthy` — onTextTracks can describe the PREVIOUS item, because
 *    react-native-video's handleTracksChange re-reads `_player` inside an
 *    unordered Task (see the lesson filed under 92b681d). The caller passes the
 *    verdict its existing guards already reached.
 * 4. An "und" track is refused. It cannot be matched against any other item, so
 *    storing it would write a key that never applies again and silently behaves
 *    as "off" everywhere else. Leaving the previous value alone is the lesser
 *    surprise.
 */
export function nextPreference(args: { observed: ObservedSubtitle; previous: SubtitlePreference; viewerDriven: boolean; trustworthy: boolean }): SubtitlePreference | null {
  const { observed, previous, viewerDriven, trustworthy } = args;
  if (!viewerDriven || !trustworthy) return null;
  if (observed.kind === "language" && (!observed.tag || observed.tag === "und")) return null;

  const candidate: SubtitlePreference = observed.kind === "off" ? { kind: "off" } : { kind: "language", tag: observed.tag };
  return sameSubtitlePreference(candidate, previous) ? null : candidate;
}

// MARK: - Storage

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
