/** The UI preferences: device generated posters are on by default, a stored document reads back, a change persists and notifies. */
import { DEFAULT_UI_PREFERENCES, getUiPreferences, parseUiPreferences, subscribeUiPreferences, UI_PREFERENCES_KEY, updateUiPreferences } from "@/services/uiPreferences";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe("uiPreferences", () => {
  it("starts with device generated posters on", () => {
    expect(DEFAULT_UI_PREFERENCES.devicePosters).toBe(true);
    expect(getUiPreferences().devicePosters).toBe(true);
  });

  it("reads a stored document field by field, defaulting what is missing or malformed", () => {
    expect(parseUiPreferences(JSON.stringify({ devicePosters: false }))).toEqual({ version: 1, devicePosters: false });
    expect(parseUiPreferences(JSON.stringify({ devicePosters: "yes" }))).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences("{not json")).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences(undefined)).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("persists a change and tells subscribers", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeUiPreferences(listener);
    updateUiPreferences({ devicePosters: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getUiPreferences().devicePosters).toBe(true);
    expect(JSON.parse(Settings.get(UI_PREFERENCES_KEY) as string)).toEqual({ version: 1, devicePosters: true });
    unsubscribe();
    updateUiPreferences({ devicePosters: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
