/**
 * The capture rule for the remembered subtitle choice.
 *
 * Every case here stands for a way this went wrong or could go wrong on a real
 * device, not for coverage of the branches.
 */
import { nextPreference, observedFromReport, sameSubtitlePreference, selectedTextTrackFor, type SubtitlePreference } from "@/services/subtitlePreference";

const SYSTEM: SubtitlePreference = { kind: "system" };
const OFF: SubtitlePreference = { kind: "off" };
const ENGLISH: SubtitlePreference = { kind: "language", tag: "eng" };

describe("selectedTextTrackFor", () => {
  it("maps the unset preference to the player's own automatic path", () => {
    // "system" is NOT "off": it is the same selectMediaOptionAutomatically call
    // react-native-video makes by default, which is what keeps a fresh install
    // behaving as it did and keeps the playlist's DEFAULT=YES pick working (the
    // bitmap subtitle overlay reads that selection).
    expect(selectedTextTrackFor(SYSTEM)).toEqual({ type: "system" });
  });

  it("maps an explicit off to disabled rather than to automatic", () => {
    expect(selectedTextTrackFor(OFF)).toEqual({ type: "disabled" });
  });

  it("maps a language to the language selector", () => {
    expect(selectedTextTrackFor(ENGLISH)).toEqual({ type: "language", value: "eng" });
  });
});

describe("nextPreference", () => {
  const base = { previous: SYSTEM, viewerDriven: true, trustworthy: true };

  it("ignores a report the viewer did not drive", () => {
    // Loading an item changes the selection by itself: the stored preference is
    // applied, the auto-seek re-resolves the legible group, and the engine lane
    // restarts its pipeline. Device log 2026-08-13: a track was reported
    // selected at 19:51:59.415 and deselected at .432 with nobody touching the
    // remote. The first version of this rule stored that as "off", which then
    // suppressed subtitles on every item afterwards.
    expect(nextPreference({ ...base, viewerDriven: false, observed: { kind: "off" } })).toBeNull();
    expect(nextPreference({ ...base, viewerDriven: false, observed: { kind: "language", tag: "eng" } })).toBeNull();
  });

  it("captures a language the viewer switched to", () => {
    expect(nextPreference({ ...base, observed: { kind: "language", tag: "eng" } })).toEqual(ENGLISH);
  });

  it("captures subtitles being turned off", () => {
    // Off has to stick as an explicit preference. Falling back to "system" would
    // let a file's default track turn them on again on the next item.
    expect(nextPreference({ ...base, previous: ENGLISH, observed: { kind: "off" } })).toEqual(OFF);
  });

  it("refuses an untagged track", () => {
    // "und" cannot be matched on any other item, so storing it would write a key
    // that never applies again and behaves as off everywhere else.
    expect(nextPreference({ ...base, observed: { kind: "language", tag: "und" } })).toBeNull();
    expect(nextPreference({ ...base, observed: { kind: "language", tag: "" } })).toBeNull();
  });

  it("refuses a report the caller could not read", () => {
    // onTextTracks can describe the PREVIOUS item, so a pick the caller refused
    // to resolve says nothing about what the viewer wants.
    expect(
      nextPreference({
        ...base,
        trustworthy: false,
        observed: { kind: "language", tag: "eng" },
      }),
    ).toBeNull();
  });

  it("does not rewrite a preference that already matches", () => {
    expect(nextPreference({ ...base, previous: ENGLISH, observed: { kind: "language", tag: "eng" } })).toBeNull();
    expect(nextPreference({ ...base, previous: OFF, observed: { kind: "off" } })).toBeNull();
  });

  it("captures a switch from one language to another", () => {
    expect(nextPreference({ ...base, previous: ENGLISH, observed: { kind: "language", tag: "spa" } })).toEqual({ kind: "language", tag: "spa" });
  });

  it("treats turning subtitles on from the unset state as a choice", () => {
    // The viewer went from automatic to a real pick. Nothing was stored before,
    // so this is the first thing worth remembering.
    expect(nextPreference({ ...base, previous: SYSTEM, observed: { kind: "language", tag: "eng" } })).toEqual(ENGLISH);
  });
});

describe("observedFromReport", () => {
  it("reads a selected track as the choice", () => {
    expect(observedFromReport({ tracks: [{ language: "eng", selected: true }], applied: SYSTEM })).toEqual({ kind: "language", tag: "eng" });
  });

  it("prefers the engine's language over the player's", () => {
    // The rendition's language came from Jellyfin's metadata; AVFoundation's tag
    // for the same track is inferred.
    expect(observedFromReport({ tracks: [{ language: "und", selected: true }], applied: SYSTEM, renditionLanguage: "spa" })).toEqual({ kind: "language", tag: "spa" });
  });

  it("says nothing about an item with no subtitle tracks", () => {
    // Every subtitle-less video in the library reports an empty list. Reading
    // that as "off" would wipe a standing preference on the next thing played.
    expect(observedFromReport({ tracks: [], applied: { kind: "language", tag: "eng" } })).toBeNull();
  });

  it("says nothing when the preferred language was not there to select", () => {
    // A Spanish-only episode under an English preference reports nothing
    // selected because AVFoundation found no match, not because anybody turned
    // subtitles off. This is the case that would quietly undo the feature.
    expect(observedFromReport({ tracks: [{ language: "spa" }], applied: { kind: "language", tag: "eng" } })).toBeNull();
  });

  it("reads a real deselection as off", () => {
    // The preferred track WAS available and is not selected, so the viewer
    // turned it off.
    expect(observedFromReport({ tracks: [{ language: "eng" }], applied: { kind: "language", tag: "eng" } })).toEqual({ kind: "off" });
  });

  it("reads nothing selected as off when no language was pinned", () => {
    expect(observedFromReport({ tracks: [{ language: "eng" }], applied: SYSTEM })).toEqual({ kind: "off" });
    expect(observedFromReport({ tracks: [{ language: "eng" }], applied: OFF })).toEqual({ kind: "off" });
  });
});

describe("sameSubtitlePreference", () => {
  it("separates the unset state from an explicit off", () => {
    expect(sameSubtitlePreference(SYSTEM, OFF)).toBe(false);
  });

  it("compares languages by tag", () => {
    expect(sameSubtitlePreference(ENGLISH, { kind: "language", tag: "eng" })).toBe(true);
    expect(sameSubtitlePreference(ENGLISH, { kind: "language", tag: "spa" })).toBe(false);
  });
});
