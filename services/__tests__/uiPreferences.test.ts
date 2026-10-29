/** The device preferences: posters on and the server asked when needed by default, a stored document reads back, a change persists and notifies. */
import { DEFAULT_UI_PREFERENCES, getUiPreferences, parseUiPreferences, subscribeUiPreferences, UI_PREFERENCES_KEY, updateUiPreferences } from "@/services/uiPreferences";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe("uiPreferences", () => {
  it("starts with device generated posters on, server transcoding as the server allows, the gold cards and the folder colour on", () => {
    expect(DEFAULT_UI_PREFERENCES).toEqual({
      version: 1,
      devicePosters: true,
      serverTranscoding: "linkOrFile",
      cardTheme: { id: "gold", name: "", accent: "#FFC312" },
      background: "artwork",
      showLyrics: true,
      findLyrics: true,
      listenForLyrics: true,
      saveLyrics: true,
      autoSkip: { intro: false, recap: false, preview: false, commercial: true },
      cardZoom: 1,
    });
    expect(getUiPreferences().devicePosters).toBe(true);
    expect(getUiPreferences().serverTranscoding).toBe("linkOrFile");
  });

  it("reads the automatic skips field by field, and the old live TV commercial switch when the document has none", () => {
    const all = { intro: true, recap: true, preview: true, commercial: true };
    expect(parseUiPreferences(JSON.stringify({ autoSkip: all })).autoSkip).toEqual(all);
    expect(parseUiPreferences(JSON.stringify({ autoSkip: { intro: true, commercial: "no" } })).autoSkip).toEqual({ intro: true, recap: false, preview: false, commercial: true });
    expect(parseUiPreferences(JSON.stringify({ autoSkip: "all" })).autoSkip).toEqual(DEFAULT_UI_PREFERENCES.autoSkip);
    expect(parseUiPreferences(JSON.stringify({}), false).autoSkip).toEqual({ ...DEFAULT_UI_PREFERENCES.autoSkip, commercial: false });
    expect(parseUiPreferences(JSON.stringify({}), true).autoSkip).toEqual(DEFAULT_UI_PREFERENCES.autoSkip);
    expect(parseUiPreferences(JSON.stringify({ autoSkip: { commercial: true } }), false).autoSkip.commercial).toBe(true);
  });

  it("reads the canvas mode, and maps earlier documents: clear's first name and the folder-colour switch", () => {
    expect(parseUiPreferences(JSON.stringify({ background: "clear" }))).toEqual({ ...DEFAULT_UI_PREFERENCES, background: "clear" });
    expect(parseUiPreferences(JSON.stringify({ background: "accent" }))).toEqual({ ...DEFAULT_UI_PREFERENCES, background: "accent" });
    expect(parseUiPreferences(JSON.stringify({ background: "disco" }))).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences(JSON.stringify({ background: "tomo" }))).toEqual({ ...DEFAULT_UI_PREFERENCES, background: "clear" });
    expect(parseUiPreferences(JSON.stringify({ folderTint: false }))).toEqual({ ...DEFAULT_UI_PREFERENCES, background: "clear" });
    expect(parseUiPreferences(JSON.stringify({ folderTint: true }))).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("reads the chosen theme, falling back on a malformed one", () => {
    const ember = { id: "t1", name: "Ember", accent: "#ff7043" };
    expect(parseUiPreferences(JSON.stringify({ cardTheme: ember }))).toEqual({ ...DEFAULT_UI_PREFERENCES, cardTheme: { ...ember, accent: "#FF7043" } });
    expect(parseUiPreferences(JSON.stringify({ cardTheme: { id: "t1", name: "x", accent: "orange" } }))).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("reads a stored document field by field, defaulting what is missing or malformed", () => {
    expect(parseUiPreferences(JSON.stringify({ devicePosters: false }))).toEqual({ ...DEFAULT_UI_PREFERENCES, devicePosters: false });
    expect(parseUiPreferences(JSON.stringify({ serverTranscoding: "never" }))).toEqual({ ...DEFAULT_UI_PREFERENCES, serverTranscoding: "never" });
    expect(parseUiPreferences(JSON.stringify({ serverTranscoding: "fileOnly" }))).toEqual({ ...DEFAULT_UI_PREFERENCES, serverTranscoding: "fileOnly" });
    expect(parseUiPreferences(JSON.stringify({ devicePosters: "yes", serverTranscoding: "sometimes" }))).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences(JSON.stringify({ showLyrics: false }))).toEqual({ ...DEFAULT_UI_PREFERENCES, showLyrics: false });
    expect(parseUiPreferences(JSON.stringify({ showLyrics: "no" }))).toEqual(DEFAULT_UI_PREFERENCES);
    const lyricsOff = { findLyrics: false, listenForLyrics: false, saveLyrics: false };
    expect(parseUiPreferences(JSON.stringify(lyricsOff))).toEqual({ ...DEFAULT_UI_PREFERENCES, ...lyricsOff });
    expect(parseUiPreferences(JSON.stringify({ findLyrics: 0, listenForLyrics: "off", saveLyrics: null }))).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences("{not json")).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences(undefined)).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("reads the card zoom between 0.5 and 4, and 1 for anything else", () => {
    expect(parseUiPreferences(JSON.stringify({ cardZoom: 1.35 }))).toEqual({ ...DEFAULT_UI_PREFERENCES, cardZoom: 1.35 });
    expect(parseUiPreferences(JSON.stringify({ cardZoom: 0.5 })).cardZoom).toBe(0.5);
    expect(parseUiPreferences(JSON.stringify({ cardZoom: 4 })).cardZoom).toBe(4);
    expect(parseUiPreferences(JSON.stringify({ cardZoom: 0.2 })).cardZoom).toBe(1);
    expect(parseUiPreferences(JSON.stringify({ cardZoom: 9 })).cardZoom).toBe(1);
    expect(parseUiPreferences(JSON.stringify({ cardZoom: "1.5" })).cardZoom).toBe(1);
    expect(parseUiPreferences(JSON.stringify({ cardZoom: null })).cardZoom).toBe(1);
  });

  it("persists a change and tells subscribers", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeUiPreferences(listener);
    updateUiPreferences({ devicePosters: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getUiPreferences().devicePosters).toBe(true);
    expect(JSON.parse(Settings.get(UI_PREFERENCES_KEY) as string)).toEqual(DEFAULT_UI_PREFERENCES);
    updateUiPreferences({ serverTranscoding: "never" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse(Settings.get(UI_PREFERENCES_KEY) as string).serverTranscoding).toBe("never");
    unsubscribe();
    updateUiPreferences({ devicePosters: false, serverTranscoding: "linkOrFile" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
