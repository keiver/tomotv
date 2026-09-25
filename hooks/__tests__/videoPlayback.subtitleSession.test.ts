/**
 * When an item's subtitle choice is applied, and what counts as the viewer making one.
 */
import { classifyObservedChoice, planSubtitleApplication, subtitleSelectionForReport } from "../videoPlayback/subtitleSession";

describe("subtitleSelectionForReport", () => {
  const renditions = [
    { index: 4, name: "English" },
    { index: 7, name: "English SDH" },
  ];

  it("preserves the selected source track even when the player adds phantom entries", () => {
    expect(subtitleSelectionForReport(7, renditions, [{ index: 0 }, { index: 1, title: "English" }, { index: 2, title: "English SDH" }])).toEqual({ type: "index", value: "2" });
  });

  it("uses ordinals only when the reported group matches the published group", () => {
    expect(subtitleSelectionForReport(7, renditions, [{ index: 0 }, { index: 1 }])).toEqual({ type: "index", value: "1" });
    expect(subtitleSelectionForReport(7, renditions, [{ index: 0 }, { index: 1 }, { index: 2 }])).toBeNull();
  });

  it("does not select a missing track or an ambiguous duplicate name", () => {
    expect(subtitleSelectionForReport(9, renditions, [{ index: 0 }, { index: 1 }])).toBeNull();
    expect(
      subtitleSelectionForReport(7, renditions, [
        { index: 0, title: "English SDH" },
        { index: 1, title: "English SDH" },
      ]),
    ).toBeNull();
  });

  it("preserves subtitles off regardless of the new group", () => {
    expect(subtitleSelectionForReport(null, renditions, [{ index: 0 }, { index: 1 }])).toEqual({ type: "disabled" });
  });
});

describe("planSubtitleApplication", () => {
  it("applies a remembered language the item carries", () => {
    const plan = planSubtitleApplication({ stored: { kind: "language", tag: "eng" }, languages: ["eng", "spa"], defaultRenditionLanguage: undefined });
    expect(plan).toEqual({ kind: "apply", preference: { kind: "language", tag: "eng" } });
  });

  it("leaves a language the item does not carry alone, rather than selecting nil", () => {
    // Asking RCTPlayerOperations for a missing language switches subtitles OFF.
    const plan = planSubtitleApplication({ stored: { kind: "language", tag: "fra" }, languages: ["eng"], defaultRenditionLanguage: undefined });
    expect(plan).toEqual({ kind: "leave", reason: "languageMissing" });
  });

  it("applies a stored off", () => {
    expect(planSubtitleApplication({ stored: { kind: "off" }, languages: ["eng"], defaultRenditionLanguage: undefined })).toMatchObject({ kind: "apply" });
  });

  it("selects the file's own default when nothing is remembered", () => {
    // `system` is automatic selection, which follows the device rather than DEFAULT=YES.
    const plan = planSubtitleApplication({ stored: { kind: "system" }, languages: ["eng", "spa"], defaultRenditionLanguage: "spa" });
    expect(plan).toEqual({ kind: "autoDefault", preference: { kind: "language", tag: "spa" }, tag: "spa" });
  });

  it.each([
    ["the file flags no default", undefined],
    ["the default track has no language of its own", "und"],
    ["the default's language is not in the report", "fra"],
  ])("leaves automatic selection alone when %s", (_label, defaultRenditionLanguage) => {
    const plan = planSubtitleApplication({ stored: { kind: "system" }, languages: ["eng"], defaultRenditionLanguage });
    expect(plan).toEqual({ kind: "leave", reason: "noDefault" });
  });
});

describe("planSubtitleApplication across lanes", () => {
  // AVFoundation reports an HLS rendition's LANGUAGE verbatim and an MP4 track as 639-1 (tvOS 26 sim).
  it("applies a preference stored on the engine lane in the MP4's own spelling", () => {
    const plan = planSubtitleApplication({ stored: { kind: "language", tag: "eng" }, languages: ["en", "ja"], defaultRenditionLanguage: undefined });
    expect(plan).toEqual({ kind: "apply", preference: { kind: "language", tag: "en" } });
  });

  it("applies a preference stored on direct play in the playlist's own spelling", () => {
    const plan = planSubtitleApplication({ stored: { kind: "language", tag: "en" }, languages: ["eng", "jpn"], defaultRenditionLanguage: undefined });
    expect(plan).toEqual({ kind: "apply", preference: { kind: "language", tag: "eng" } });
  });

  it("selects the file's default in the reported spelling", () => {
    const plan = planSubtitleApplication({ stored: { kind: "system" }, languages: ["en"], defaultRenditionLanguage: "eng" });
    expect(plan).toEqual({ kind: "autoDefault", preference: { kind: "language", tag: "en" }, tag: "en" });
  });
});

describe("classifyObservedChoice", () => {
  it("reads an echo in another spelling as the same default", () => {
    expect(classifyObservedChoice({ settled: { kind: "language", tag: "eng" }, autoApplied: "en" })).toBe("echoOfDefault");
  });

  it("reads an echo of the default this session applied as the player agreeing, not a choice", () => {
    expect(classifyObservedChoice({ settled: { kind: "language", tag: "spa" }, autoApplied: "spa" })).toBe("echoOfDefault");
  });

  it("reads a move off that default as the viewer taking over", () => {
    expect(classifyObservedChoice({ settled: { kind: "language", tag: "eng" }, autoApplied: "spa" })).toBe("viewerChoice");
  });

  it("reads turning subtitles off as a choice even while a default was applied", () => {
    expect(classifyObservedChoice({ settled: { kind: "off" }, autoApplied: "spa" })).toBe("viewerChoice");
  });

  it("reads any selection as a choice when nothing was applied for the viewer", () => {
    expect(classifyObservedChoice({ settled: { kind: "language", tag: "spa" }, autoApplied: null })).toBe("viewerChoice");
  });
});
