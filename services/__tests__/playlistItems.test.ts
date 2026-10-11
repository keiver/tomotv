/**
 * Channels the server has not ingested yet: the playlist table stands in for listing, tuning,
 * frames and logos, and leaves server-side features to the real item.
 */
import { resetPlaylistChannels, syncPlaylistSources, type PlaylistChannel } from "@keiver/tomo-live";
import { fetchChannelsByIds, refreshConfig, resolveChannelOrigin, resolveChannelWithoutOpen } from "../jellyfinApi";
import { pendingPlaylistItemsPage, playlistItem, playlistPlayable } from "../jellyfin/playlistItems";
import { posterSource } from "../itemArtwork";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/libraryManager", () => ({ libraryManager: { clearCache: jest.fn() } }));
jest.mock("../jellyfin/accounts", () => ({ getSavedAccounts: jest.fn(async () => []) }));

const SERVER = "http://192.168.1.100:8096";

const row = (id: string, over: Partial<PlaylistChannel> = {}): PlaylistChannel => ({
  id,
  name: `Channel ${id}`,
  number: null,
  logoUrl: null,
  streamUrl: `http://h/${id}.ts`,
  headers: {},
  originKey: "h",
  groups: [],
  tvgId: null,
  tvgName: null,
  radio: false,
  drm: false,
  ...over,
});

async function seed(rows: PlaylistChannel[]): Promise<void> {
  resetPlaylistChannels();
  await syncPlaylistSources([{ key: "t", url: "http://t/list.m3u", loadRows: async () => ({ rows, tvgUrls: [] }) }]);
}

beforeEach(async () => {
  global.fetch = jest.fn();
  const mockSecureStore = require("expo-secure-store");
  mockSecureStore.getItemAsync.mockImplementation((key: string) => {
    const config: Record<string, string> = {
      jellyfin_server_url: SERVER,
      jellyfin_api_key: "test-api-key",
      jellyfin_user_id: "test-user-id",
      jellyfin_device_id: "test-device-id",
    };
    return Promise.resolve(config[key] || null);
  });
  await refreshConfig();
});

afterEach(() => {
  resetPlaylistChannels();
  jest.restoreAllMocks();
});

describe("playlistItem / playlistPlayable", () => {
  it("builds a pending TvChannel row and a playable the origin lane accepts", async () => {
    await seed([row("p1", { name: "Pending One", number: "7", headers: { "user-agent": "ua" }, originKey: "h.example" })]);
    expect(playlistItem("p1")).toEqual({ Id: "p1", Name: "Pending One", Type: "TvChannel", Path: "http://h/p1.ts", playlistPending: true, ChannelNumber: "7" });
    expect(playlistPlayable("p1")).toMatchObject({
      liveStreamUrl: "http://h/p1.ts",
      liveOriginKey: "h.example",
      liveHttpHeaders: { "user-agent": "ua" },
      MediaSources: [{ IsInfiniteStream: true, SupportsDirectPlay: true, SupportsTranscoding: false }],
    });
    expect(playlistItem("missing")).toBeNull();
  });
});

describe("fetchChannelsByIds", () => {
  it("stands pending playlist channels in for ids the server does not know, keeping the asked order", async () => {
    await seed([row("p1", { name: "Pending One" })]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [{ Id: "c1", Name: "Known", Type: "TvChannel" }] }) });
    const channels = await fetchChannelsByIds(["c1", "p1", "gone"]);
    expect(channels.map((channel) => channel.Id)).toEqual(["c1", "p1"]);
    expect(channels[1]).toMatchObject({ Name: "Pending One", playlistPending: true });
  });
});

describe("tuning fallbacks", () => {
  it("resolves a pending channel without a server open when the item 404s", async () => {
    await seed([row("p1")]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
    const playable = await resolveChannelWithoutOpen("p1");
    expect(playable).toMatchObject({ Id: "p1", liveStreamUrl: "http://h/p1.ts", playlistPending: true });
  });

  it("gives a frame grab the playlist origin when PlaybackInfo 404s, and still throws for unknown ids", async () => {
    await seed([row("p1", { headers: { referer: "http://r" }, originKey: "h.example" })]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
    await expect(resolveChannelOrigin("p1")).resolves.toEqual({ url: "http://h/p1.ts", originKey: "h.example", headers: { referer: "http://r" } });
    await expect(resolveChannelOrigin("nope")).rejects.toThrow("404");
  });
});

describe("posterSource", () => {
  it("falls back to the playlist tvg-logo for a channel the server has no image for", async () => {
    await seed([row("p1", { logoUrl: "http://logos/p1.png" })]);
    expect(posterSource({ Id: "p1", Type: "TvChannel" }, 200)).toEqual({ uri: "http://logos/p1.png", cacheKey: "playlist-logo-http://logos/p1.png" });
    // A server image still wins, and a channel with neither shows nothing.
    expect(posterSource({ Id: "p1", Type: "TvChannel", ImageTags: { Primary: "tag" } }, 200)?.uri).toContain(`${SERVER}/Items/p1/Images/Primary`);
    await seed([row("p2")]);
    expect(posterSource({ Id: "p2", Type: "TvChannel" }, 200)).toBeUndefined();
  });
});

describe("pendingPlaylistItemsPage", () => {
  it("pages the name-sorted channels not yet listed, shrinking as the exclude set grows", async () => {
    await seed([row("b", { name: "Bravo" }), row("a", { name: "Alpha" }), row("c", { name: "Charlie" })]);
    const first = pendingPlaylistItemsPage(new Set(["c"]), 1);
    expect(first.map((item) => item.Name)).toEqual(["Alpha"]);
    const second = pendingPlaylistItemsPage(new Set(["c", "a"]), 5);
    expect(second.map((item) => item.Name)).toEqual(["Bravo"]);
  });
});
