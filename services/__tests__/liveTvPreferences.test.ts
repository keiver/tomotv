/** The live TV preferences: defaults, a document read back field by field, favorites by number and name, the sort's server parameter. */
import {
  channelSortParam,
  DEFAULT_LIVE_TV_PREFERENCES,
  favoriteChannels,
  getLiveTvPreferences,
  isFavoriteChannel,
  LIVE_TV_PREFERENCES_KEY,
  parseLiveTvPreferences,
  subscribeLiveTvPreferences,
  toggleFavoriteChannel,
  updateLiveTvPreferences,
} from "@/services/liveTvPreferences";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const kqed = { Name: "KQED", ChannelNumber: "9.1" };
const kqedPlus = { Name: "KQED Plus", ChannelNumber: "9.2" };
const unnumbered = { Name: "Al Jazeera English" };

describe("live TV preferences", () => {
  it("reads a document field by field and falls back per field", () => {
    expect(parseLiveTvPreferences(undefined)).toEqual(DEFAULT_LIVE_TV_PREFERENCES);
    expect(parseLiveTvPreferences("{not json")).toEqual(DEFAULT_LIVE_TV_PREFERENCES);
    expect(parseLiveTvPreferences(JSON.stringify({ sort: "name", favorites: [{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }, { bogus: true }, null], autoUpdate: "yes" }))).toEqual({
      version: 1,
      autoUpdate: true,
      favoritesOnly: false,
      sort: "name",
      favorites: [{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }],
    });
  });

  it("names a favorite by number and name, or by name alone, and matches channels the same way", () => {
    const stored = parseLiveTvPreferences({ favorites: [{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }] });
    expect(isFavoriteChannel(stored, kqed)).toBe(true);
    expect(isFavoriteChannel(stored, kqedPlus)).toBe(false);
    expect(isFavoriteChannel(stored, unnumbered)).toBe(true);
    expect(isFavoriteChannel(stored, { Name: "KQED" })).toBe(false);
    expect(favoriteChannels(stored, [kqedPlus, unnumbered, kqed])).toEqual([unnumbered, kqed]);
  });

  it("toggles a favorite, persists the document and tells its subscribers", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLiveTvPreferences(listener);
    toggleFavoriteChannel(kqed);
    expect(getLiveTvPreferences().favorites).toEqual([{ number: "9.1", name: "KQED" }]);
    expect(JSON.parse(Settings.get(LIVE_TV_PREFERENCES_KEY) as string)).toMatchObject({ version: 1, favorites: [{ number: "9.1", name: "KQED" }] });
    toggleFavoriteChannel(unnumbered);
    toggleFavoriteChannel(kqed);
    expect(getLiveTvPreferences().favorites).toEqual([{ name: "Al Jazeera English" }]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    updateLiveTvPreferences({ favoritesOnly: true, sort: "name" });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLiveTvPreferences()).toMatchObject({ favoritesOnly: true, sort: "name", favorites: [{ name: "Al Jazeera English" }] });
  });

  it("maps the sort to the server's parameter", () => {
    expect(channelSortParam("number")).toBe("SortName");
    expect(channelSortParam("name")).toBe("Name");
  });
});
