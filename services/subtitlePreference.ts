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
 * a global, language-keyed preference fed back as `selectedTextTrack`, which
 * seeds AVKit's own picker rather than replacing it.
 *
 * Language is the key rather than a track index, because an index means nothing
 * on the next item. It works identically on all three lanes, since
 * RCTPlayerOperations matches on `extendedLanguageTag`: the engine publishes
 * LANGUAGE on every rendition (Remuxer.masterPlaylist), the server lane does too
 * (HLSManifestGenerator), and direct play carries the file's own tags.
 */
import * as SecureStore from "expo-secure-store";

import { STORAGE_KEYS } from "@/services/jellyfin/constants";
import { logger } from "@/utils/logger";

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

/** Serialised form. `system` is stored as absence, so clearing the key resets it. */
function serialize(preference: SubtitlePreference): string | null {
  if (preference.kind === "system") return null;
  return preference.kind === "off" ? "off" : preference.tag;
}

function deserialize(raw: string | null): SubtitlePreference {
  if (!raw) return SYSTEM;
  if (raw === "off") return { kind: "off" };
  return { kind: "language", tag: raw };
}

export function sameSubtitlePreference(a: SubtitlePreference, b: SubtitlePreference): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "language" || b.kind !== "language" || a.tag === b.tag;
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

let cached: SubtitlePreference = SYSTEM;
/**
 * The read failed and the cache is a fallback, not the stored value.
 *
 * A cold launch on a locked device throws "User interaction is not allowed" out
 * of the Keychain (seen 2026-08-13), and without this the preference would read
 * as unset for the whole app session, silently.
 */
let primeFailed = false;
let priming: Promise<SubtitlePreference> | null = null;

/**
 * Read the stored preference into the cache.
 *
 * Kicked off on import rather than from app/_layout.tsx, and safe by ordering
 * rather than by luck: a SecureStore read resolves long before any `sourceUri`
 * exists, since that waits on the Jellyfin metadata fetch and a playback-mode
 * decision. Until it lands the getter answers `system`, which is what the app
 * did before this module existed.
 */
export async function primeSubtitlePreference(): Promise<SubtitlePreference> {
  if (priming) return priming;
  priming = (async () => {
    try {
      cached = deserialize(await SecureStore.getItemAsync(STORAGE_KEYS.SUBTITLE_PREFERENCE));
      primeFailed = false;
    } catch (error) {
      logger.warn("Could not read the stored subtitle preference", { service: "SubtitlePreference", error });
      cached = SYSTEM;
      primeFailed = true;
    } finally {
      priming = null;
    }
    return cached;
  })();
  return priming;
}

/**
 * The cached preference. Synchronous on purpose: the player prop has to be
 * stable at render, and an awaited read would change it mid-item and re-apply
 * the selection over whatever the viewer had just chosen.
 */
export function getSubtitlePreferenceSync(): SubtitlePreference {
  // A failed read is retried in the background so the NEXT item gets the real
  // value, rather than the whole session inheriting a locked Keychain.
  if (primeFailed && !priming) void primeSubtitlePreference();
  return cached;
}

export async function saveSubtitlePreference(preference: SubtitlePreference): Promise<void> {
  cached = preference;
  const value = serialize(preference);
  try {
    if (value === null) await SecureStore.deleteItemAsync(STORAGE_KEYS.SUBTITLE_PREFERENCE);
    else await SecureStore.setItemAsync(STORAGE_KEYS.SUBTITLE_PREFERENCE, value);
  } catch (error) {
    // The cache still holds it, so the rest of this app session honours the
    // choice; only persistence across launches is lost.
    logger.warn("Could not persist the subtitle preference", { service: "SubtitlePreference", error });
  }
}

/** Test seam: drop the cache so a suite can start from the unset state. */
export function resetSubtitlePreferenceCache(): void {
  cached = SYSTEM;
}

void primeSubtitlePreference();
