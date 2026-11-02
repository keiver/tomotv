/**
 * Saved library views: the device copy answers at once, the server copy replaces it on load, a save goes to
 * the library's display preferences record and waits on the device when the server is out of reach, and
 * the demo or a refused account (403) stays on the device.
 */
const mockGet = jest.fn();
const mockEdit = jest.fn();
const mockDemo = jest.fn(async () => false);
let mockAccount = { server: "http://jf", apiKey: "t", userId: "u", deviceId: "d" };
jest.mock("@/services/jellyfinApi", () => ({
  getConfig: async () => mockAccount,
  getCachedConfig: () => mockAccount,
  getDisplayPreferences: (...args: unknown[]) => mockGet(...args),
  editDisplayPreferences: (...args: unknown[]) => mockEdit(...args),
  isDemoMode: () => mockDemo(),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  clearLibraryView,
  getLibraryView,
  isEmptyFilters,
  LIBRARY_VIEWS_KEY,
  loadLibraryView,
  parseLibraryFilters,
  resetLibraryViewsForTests,
  setLibraryView,
  subscribeLibraryViews,
  VIEW_PREF_KEY,
} from "@/services/libraryViews";
import { EMPTY_FILTERS, type LibraryFilters } from "@/types/jellyfin";
import { Settings } from "react-native";

const byDate: LibraryFilters = { ...EMPTY_FILTERS, sortBy: "DateCreated", sortOrder: "Descending" };
const favorites: LibraryFilters = { ...EMPTY_FILTERS, favorite: true, genres: ["Jazz"] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs the edit the service hands the server against `stored`, returning what would be written. */
function applyEdit(stored: Record<string, string | null>): Record<string, string | null> {
  const edit = mockEdit.mock.calls.at(-1)?.[2] as (current: Record<string, string | null>) => Record<string, string | null>;
  return edit({ ...stored });
}

function stored(): Record<string, Record<string, { view: LibraryFilters; pending?: true }>> {
  return JSON.parse(Settings.get(LIBRARY_VIEWS_KEY) as string);
}

beforeEach(() => {
  mockGet.mockReset();
  mockEdit.mockReset();
  mockDemo.mockReset().mockResolvedValue(false);
  mockAccount = { server: "http://jf", apiKey: "t", userId: "u", deviceId: "d" };
  Settings.set({ [LIBRARY_VIEWS_KEY]: "{}" });
  resetLibraryViewsForTests();
});

describe("parseLibraryFilters", () => {
  it("reads a selection field by field and defaults what is missing or malformed", () => {
    expect(parseLibraryFilters(JSON.stringify(byDate))).toEqual(byDate);
    expect(parseLibraryFilters({ favorite: true, genres: ["Rock", 3, ""], years: [1999, "2000", 2001.5], sortBy: "Nope", sortOrder: "Sideways" })).toEqual({
      ...EMPTY_FILTERS,
      favorite: true,
      genres: ["Rock"],
      years: [1999],
    });
    expect(parseLibraryFilters("{not json")).toEqual(EMPTY_FILTERS);
    expect(parseLibraryFilters(undefined)).toEqual(EMPTY_FILTERS);
    expect(isEmptyFilters(parseLibraryFilters({}))).toBe(true);
    expect(isEmptyFilters(byDate)).toBe(false);
  });
});

describe("setLibraryView", () => {
  it("answers the new selection at once, tells subscribers, and writes the library's record on the server", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLibraryViews(listener);
    mockEdit.mockResolvedValue(undefined);
    setLibraryView("lib-1", byDate);
    expect(getLibraryView("lib-1")).toEqual(byDate);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stored()["http://jf|u"]["lib-1"]).toEqual({ view: byDate, pending: true });
    await flush();
    expect(mockEdit).toHaveBeenCalledWith("lib-1", "Tomo TV", expect.any(Function), { server: "http://jf", userId: "u" });
    expect(applyEdit({ other: "kept" })).toEqual({ other: "kept", [VIEW_PREF_KEY]: JSON.stringify(byDate) });
    expect(stored()["http://jf|u"]["lib-1"]).toEqual({ view: byDate });
    unsubscribe();
  });

  it("drops the server key and the device entry when the selection is cleared", async () => {
    mockEdit.mockResolvedValue(undefined);
    setLibraryView("lib-1", favorites);
    await flush();
    clearLibraryView("lib-1");
    expect(getLibraryView("lib-1")).toEqual(EMPTY_FILTERS);
    await flush();
    expect(applyEdit({ [VIEW_PREF_KEY]: JSON.stringify(favorites), other: "kept" })).toEqual({ other: "kept" });
    expect(stored()["http://jf|u"]).toBeUndefined();
  });

  it("keeps a save that the server did not take waiting, and sends it with the next load", async () => {
    mockEdit.mockRejectedValueOnce(new Error("Failed to write display preferences: 500"));
    setLibraryView("lib-1", byDate);
    await flush();
    expect(stored()["http://jf|u"]["lib-1"]).toEqual({ view: byDate, pending: true });

    mockEdit.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({ CustomPrefs: { [VIEW_PREF_KEY]: JSON.stringify(byDate) } });
    await loadLibraryView("lib-1");
    expect(mockEdit).toHaveBeenCalledTimes(2);
    expect(stored()["http://jf|u"]["lib-1"]).toEqual({ view: byDate });
    expect(getLibraryView("lib-1")).toEqual(byDate);
  });

  it("stays on the device for an account the server refused and for the demo", async () => {
    mockEdit.mockRejectedValueOnce(new Error("Failed to write display preferences: 403"));
    setLibraryView("lib-1", byDate);
    await flush();
    expect(stored()["http://jf|u"]["lib-1"]).toEqual({ view: byDate });
    setLibraryView("lib-2", favorites);
    await flush();
    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(getLibraryView("lib-2")).toEqual(favorites);

    resetLibraryViewsForTests();
    mockDemo.mockResolvedValue(true);
    setLibraryView("lib-3", byDate);
    await flush();
    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(getLibraryView("lib-3")).toEqual(byDate);
    await loadLibraryView("lib-3");
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("loadLibraryView", () => {
  it("replaces the device copy with the server's once per library and tells subscribers", async () => {
    const listener = jest.fn();
    subscribeLibraryViews(listener);
    Settings.set({ [LIBRARY_VIEWS_KEY]: JSON.stringify({ "http://jf|u": { "lib-1": { view: byDate } } }) });
    expect(getLibraryView("lib-1")).toEqual(byDate);
    mockGet.mockResolvedValue({ CustomPrefs: { [VIEW_PREF_KEY]: JSON.stringify(favorites) } });
    await loadLibraryView("lib-1");
    await loadLibraryView("lib-1");
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("lib-1", "Tomo TV", { server: "http://jf", userId: "u" });
    expect(getLibraryView("lib-1")).toEqual(favorites);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stored()["http://jf|u"]["lib-1"]).toEqual({ view: favorites });
  });

  it("clears the device copy when the server holds none, and reads again after a failed read", async () => {
    Settings.set({ [LIBRARY_VIEWS_KEY]: JSON.stringify({ "http://jf|u": { "lib-1": { view: byDate } } }) });
    mockGet.mockRejectedValueOnce(new Error("Failed to read display preferences: 500"));
    await loadLibraryView("lib-1");
    expect(getLibraryView("lib-1")).toEqual(byDate);
    mockGet.mockResolvedValue({ CustomPrefs: {} });
    await loadLibraryView("lib-1");
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(getLibraryView("lib-1")).toEqual(EMPTY_FILTERS);
  });

  it("keeps each account's views apart and answers nothing signed out", async () => {
    mockEdit.mockResolvedValue(undefined);
    setLibraryView("lib-1", byDate);
    await flush();
    mockAccount = { ...mockAccount, userId: "v" };
    expect(getLibraryView("lib-1")).toEqual(EMPTY_FILTERS);
    mockAccount = { ...mockAccount, userId: "u" };
    expect(getLibraryView("lib-1")).toEqual(byDate);
    mockAccount = { server: null as unknown as string, apiKey: "", userId: null as unknown as string, deviceId: "d" };
    expect(getLibraryView("lib-1")).toEqual(EMPTY_FILTERS);
    await loadLibraryView("lib-1");
    expect(mockGet).not.toHaveBeenCalled();
  });
});
