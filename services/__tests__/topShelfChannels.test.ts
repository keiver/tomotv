import * as SecureStore from "expo-secure-store";
import { NativeModules } from "react-native";
import { fetchChannelCategories, fetchChannels, fetchListedChannels, getConfig } from "@/services/jellyfinApi";
import { getLiveTvAvailability } from "@/services/liveTvAvailability";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import { syncTopShelfChannels, TOP_SHELF_CHANNELS_KEY, topShelfSource } from "../topShelfChannels";
import { DEFAULT_LIVE_TV_PREFERENCES, type LiveTvPreferences } from "../liveTvPreferences";

jest.mock("expo-secure-store", () => ({ setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined), getItemAsync: jest.fn(async () => null) }));
jest.mock("@/services/jellyfinApi", () => ({
  getConfig: jest.fn(),
  fetchChannelCategories: jest.fn(),
  fetchChannels: jest.fn(),
  fetchChannelsByIds: jest.fn(),
  fetchListedChannels: jest.fn(),
  lastKnownTunerData: jest.fn(() => null),
  subscribeAuthChange: jest.fn(),
}));
jest.mock("@/services/liveTvAvailability", () => ({ getLiveTvAvailability: jest.fn(), subscribeLiveTvAvailability: jest.fn() }));
jest.mock("@/services/liveTvPreferences", () => ({ ...jest.requireActual("@/services/liveTvPreferences"), getLiveTvPreferences: jest.fn() }));

const prefs = (patch: Partial<LiveTvPreferences>): LiveTvPreferences => ({ ...DEFAULT_LIVE_TV_PREFERENCES, ...patch });
const favorite = { id: "c1", number: "1", name: "One" };
const group = { id: "g1", name: "Sports Night", channels: [{ id: "c2", name: "Two" }] };

describe("topShelfSource", () => {
  it("follows the picked filter", () => {
    expect(topShelfSource(prefs({ filter: "favorites", favorites: [favorite] }), [], null)).toEqual({ kind: "list", title: "Favorites", list: [favorite] });
    expect(topShelfSource(prefs({ filter: "group:g1", groups: [group] }), [], null)).toEqual({ kind: "list", title: "Sports Night", list: group.channels });
    expect(topShelfSource(prefs({ filter: "playlist:News" }), [], [{ name: "News", channelIds: ["c3", "c4"] }])).toEqual({ kind: "ids", title: "News", ids: ["c3", "c4"] });
    expect(topShelfSource(prefs({ filter: "category:sports" }), ["sports"], null)).toEqual({ kind: "category", title: "Sports", category: "sports" });
  });

  it("falls back to Favorites, then Movies, then All when nothing is picked", () => {
    expect(topShelfSource(prefs({ favorites: [favorite] }), ["movie"], null)).toEqual({ kind: "list", title: "Favorites", list: [favorite] });
    expect(topShelfSource(prefs({}), ["news", "movie"], null)).toEqual({ kind: "category", title: "Movies", category: "movie" });
    expect(topShelfSource(prefs({}), ["news"], null)).toEqual({ kind: "all", title: "Live TV" });
  });

  it("falls back when the picked filter has nothing to show", () => {
    expect(topShelfSource(prefs({ filter: "group:g1", groups: [{ ...group, channels: [] }], favorites: [favorite] }), [], null).title).toBe("Favorites");
    expect(topShelfSource(prefs({ filter: "group:gone" }), ["movie"], null).title).toBe("Movies");
    expect(topShelfSource(prefs({ filter: "playlist:News" }), [], null).kind).toBe("all");
    expect(topShelfSource(prefs({ filter: "category:kids" }), ["news"], null).kind).toBe("all");
  });
});

describe("syncTopShelfChannels", () => {
  const reload = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    NativeModules.TopShelfReload = { contentDidChange: reload };
    jest.mocked(getConfig).mockResolvedValue({ server: "http://tv.local:8096", userId: "u1" } as Awaited<ReturnType<typeof getConfig>>);
    jest.mocked(getLiveTvAvailability).mockReturnValue(true);
    jest.mocked(fetchChannelCategories).mockResolvedValue([]);
  });

  it("writes the picked list's channels for this server and user, then reloads the shelf once", async () => {
    jest.mocked(getLiveTvPreferences).mockReturnValue(prefs({ filter: "group:g1", groups: [group] }));
    jest.mocked(fetchListedChannels).mockResolvedValue([{ Id: "c2" }] as Awaited<ReturnType<typeof fetchListedChannels>>);

    await syncTopShelfChannels();
    await syncTopShelfChannels();

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(TOP_SHELF_CHANNELS_KEY, JSON.stringify({ server: "http://tv.local:8096", userId: "u1", title: "Sports Night", ids: ["c2"] }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("caps the row and clears it once the server has no Live TV", async () => {
    jest.mocked(getLiveTvPreferences).mockReturnValue(prefs({}));
    jest.mocked(fetchChannels).mockResolvedValue({ items: Array.from({ length: 14 }, (_, index) => ({ Id: `c${index}` })) } as Awaited<ReturnType<typeof fetchChannels>>);

    await syncTopShelfChannels();
    const written = JSON.parse(jest.mocked(SecureStore.setItemAsync).mock.calls[0][1]);
    expect(written.ids).toHaveLength(10);
    expect(written.title).toBe("Live TV");

    jest.mocked(getLiveTvAvailability).mockReturnValue(false);
    await syncTopShelfChannels();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(TOP_SHELF_CHANNELS_KEY);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
