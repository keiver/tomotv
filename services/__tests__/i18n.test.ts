/**
 * The catalogue is a contract with the store listing: the app ships in the same
 * languages the listing is written in, and a key that only exists in one of them
 * is a screen that reads half translated.
 */
import { __setLocaleForTests, locale, t } from "@/services/i18n";
import { catalogues, de, en, es, fr, type StringKey } from "@/services/i18n/strings";

describe("the string catalogues", () => {
  afterEach(() => __setLocaleForTests("en"));

  it("carries every English key in every language the store lists", () => {
    const keys = Object.keys(en) as StringKey[];
    for (const [tag, catalogue] of Object.entries({ de, fr, es })) {
      const missing = keys.filter((key) => !catalogue[key]);
      expect({ tag, missing }).toEqual({ tag, missing: [] });
    }
  });

  it("translates nothing to an empty string", () => {
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      const blank = Object.entries(catalogue).filter(([, value]) => !String(value).trim());
      expect({ tag, blank }).toEqual({ tag, blank: [] });
    }
  });

  it("reads from the active language", () => {
    __setLocaleForTests("de");
    expect(t("filters.title")).toBe("Filter");
    __setLocaleForTests("fr");
    expect(t("filters.title")).toBe("Filtres");
    __setLocaleForTests("es");
    expect(t("filters.title")).toBe("Filtros");
  });

  /** A half-filled catalogue shows English, never a key name at a viewer. */
  it("falls back to English for a key a language has not got", () => {
    __setLocaleForTests("de");
    const partial = catalogues.de;
    const saved = partial["filters.sort"];
    delete partial["filters.sort"];
    expect(t("filters.sort")).toBe(en["filters.sort"]);
    partial["filters.sort"] = saved;
  });

  it("defaults to English when the device speaks something else", () => {
    expect(locale()).toBe("en");
  });
});
