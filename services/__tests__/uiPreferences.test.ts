/** The device preferences: posters on and the server asked when needed by default, a stored document reads back, a change persists and notifies. */
import { DEFAULT_UI_PREFERENCES, getUiPreferences, parseUiPreferences, subscribeUiPreferences, UI_PREFERENCES_KEY, updateUiPreferences } from "@/services/uiPreferences";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe("uiPreferences", () => {
  it("starts with device generated posters on and server transcoding as the server allows", () => {
    expect(DEFAULT_UI_PREFERENCES).toEqual({ version: 1, devicePosters: true, serverTranscoding: "linkOrFile" });
    expect(getUiPreferences().devicePosters).toBe(true);
    expect(getUiPreferences().serverTranscoding).toBe("linkOrFile");
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
    expect(JSON.parse(Settings.get(UI_PREFERENCES_KEY) as string)).toEqual({ version: 1, devicePosters: true, serverTranscoding: "linkOrFile" });
    updateUiPreferences({ serverTranscoding: "never" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse(Settings.get(UI_PREFERENCES_KEY) as string).serverTranscoding).toBe("never");
    unsubscribe();
    updateUiPreferences({ devicePosters: false, serverTranscoding: "linkOrFile" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
