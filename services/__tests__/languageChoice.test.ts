/**
 * The language pick: the device decides until the viewer picks, a pick persists and redraws,
 * "System" hands the choice back to the device, and a stored pick is read at import.
 */
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

type I18n = typeof import("@/services/i18n");

function freshI18n(stored?: unknown): I18n {
  Settings.set({ app_language: stored ?? null });
  let mod!: I18n;
  jest.isolateModules(() => {
    mod = require("@/services/i18n");
  });
  return mod;
}

describe("language choice", () => {
  afterEach(() => Settings.set({ app_language: null }));

  it("follows the device while nothing is picked", () => {
    const i18n = freshI18n();
    expect(i18n.languageChoice()).toBeNull();
    expect(i18n.locale()).toBe(i18n.systemLocale());
  });

  it("applies a pick at once, persists it and tells subscribers", () => {
    const i18n = freshI18n();
    const listener = jest.fn();
    i18n.subscribeLocale(listener);
    i18n.setLanguage("de");
    expect(i18n.locale()).toBe("de");
    expect(i18n.t("filters.title")).toBe("Filter");
    expect(Settings.get(i18n.LANGUAGE_KEY)).toBe("de");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hands the choice back to the device on System and clears the stored pick", () => {
    const i18n = freshI18n("fr");
    i18n.setLanguage(null);
    expect(i18n.languageChoice()).toBeNull();
    expect(i18n.locale()).toBe(i18n.systemLocale());
    expect(Settings.get(i18n.LANGUAGE_KEY) ?? null).toBeNull();
  });

  it("tells subscribers when the pick changes even if the language does not", () => {
    const i18n = freshI18n();
    const listener = jest.fn();
    i18n.subscribeLocale(listener);
    i18n.setLanguage(i18n.systemLocale());
    expect(i18n.languageChoice()).toBe(i18n.systemLocale());
    expect(listener).toHaveBeenCalledTimes(1);
    i18n.setLanguage(i18n.systemLocale());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("renders in a stored pick from the first frame", () => {
    const i18n = freshI18n("es");
    expect(i18n.languageChoice()).toBe("es");
    expect(i18n.locale()).toBe("es");
  });

  it("ignores a stored value the app does not ship", () => {
    const i18n = freshI18n("ja");
    expect(i18n.languageChoice()).toBeNull();
    expect(i18n.locale()).toBe(i18n.systemLocale());
  });

  it("reads a tag in any spelling as a shipped language", () => {
    const i18n = freshI18n();
    expect(i18n.supportedLocale("de-AT")).toBe("de");
    expect(i18n.supportedLocale("fr_CA")).toBe("fr");
    expect(i18n.supportedLocale("ja")).toBeNull();
  });
});
