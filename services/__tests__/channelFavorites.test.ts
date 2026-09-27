/** Channel favorites: the server holds them, the device list mirrors them and carries its own up once per server and user. */
import type { JellyfinItem } from "@/types/jellyfin";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/connection", () => ({ getStoredServerId: jest.fn(async () => "srv") }));
jest.mock("@/services/jellyfin/liveTv", () => ({ fetchChannels: jest.fn(), fetchListedChannels: jest.fn() }));
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://s", apiKey: "k", userId: "u", deviceId: "d" })),
  getCachedConfig: jest.fn(() => ({ server: "http://s", apiKey: "k", userId: "u", deviceId: "d" })),
}));
jest.mock("@/services/jellyfin/userData", () => ({ setVideoFavorite: jest.fn(async () => undefined) }));

const channel = (Id: string, Name: string, ChannelNumber?: string) => ({ Id, Name, ChannelNumber, Type: "TvChannel" }) as JellyfinItem;
const one = channel("id-1", "One", "1");
const two = channel("id-2", "Two", "2");

type Modules = {
  favorites: typeof import("@/services/channelFavorites");
  preferences: typeof import("@/services/liveTvPreferences");
  liveTv: { fetchChannels: jest.Mock; fetchListedChannels: jest.Mock };
  userData: { setVideoFavorite: jest.Mock };
};

function load(): Modules {
  let modules!: Modules;
  jest.isolateModules(() => {
    modules = {
      favorites: require("@/services/channelFavorites"),
      preferences: require("@/services/liveTvPreferences"),
      liveTv: require("@/services/jellyfin/liveTv"),
      userData: require("@/services/jellyfin/userData"),
    };
  });
  return modules;
}

beforeEach(() => {
  const { Settings } = require("react-native");
  Settings.set({ app_live_tv_preferences: undefined, app_channel_favorites_seeded: undefined });
  jest.clearAllMocks();
});

describe("planCarry", () => {
  const { planCarry } = load().favorites;
  const entry = (id: string | undefined, name: string, number: string) => ({ ...(id ? { id } : {}), name, number });

  it("keeps an entry no channel here answers, whether or not the server was seeded", () => {
    expect(planCarry([entry("x", "Gone", "9")], new Map(), true)).toEqual({ carry: [], keep: [entry("x", "Gone", "9")] });
    expect(planCarry([entry("x", "Gone", "9")], new Map(), false)).toEqual({ carry: [], keep: [entry("x", "Gone", "9")] });
  });

  it("carries every resolved entry on a first visit", () => {
    expect(planCarry([entry("id-1", "One", "1")], new Map([["1|One", one]]), false).carry).toEqual([one]);
  });

  it("drops an entry whose id still names its channel once seeded, and carries one found under a new id", () => {
    const rotated = channel("id-new", "Two", "2");
    const plan = planCarry(
      [entry("id-1", "One", "1"), entry("id-old", "Two", "2")],
      new Map([
        ["1|One", one],
        ["2|Two", rotated],
      ]),
      true,
    );
    expect(plan).toEqual({ carry: [rotated], keep: [] });
  });
});

describe("mirrorOf", () => {
  it("keeps the device order, appends new server favorites, then the kept entries", () => {
    const { mirrorOf } = load().favorites;
    const three = channel("id-3", "Three", "3");
    const kept = { id: "o", name: "Other", number: "7" };
    expect(
      mirrorOf(
        [
          { name: "Two", number: "2" },
          { name: "Gone", number: "8" },
          { name: "One", number: "1" },
        ],
        [one, two, three],
        [kept],
      ),
    ).toEqual([{ id: "id-2", name: "Two", number: "2" }, { id: "id-1", name: "One", number: "1" }, { id: "id-3", name: "Three", number: "3" }, kept]);
  });
});

describe("syncChannelFavorites", () => {
  it("carries the device list up on a first visit and mirrors the server after", async () => {
    const { favorites, preferences, liveTv, userData } = load();
    preferences.updateLiveTvPreferences({ favorites: [{ id: "id-1", name: "One", number: "1" }] });
    liveTv.fetchChannels.mockResolvedValue({ items: [two] });
    liveTv.fetchListedChannels.mockResolvedValue([one]);
    await favorites.syncChannelFavorites();
    expect(liveTv.fetchChannels).toHaveBeenCalledWith({ favorite: true });
    expect(userData.setVideoFavorite).toHaveBeenCalledWith("id-1", true);
    expect(preferences.getLiveTvPreferences().favorites).toEqual([
      { id: "id-1", name: "One", number: "1" },
      { id: "id-2", name: "Two", number: "2" },
    ]);
  });

  it("drops an entry unfavorited on another client once the server was seeded", async () => {
    const first = load();
    first.liveTv.fetchChannels.mockResolvedValue({ items: [one] });
    await first.favorites.syncChannelFavorites();
    const { favorites, preferences, liveTv, userData } = load();
    preferences.updateLiveTvPreferences({ favorites: [{ id: "id-1", name: "One", number: "1" }] });
    liveTv.fetchChannels.mockResolvedValue({ items: [] });
    liveTv.fetchListedChannels.mockResolvedValue([one]);
    await favorites.syncChannelFavorites();
    expect(userData.setVideoFavorite).not.toHaveBeenCalled();
    expect(preferences.getLiveTvPreferences().favorites).toEqual([]);
  });

  it("leaves the device list as it is when the server does not answer", async () => {
    const { favorites, preferences, liveTv } = load();
    preferences.updateLiveTvPreferences({ favorites: [{ id: "id-1", name: "One", number: "1" }] });
    liveTv.fetchChannels.mockRejectedValue(new Error("offline"));
    await favorites.syncChannelFavorites();
    expect(preferences.getLiveTvPreferences().favorites).toEqual([{ id: "id-1", name: "One", number: "1" }]);
  });

  it("does not overwrite a toggle whose write has not landed", async () => {
    const { favorites, preferences, liveTv, userData } = load();
    let land!: () => void;
    userData.setVideoFavorite.mockImplementation(() => new Promise<void>((resolve) => (land = resolve)));
    favorites.toggleFavoriteChannel(one);
    liveTv.fetchChannels.mockResolvedValue({ items: [] });
    liveTv.fetchListedChannels.mockResolvedValue([]);
    await favorites.syncChannelFavorites();
    expect(preferences.isFavoriteChannel(preferences.getLiveTvPreferences(), one)).toBe(true);
    land();
  });
});

describe("toggleFavoriteChannel", () => {
  it("writes the device list and the server, and puts the device list back when the server refuses", async () => {
    const { favorites, preferences, userData } = load();
    userData.setVideoFavorite.mockRejectedValueOnce(new Error("refused"));
    favorites.toggleFavoriteChannel(one);
    expect(preferences.isFavoriteChannel(preferences.getLiveTvPreferences(), one)).toBe(true);
    expect(userData.setVideoFavorite).toHaveBeenCalledWith("id-1", true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(preferences.isFavoriteChannel(preferences.getLiveTvPreferences(), one)).toBe(false);
  });
});
