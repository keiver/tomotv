/**
 * When an item's subtitle choice is applied, and what counts as the viewer making one.
 * The preference vocabulary itself lives in services/subtitlePreference.ts.
 */
import { languageAvailable, type ObservedSubtitle, type SubtitlePreference } from "@/services/subtitlePreference";

export function subtitleSelectionForReport(
  streamIndex: number | null,
  renditions: { index: number; name: string }[],
  tracks: { index: number; title?: string }[],
): { type: "disabled" } | { type: "index"; value: string } | null {
  if (streamIndex === null) return { type: "disabled" };
  const ordinal = renditions.findIndex((rendition) => rendition.index === streamIndex);
  if (ordinal < 0) return null;
  const named = tracks.filter((track) => track.title === renditions[ordinal].name);
  const position = named.length === 1 ? named[0].index : named.length === 0 && tracks.length === renditions.length ? tracks[ordinal]?.index : undefined;
  return position === undefined ? null : { type: "index", value: String(position) };
}

export interface ApplyInput {
  /** What the viewer's stored choice says. */
  stored: SubtitlePreference;
  /** Languages this item reported, which is the only list a selection can be made in. */
  languages: string[];
  /** Language of the rendition the file itself flags default, if any. */
  defaultRenditionLanguage: string | undefined;
}

export type ApplyPlan =
  /** Leave automatic selection alone: nothing stored and no usable default, or a language this item lacks. */
  | { kind: "leave"; reason: "noDefault" | "languageMissing" }
  /** Select the file's own default FOR the viewer; an echo of it is not a choice. */
  | { kind: "autoDefault"; preference: SubtitlePreference; tag: string }
  | { kind: "apply"; preference: SubtitlePreference };

/**
 * `system` maps to selectMediaOptionAutomatically, which follows the device's captioning
 * settings rather than the playlist's DEFAULT=YES (it held a default PGS track and dropped a
 * default SUBRIP one in the same session). A file that says which subtitle it wants gets it
 * SELECTED instead. Language is the key: an index would have to survive a re-resolve of the
 * legible group, which is the thing that goes wrong here.
 */
export function planSubtitleApplication(input: ApplyInput): ApplyPlan {
  if (input.stored.kind === "system") {
    const tag = input.defaultRenditionLanguage ?? "";
    if (!tag || tag === "und" || !languageAvailable(tag, input.languages)) return { kind: "leave", reason: "noDefault" };
    return { kind: "autoDefault", preference: { kind: "language", tag }, tag };
  }

  // Asking for a language this item does not carry makes RCTPlayerOperations select nil,
  // which switches subtitles OFF rather than leaving them alone.
  if (input.stored.kind === "language" && !languageAvailable(input.stored.tag, input.languages)) {
    return { kind: "leave", reason: "languageMissing" };
  }

  return { kind: "apply", preference: input.stored };
}

/**
 * A report echoing back the default this session applied FOR the viewer is the player
 * agreeing with us, not somebody choosing. Once the value moves off it the viewer has taken
 * over, and everything after is theirs to keep, including switching back to that track.
 */
export function classifyObservedChoice(input: { settled: ObservedSubtitle; autoApplied: string | null }): "echoOfDefault" | "viewerChoice" {
  if (input.autoApplied !== null && input.settled.kind === "language" && input.settled.tag === input.autoApplied) return "echoOfDefault";
  return "viewerChoice";
}
