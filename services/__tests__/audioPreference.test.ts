/**
 * The remembered audio language: which stream it opens an item on, and when Jellyfin's settings name one.
 */
import { audioLanguageToStore, preferredAudioStreamIndex, rememberedAudioLanguage } from "@/services/audioPreference";
import { JELLYFIN_DEFAULTS } from "@/services/jellyfin/trackSettings";

// Naruto S01E001 as Jellyfin lists it: English default at 1, Japanese at 2.
const naruto = [
  { Index: 1, Language: "eng", IsDefault: true },
  { Index: 2, Language: "jpn", IsDefault: false },
];

describe("preferredAudioStreamIndex", () => {
  it("finds the stream in whichever spelling the preference was stored", () => {
    expect(preferredAudioStreamIndex(naruto, "ja")).toBe(2);
    expect(preferredAudioStreamIndex(naruto, "jpn")).toBe(2);
    expect(preferredAudioStreamIndex(naruto, "ja-JP")).toBe(2);
  });

  it("prefers the file's default among several streams in the language", () => {
    const commentaryFirst = [
      { Index: 1, Language: "eng", IsDefault: false },
      { Index: 2, Language: "eng", IsDefault: true },
    ];
    expect(preferredAudioStreamIndex(commentaryFirst, "en")).toBe(2);
  });

  it("takes the first match when none is flagged default", () => {
    expect(
      preferredAudioStreamIndex(
        [
          { Index: 3, Language: "spa" },
          { Index: 4, Language: "spa" },
        ],
        "es",
      ),
    ).toBe(3);
  });

  it("leaves the item alone when nothing is stored or nothing matches", () => {
    expect(preferredAudioStreamIndex(naruto, null)).toBeNull();
    expect(preferredAudioStreamIndex(naruto, "fr")).toBeNull();
  });

  it("never matches an undetermined language", () => {
    expect(preferredAudioStreamIndex([{ Index: 1, Language: "und" }], "und")).toBeNull();
  });
});

describe("audioLanguageToStore", () => {
  it("stores one spelling per language", () => {
    expect(audioLanguageToStore("jpn")).toBe("ja");
    expect(audioLanguageToStore("ja")).toBe("ja");
    expect(audioLanguageToStore("fre")).toBe("fr");
  });

  it("refuses a tag no other item could match", () => {
    expect(audioLanguageToStore("und")).toBeNull();
    expect(audioLanguageToStore("Unknown")).toBeNull();
    expect(audioLanguageToStore("mul")).toBeNull();
    expect(audioLanguageToStore("zxx")).toBeNull();
    expect(audioLanguageToStore("")).toBeNull();
    expect(audioLanguageToStore(undefined)).toBeNull();
  });
});

describe("rememberedAudioLanguage", () => {
  const settings = (audioLanguage: string | null, playDefaultAudio: boolean) => ({ ...JELLYFIN_DEFAULTS, audioLanguage, playDefaultAudio });

  it("follows the language once Jellyfin stops preferring the file's default track", () => {
    expect(rememberedAudioLanguage(settings("jpn", false))).toBe("ja");
  });

  it("remembers nothing while the file's default track wins, as Jellyfin does", () => {
    expect(rememberedAudioLanguage(settings("jpn", true))).toBeNull();
    expect(rememberedAudioLanguage(JELLYFIN_DEFAULTS)).toBeNull();
  });

  it("leaves OriginalLanguage and non-languages to the file", () => {
    expect(rememberedAudioLanguage(settings("OriginalLanguage", false))).toBeNull();
    expect(rememberedAudioLanguage(settings("und", false))).toBeNull();
    expect(rememberedAudioLanguage(settings(null, false))).toBeNull();
  });
});
