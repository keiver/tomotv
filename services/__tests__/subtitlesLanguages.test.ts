import { ALL_LANGUAGES, languageChoices, languageCode, languageFor, sameLanguage } from "@/services/subtitles/languages";

describe("languageFor", () => {
  it("reads two-letter, three-letter, tagged and English spellings", () => {
    expect(languageFor("en")?.code).toBe("en");
    expect(languageFor("eng")?.code).toBe("en");
    expect(languageFor("fre")?.code).toBe("fr");
    expect(languageFor("pt-BR")?.code).toBe("pt");
    expect(languageFor("German")?.code).toBe("de");
    expect(languageFor("und")).toBeNull();
    expect(languageFor("")).toBeNull();
  });

  it("gives each language one row with both codes and a name in its own words", () => {
    const codes = new Set(ALL_LANGUAGES.map((row) => row.code));
    expect(codes.size).toBe(ALL_LANGUAGES.length);
    for (const row of ALL_LANGUAGES) {
      expect(row.code).toMatch(/^[a-z]{2}$/);
      expect(row.code3).toMatch(/^[a-z]{3}$/);
      expect(row.native.length).toBeGreaterThan(0);
    }
  });

  it("gives the two-letter code for any spelling", () => {
    expect(languageCode("spa")).toBe("es");
    expect(languageCode("Klingon")).toBeNull();
  });
});

describe("languageChoices", () => {
  it("orders the account's language, the device's, the film's audio, then English, once each", () => {
    const choices = languageChoices({
      item: {
        MediaStreams: [
          { Type: "Audio", Codec: "aac", Language: "jpn" },
          { Type: "Audio", Codec: "aac", Language: "eng" },
        ],
      },
      stored: "spa",
      deviceTags: ["de-DE", "es-MX"],
    });
    expect(choices.map((row) => row.code)).toEqual(["es", "de", "ja", "en"]);
  });

  it("falls back to the device and English when nothing is stored", () => {
    expect(languageChoices({ item: {}, stored: null, deviceTags: ["fr-CA"] }).map((row) => row.code)).toEqual(["fr", "en"]);
  });
});

describe("sameLanguage", () => {
  it("matches a stream's tag against a two-letter code whichever spelling the server used", () => {
    expect(sameLanguage("eng", "en")).toBe(true);
    expect(sameLanguage("fre", "fr")).toBe(true);
    expect(sameLanguage("ger", "en")).toBe(false);
    expect(sameLanguage(undefined, "en")).toBe(false);
  });
});
