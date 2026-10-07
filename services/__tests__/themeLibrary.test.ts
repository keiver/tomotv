/**
 * Saved themes on the server: the list format, a merge that keeps other keys, a save that waits on
 * the device when the server is out of reach and goes up with the next load, a delete that is never queued.
 */
const mockGet = jest.fn();
const mockEdit = jest.fn();
const mockConfig = jest.fn(async () => ({ server: "http://jf", apiKey: "t", userId: "u", deviceId: "d" }));
jest.mock("@/services/jellyfinApi", () => ({
  getConfig: () => mockConfig(),
  getDisplayPreferences: (...args: unknown[]) => mockGet(...args),
  editDisplayPreferences: (...args: unknown[]) => mockEdit(...args),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  deleteTheme,
  loadThemes,
  parseThemeList,
  PENDING_THEMES_KEY,
  saveTheme,
  serializeThemeList,
  subscribeThemes,
  themeSaveInFlight,
  THEMES_CLIENT,
  THEMES_ID,
  THEMES_KEY,
  upsertTheme,
} from "@/services/themeLibrary";
import { Settings } from "react-native";

const sea = { id: "t1", name: "Sea", accent: "#6CCFF6" };
const ember = { id: "t2", name: "Ember", accent: "#FF7043" };

/** Runs the edit the service hands the server against `stored`, returning what would be written. */
function applyEdit(stored: Record<string, string | null>): Record<string, string | null> {
  const edit = mockEdit.mock.calls.at(-1)?.[2] as (current: Record<string, string | null>) => Record<string, string | null>;
  return edit({ ...stored });
}

beforeEach(() => {
  mockGet.mockReset();
  mockEdit.mockReset();
  Settings.set({ [PENDING_THEMES_KEY]: "{}" });
});

describe("theme list", () => {
  it("reads the list, skipping entries it cannot read and a repeated id", () => {
    const raw = JSON.stringify({ v: 1, themes: [sea, { id: "bad", name: "x", accent: "blue" }, { ...sea, name: "Again" }, ember] });
    expect(parseThemeList(raw)).toEqual([sea, ember]);
    expect(parseThemeList("{nope")).toEqual([]);
    expect(parseThemeList(null)).toEqual([]);
    expect(parseThemeList(JSON.stringify({ themes: "x" }))).toEqual([]);
    expect(parseThemeList(serializeThemeList([sea]))).toEqual([sea]);
  });

  it("replaces a theme in place by id, else appends it", () => {
    expect(upsertTheme([sea, ember], { ...sea, name: "Ocean" })).toEqual([{ ...sea, name: "Ocean" }, ember]);
    expect(upsertTheme([sea], ember)).toEqual([sea, ember]);
  });
});

describe("saveTheme", () => {
  it("merges into the server's list under its own record, leaving other keys alone", async () => {
    mockEdit.mockResolvedValue(undefined);
    await expect(saveTheme(ember)).resolves.toBe("synced");
    expect(mockEdit).toHaveBeenCalledWith(THEMES_ID, THEMES_CLIENT, expect.any(Function));
    const written = applyEdit({ other: "kept", [THEMES_KEY]: serializeThemeList([sea]) });
    expect(written.other).toBe("kept");
    expect(parseThemeList(written[THEMES_KEY])).toEqual([sea, ember]);
  });

  it("keeps a theme the server did not take on this device, and sends it with the next load", async () => {
    mockEdit.mockRejectedValueOnce(new Error("offline"));
    await expect(saveTheme(ember)).resolves.toBe("pending");

    mockEdit.mockRejectedValueOnce(new Error("still offline"));
    mockGet.mockResolvedValueOnce({ CustomPrefs: { [THEMES_KEY]: serializeThemeList([sea]) } });
    await expect(loadThemes()).resolves.toEqual({ themes: [sea], pending: [ember] });

    mockEdit.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValueOnce({ CustomPrefs: { [THEMES_KEY]: serializeThemeList([sea, ember]) } });
    await expect(loadThemes()).resolves.toEqual({ themes: [sea, ember], pending: [] });
    expect(parseThemeList(applyEdit({ [THEMES_KEY]: serializeThemeList([sea]) })[THEMES_KEY])).toEqual([sea, ember]);
  });

  it("lists a waiting save over the server's older copy of the same theme", async () => {
    mockEdit.mockRejectedValueOnce(new Error("offline"));
    await saveTheme({ ...sea, accent: "#C4E538" });
    mockEdit.mockRejectedValueOnce(new Error("still offline"));
    mockGet.mockResolvedValueOnce({ CustomPrefs: { [THEMES_KEY]: serializeThemeList([sea, ember]) } });
    await expect(loadThemes()).resolves.toEqual({ themes: [ember], pending: [{ ...sea, accent: "#C4E538" }] });
  });

  it("tells subscribers once a save settles, synced or waiting, and is in flight until then", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeThemes(listener);
    let release!: () => void;
    mockEdit.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
    const pending = saveTheme(sea);
    expect(themeSaveInFlight()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    release();
    await pending;
    expect(themeSaveInFlight()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    mockEdit.mockRejectedValueOnce(new Error("offline"));
    await saveTheme(ember);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    mockEdit.mockResolvedValueOnce(undefined);
    await saveTheme(ember);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps pending themes apart per account", async () => {
    mockEdit.mockRejectedValueOnce(new Error("offline"));
    await saveTheme(ember);
    mockConfig.mockResolvedValueOnce({ server: "http://other", apiKey: "t", userId: "u", deviceId: "d" });
    mockGet.mockResolvedValueOnce({ CustomPrefs: {} });
    await expect(loadThemes()).resolves.toEqual({ themes: [], pending: [] });
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });
});

describe("deleteTheme", () => {
  it("drops the theme from the server's list and from this device's queue", async () => {
    mockEdit.mockRejectedValueOnce(new Error("offline"));
    await saveTheme(ember);
    mockEdit.mockResolvedValueOnce(undefined);
    await deleteTheme(ember.id);
    expect(parseThemeList(applyEdit({ [THEMES_KEY]: serializeThemeList([sea, ember]) })[THEMES_KEY])).toEqual([sea]);
    mockGet.mockResolvedValueOnce({ CustomPrefs: { [THEMES_KEY]: serializeThemeList([sea]) } });
    await expect(loadThemes()).resolves.toEqual({ themes: [sea], pending: [] });
  });

  it("throws when the server refuses, rather than queueing", async () => {
    mockEdit.mockRejectedValueOnce(new Error("403"));
    await expect(deleteTheme(sea.id)).rejects.toThrow("403");
  });
});
