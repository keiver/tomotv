/**
 * When an item's subtitle choice is applied, and what counts as the viewer making one.
 */
import { classifyObservedChoice, planSubtitleApplication } from "../videoPlayback/subtitleSession";

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

describe("classifyObservedChoice", () => {
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
