/** liveSources - the typed calls over the LiveSources guide and playlist stores. */

let mockLiveSources: Record<string, jest.Mock> | undefined;
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    get LiveSources() {
      return mockLiveSources;
    },
  },
}));

import { closeGuide, guideChannels, guideProgrammes, isLiveSourcesAvailable, loadGuide, loadPlaylist, playlistEntries, playlistGroups, searchGuide } from "../src/liveSources";

const WINDOW = { from: 1_000, to: 2_000 };

beforeEach(() => {
  mockLiveSources = { loadGuide: jest.fn() };
});

describe("isLiveSourcesAvailable", () => {
  it("follows the module's presence", () => {
    expect(isLiveSourcesAvailable()).toBe(true);
    mockLiveSources = undefined;
    expect(isLiveSourcesAvailable()).toBe(false);
  });
});

describe("loadGuide", () => {
  it("passes the window and pool, and maxOpen only when given", async () => {
    mockLiveSources!.loadGuide.mockResolvedValue({ token: "g1", stats: { channels: 3, programmes: 40 } });
    await expect(loadGuide("http://guide/xmltv.xml", WINDOW, "external")).resolves.toEqual({ token: "g1", stats: { channels: 3, programmes: 40 } });
    expect(mockLiveSources!.loadGuide).toHaveBeenLastCalledWith({ url: "http://guide/xmltv.xml", from: 1_000, to: 2_000, pool: "external" });
    await loadGuide("http://guide/xmltv.xml", WINDOW, "external", 0);
    expect(mockLiveSources!.loadGuide).toHaveBeenLastCalledWith(expect.objectContaining({ maxOpen: 0 }));
  });

  it("drops malformed stats and throws without a token", async () => {
    mockLiveSources!.loadGuide.mockResolvedValue({ token: "g1", stats: { channels: "3" } });
    await expect(loadGuide("u", WINDOW, "external")).resolves.toEqual({ token: "g1", stats: null });
    mockLiveSources!.loadGuide.mockResolvedValue(null);
    await expect(loadGuide("u", WINDOW, "external")).rejects.toThrow("no guide");
  });
});

describe("guide reads", () => {
  it("pass their arguments and answer [] for a non-array", async () => {
    mockLiveSources!.guideChannels = jest.fn().mockResolvedValue(null);
    mockLiveSources!.guideProgrammes = jest.fn().mockResolvedValue([{ channel: "c1" }]);
    mockLiveSources!.searchGuide = jest.fn().mockResolvedValue(undefined);
    await expect(guideChannels("g1")).resolves.toEqual([]);
    await expect(guideProgrammes("g1", ["c1"], WINDOW)).resolves.toEqual([{ channel: "c1" }]);
    expect(mockLiveSources!.guideProgrammes).toHaveBeenCalledWith({ token: "g1", channelIds: ["c1"], from: 1_000, to: 2_000 });
    await expect(searchGuide("g1", ["c1"], WINDOW, "news", 5)).resolves.toEqual([]);
    expect(mockLiveSources!.searchGuide).toHaveBeenCalledWith({ token: "g1", channelIds: ["c1"], from: 1_000, to: 2_000, query: "news", limit: 5 });
  });

  it("closes by token", async () => {
    mockLiveSources!.closeGuide = jest.fn().mockResolvedValue(undefined);
    await closeGuide("g1");
    expect(mockLiveSources!.closeGuide).toHaveBeenCalledWith("g1");
  });
});

describe("playlists", () => {
  it("loadPlaylist resolves token, header and stats, and throws when any is missing", async () => {
    const header = { tvgUrls: [], tvgShift: null, catchup: null, attrs: {} };
    mockLiveSources!.loadPlaylist = jest.fn().mockResolvedValue({ token: "p1", header, stats: { entries: 2, groups: 1 } });
    await expect(loadPlaylist("http://iptv/list.m3u")).resolves.toEqual({ token: "p1", header, stats: { entries: 2, groups: 1 } });
    expect(mockLiveSources!.loadPlaylist).toHaveBeenCalledWith({ url: "http://iptv/list.m3u", headers: {} });
    mockLiveSources!.loadPlaylist.mockResolvedValue({ token: "p1", header });
    await expect(loadPlaylist("http://iptv/list.m3u")).rejects.toThrow("no playlist");
  });

  it("pages entries with the group only when given", async () => {
    mockLiveSources!.playlistEntries = jest.fn().mockResolvedValue([]);
    mockLiveSources!.playlistGroups = jest.fn().mockResolvedValue("x");
    await playlistEntries("p1", { offset: 0, limit: 50 });
    expect(mockLiveSources!.playlistEntries).toHaveBeenLastCalledWith({ token: "p1", offset: 0, limit: 50 });
    await playlistEntries("p1", { offset: 50, limit: 50, group: "News" });
    expect(mockLiveSources!.playlistEntries).toHaveBeenLastCalledWith({ token: "p1", offset: 50, limit: 50, group: "News" });
    await expect(playlistGroups("p1")).resolves.toEqual([]);
  });
});
