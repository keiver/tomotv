/**
 * Channels the server has not ingested yet: the playlist table stands in for listing, tuning,
 * frames and logos, and leaves server-side features to the real item. It stands in for nothing
 * on an account whose policy can hide a channel, since the server answers 404 for those too.
 */
import { resetPlaylistChannels, syncPlaylistSources, type PlaylistChannel } from "@keiver/tomo-live";
import { fetchChannelsByIds, fetchItemDetails, fetchVideoDetails, refreshConfig, resolveChannelOrigin, resolveChannelWithoutOpen } from "../jellyfinApi";
import { pendingChannelsAfter, pendingPlaylistItemsPage, playlistPlayable, playlistStandIn, playlistStandInsAllowed, policyHidesNoChannel, standInItem } from "../jellyfin/playlistItems";
import { resetTunerCache, tunerDataSettled } from "../jellyfin/tunerGroups";
import { posterSource } from "../itemArtwork";
import { clearRequestCache } from "../requestCache";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/libraryManager", () => ({ libraryManager: { clearCache: jest.fn() } }));
jest.mock("../jellyfin/accounts", () => ({ getSavedAccounts: jest.fn(async () => []) }));

const SERVER = "http://192.168.1.100:8096";
const OPEN_POLICY = { MaxParentalRating: null, BlockUnratedItems: [], BlockedTags: [], AllowedTags: [] };
const BLOCKS_UNRATED_CHANNELS = { ...OPEN_POLICY, BlockUnratedItems: ["LiveTvChannel"] };
const NOT_FOUND = { ok: false, status: 404, statusText: "Not Found" };

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

/** The account's policy answers /Users/Me (null: the read fails); every other request gets `other`. */
function serve(policy: object | null, other: (url: string) => unknown = () => NOT_FOUND): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    if (String(url).endsWith("/Users/Me")) return policy ? { ok: true, json: async () => ({ Policy: policy }) } : { ok: false, status: 500 };
    return other(String(url));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(async () => {
  clearRequestCache();
  serve(OPEN_POLICY);
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

describe("the account policy gate", () => {
  it("allows stand-ins only when no parental rule can hide a channel", () => {
    expect(policyHidesNoChannel(OPEN_POLICY)).toBe(true);
    expect(policyHidesNoChannel({ ...OPEN_POLICY, BlockUnratedItems: ["Movie"] })).toBe(true);
    expect(policyHidesNoChannel(BLOCKS_UNRATED_CHANNELS)).toBe(false);
    expect(policyHidesNoChannel({ ...OPEN_POLICY, MaxParentalRating: 13 })).toBe(false);
    expect(policyHidesNoChannel({ ...OPEN_POLICY, BlockedTags: ["adult"] })).toBe(false);
    expect(policyHidesNoChannel({ ...OPEN_POLICY, AllowedTags: ["kids"] })).toBe(false);
    expect(policyHidesNoChannel(undefined)).toBe(false);
  });

  it("stands in for nothing when the policy cannot be read, and asks again rather than caching the failure", async () => {
    await seed([row("p1")]);
    serve(null);
    await expect(playlistStandInsAllowed()).resolves.toBe(false);
    await expect(playlistStandIn("p1")).resolves.toBeNull();
    serve(OPEN_POLICY);
    await expect(playlistStandIn("p1")).resolves.toMatchObject({ id: "p1" });
  });

  it("never reads the policy for an id no playlist carries", async () => {
    await seed([row("p1")]);
    const fetchMock = serve(OPEN_POLICY);
    await expect(playlistStandIn("unknown")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("standInItem / playlistPlayable", () => {
  it("builds a pending TvChannel row and a playable the origin lane accepts", async () => {
    const pending = row("p1", { name: "Pending One", number: "7", headers: { "user-agent": "ua" }, originKey: "h.example" });
    await seed([pending]);
    expect(standInItem(pending)).toEqual({ Id: "p1", Name: "Pending One", Type: "TvChannel", Path: "http://h/p1.ts", playlistPending: true, ChannelNumber: "7" });
    await expect(playlistPlayable("p1")).resolves.toMatchObject({
      liveStreamUrl: "http://h/p1.ts",
      liveOriginKey: "h.example",
      liveHttpHeaders: { "user-agent": "ua" },
      MediaSources: [{ IsInfiniteStream: true, SupportsDirectPlay: true, SupportsTranscoding: false }],
    });
    await expect(playlistPlayable("missing")).resolves.toBeNull();
  });
});

describe("fetchChannelsByIds", () => {
  const known = () => ({ ok: true, json: async () => ({ Items: [{ Id: "c1", Name: "Known", Type: "TvChannel" }] }) });

  it("stands pending playlist channels in for ids the server does not know, keeping the asked order", async () => {
    await seed([row("p1", { name: "Pending One" })]);
    serve(OPEN_POLICY, known);
    const channels = await fetchChannelsByIds(["c1", "p1", "gone"]);
    expect(channels.map((channel) => channel.Id)).toEqual(["c1", "p1"]);
    expect(channels[1]).toMatchObject({ Name: "Pending One", playlistPending: true });
  });

  it("lists only the server's channels for an account a parental rule can hide channels from", async () => {
    await seed([row("p1")]);
    serve(BLOCKS_UNRATED_CHANNELS, known);
    expect((await fetchChannelsByIds(["c1", "p1"])).map((channel) => channel.Id)).toEqual(["c1"]);
  });
});

describe("tuning fallbacks", () => {
  it("resolves a pending channel without a server open when the item 404s", async () => {
    await seed([row("p1")]);
    const playable = await resolveChannelWithoutOpen("p1");
    expect(playable).toMatchObject({ Id: "p1", liveStreamUrl: "http://h/p1.ts", playlistPending: true });
  });

  it("gives a frame grab the playlist origin when PlaybackInfo 404s, and still throws for unknown ids", async () => {
    await seed([row("p1", { headers: { referer: "http://r" }, originKey: "h.example" })]);
    await expect(resolveChannelOrigin("p1")).resolves.toEqual({ url: "http://h/p1.ts", originKey: "h.example", headers: { referer: "http://r" } });
    await expect(resolveChannelOrigin("nope")).rejects.toThrow("404");
  });

  it("plays and grabs a pending Pluto channel on this device's session", async () => {
    const id = "5f4d878d3d19b30007d2e782";
    const session = `https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/${id}/master.m3u8?jwt=tok&masterJWTPassthrough=true`;
    await seed([row("p1", { streamUrl: `https://jmp2.uk/plu-${id}.m3u8`, originKey: "jmp2.uk" })]);
    serve(OPEN_POLICY, (url) => {
      if (url === "https://pluto.tv/api/tn/app-shell/graphql/") {
        return { ok: true, headers: { get: () => "CBS_COM=c1; Path=/" }, json: async () => ({ data: { ptvStart: { deviceId: "d1", session: { id: "s1", jwt: "tok" }, refreshInSec: 28800 } } }) };
      }
      if (url === "https://pluto.tv/api/tn/video/graphql/") {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => ({ data: { streamingUrl: { success: true, stitcherPaths: [{ type: "hls", path: `/v2/stitch/hls/channel/${id}/master.m3u8` }] } } }),
        };
      }
      return NOT_FOUND;
    });
    await expect(playlistPlayable("p1")).resolves.toMatchObject({ liveStreamUrl: session, liveOriginKey: "ipv4.pluto.tv" });
    await expect(resolveChannelOrigin("p1")).resolves.toEqual({ url: session, originKey: "ipv4.pluto.tv" });
  });

  it("opens a pending channel by id, and its info panel shows it without caching the stand-in", async () => {
    await seed([row("p1", { name: "Pending One" })]);
    const fetchMock = serve(OPEN_POLICY);
    await expect(fetchVideoDetails("p1")).resolves.toMatchObject({ Id: "p1", liveStreamUrl: "http://h/p1.ts", playlistPending: true });
    await expect(fetchItemDetails("p1")).resolves.toMatchObject({ Id: "p1", Name: "Pending One", playlistPending: true });
    const itemReads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/Items/p1?")).length;
    const before = itemReads();
    await fetchItemDetails("p1");
    expect(itemReads()).toBe(before + 1);
  });

  it("treats every 404 as the server's refusal on an account a parental rule can hide channels from", async () => {
    await seed([row("p1")]);
    serve(BLOCKS_UNRATED_CHANNELS);
    await expect(resolveChannelWithoutOpen("p1")).rejects.toThrow("404");
    await expect(resolveChannelOrigin("p1")).rejects.toThrow("404");
    await expect(fetchVideoDetails("p1")).rejects.toThrow();
    await expect(fetchItemDetails("p1")).rejects.toThrow();
    await expect(pendingPlaylistItemsPage(new Set(), 5)).resolves.toEqual([]);
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
    const first = await pendingPlaylistItemsPage(new Set(["c"]), 1);
    expect(first.map((item) => item.Name)).toEqual(["Alpha"]);
    const second = await pendingPlaylistItemsPage(new Set(["c", "a"]), 5);
    expect(second.map((item) => item.Name)).toEqual(["Bravo"]);
  });
});

describe("pendingChannelsAfter", () => {
  const listed = { Id: "c1", Name: "Known", Type: "TvChannel", Path: "" };

  it("lands a page with channels as it is while the tuner read runs, and asks for the next at once", async () => {
    resetTunerCache();
    await seed([row("a", { name: "Alpha" })]);
    expect(tunerDataSettled()).toBe(false);
    await expect(pendingChannelsAfter([listed], [], 5)).resolves.toEqual({ pending: [], hasMore: true, waiting: true });
  });

  it("waits for the tuner read on an empty page, then appends what the playlists carry beyond the loaded channels", async () => {
    resetTunerCache();
    await seed([row("a", { name: "Alpha" }), row("c1", { name: "Known" })]);
    const tail = await pendingChannelsAfter([], [listed], 5);
    expect(tunerDataSettled()).toBe(true);
    expect(tail).toMatchObject({ hasMore: false, waiting: false });
    expect(tail.pending.map((item) => item.Id)).toEqual(["a"]);
    // Settled: the server's last page takes its pending channels with it.
    await expect(pendingChannelsAfter([listed], [], 1)).resolves.toMatchObject({ hasMore: true, waiting: false, pending: [{ Id: "a" }] });
  });
});
