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
    });
    expect(getUiPreferences().devicePosters).toBe(true);
    expect(getUiPreferences().serverTranscoding).toBe("linkOrFile");
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
    expect(parseUiPreferences("{not json")).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences(undefined)).toEqual(DEFAULT_UI_PREFERENCES);
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
