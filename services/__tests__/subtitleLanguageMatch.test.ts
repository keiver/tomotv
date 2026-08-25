/**
 * Matching a remembered subtitle language against what the player reports.
 *
 * The two sides do not agree on spelling: Jellyfin gives ISO 639-2/T and AVFoundation
 * reports 639-2/B or 639-1 for the very same track. An exact compare silently drops the
 * viewer's preference and leaves subtitles off on a file that carries their language.
 */

import { canonicalLanguage, languageAvailable } from "@/services/subtitlePreference";

describe("canonicalLanguage", () => {
  it("folds the three spellings of one language together", () => {
    expect(canonicalLanguage("fra")).toBe("fr");
    expect(canonicalLanguage("fre")).toBe("fr");
    expect(canonicalLanguage("fr")).toBe("fr");
  });

  it("covers every bibliographic code that differs from the terminological one", () => {
    expect(canonicalLanguage("ger")).toBe(canonicalLanguage("deu"));
    expect(canonicalLanguage("dut")).toBe(canonicalLanguage("nld"));
    expect(canonicalLanguage("cze")).toBe(canonicalLanguage("ces"));
    expect(canonicalLanguage("gre")).toBe(canonicalLanguage("ell"));
    expect(canonicalLanguage("chi")).toBe(canonicalLanguage("zho"));
  });

  it("drops region so a regional variant still reads as its language", () => {
    expect(canonicalLanguage("es-US")).toBe("es");
    expect(canonicalLanguage("pt_BR")).toBe("pt");
  });

  it("leaves anything it does not know alone rather than guessing", () => {
    expect(canonicalLanguage("und")).toBe("und");
    expect(canonicalLanguage("")).toBe("");
  });
});

describe("languageAvailable", () => {
  // Exactly what the device reported for Sintel after the repackage.
  const reported = ["ger", "ger", "en", "en", "es", "es", "fre", "fre", "it", "it", "dut", "dut", "pl", "pl", "pt", "pt", "ru", "ru", "vi", "vi", "es-US", "ja-JP"];

  it("finds the language an exact compare missed", () => {
    expect(reported.includes("fra")).toBe(false);
    expect(languageAvailable("fra", reported)).toBe(true);
  });

  it("finds the other two Sintel carries in a different spelling", () => {
    expect(languageAvailable("deu", reported)).toBe(true);
    expect(languageAvailable("nld", reported)).toBe(true);
  });

  it("still says no to a language the item does not carry", () => {
    expect(languageAvailable("kor", reported)).toBe(false);
    expect(languageAvailable("", reported)).toBe(false);
  });

  it("matches a plain code against a regional one", () => {
    expect(languageAvailable("jpn", reported)).toBe(true);
  });
});
