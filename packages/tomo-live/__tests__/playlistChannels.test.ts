/** playlistChannels - the channel table over playlist sources: merge, paging, backoff, reset. */

import { closePlaylist, loadPlaylist, playlistEntries } from "@keiver/tomo-engine";

jest.mock("@keiver/tomo-engine", () => ({
  closePlaylist: jest.fn(async () => {}),
  engineLog: () => ({ warn: jest.fn() }),
  loadPlaylist: jest.fn(),
  playlistEntries: jest.fn(async () => []),
}));
jest.mock("../src/guideFileCache", () => ({
  cachedPlaylistFile: jest.fn(async () => "file:///playlist.m3u"),
}));

import { cachedPlaylistFile } from "../src/guideFileCache";
import {
  allPlaylistChannelIds,
  enginePlaylistRows,
  playlistChannelById,
  playlistChannelFromEntry,
  playlistChannelsPage,
  playlistGroupList,
  playlistOriginKey,
  playlistSourceStatuses,
  playlistTvgUrls,
  resetPlaylistChannels,
  syncPlaylistSources,
  type PlaylistChannel,
  type PlaylistChannelSource,
} from "../src/playlistChannels";

const row = (id: string, over: Partial<PlaylistChannel> = {}): PlaylistChannel => ({
  id,
  name: `Channel ${id}`,
  number: null,
  logoUrl: null,
  streamUrl: `http://host/${id}.ts`,
  headers: {},
  originKey: "host",
  groups: [],
  tvgId: null,
  tvgName: null,
  radio: false,
  drm: false,
  ...over,
});

const source = (key: string, rows: PlaylistChannel[], tvgUrls: string[] = []): PlaylistChannelSource => ({
  key,
  url: key,
  loadRows: jest.fn(async () => ({ rows, tvgUrls })),
});

beforeEach(() => {
  resetPlaylistChannels();
  jest.clearAllMocks();
});

describe("table", () => {
  it("merges sources in order, first id wins, groups keep playlist order", async () => {
    const a = source("t1", [row("a", { groups: ["News"] }), row("b", { groups: ["News", "Kids"] })], ["http://guide.one/xml"]);
    const b = source("t2", [row("b", { name: "shadowed" }), row("c", { groups: ["Kids"] })]);
    await syncPlaylistSources([a, b]);
    expect(allPlaylistChannelIds()).toEqual(["a", "b", "c"]);
    expect(playlistChannelById("b")?.name).toBe("Channel b");
    expect(playlistGroupList()).toEqual([
      { name: "News", channelIds: ["a", "b"] },
      { name: "Kids", channelIds: ["b", "c"] },
    ]);
    expect(playlistTvgUrls()).toEqual(["http://guide.one/xml"]);
    expect(playlistChannelsPage({ offset: 1, limit: 1 })[0].id).toBe("b");
    expect(playlistChannelsPage({ offset: 0, limit: 5, group: "Kids" }).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("does not reload a fresh source and prunes removed ones", async () => {
    const a = source("t1", [row("a")]);
    await syncPlaylistSources([a]);
    await syncPlaylistSources([a]);
    expect(a.loadRows).toHaveBeenCalledTimes(1);
    await syncPlaylistSources([]);
    expect(allPlaylistChannelIds()).toEqual([]);
  });

  it("serves the last good rows through a failed reload and backs the retry off", async () => {
    let fail = false;
    const flaky: PlaylistChannelSource = {
      key: "t1",
      url: "t1",
      loadRows: jest.fn(async () => {
        if (fail) throw new Error("down");
        return { rows: [row("a")], tvgUrls: [] };
      }),
    };
    await syncPlaylistSources([flaky]);
    expect(allPlaylistChannelIds()).toEqual(["a"]);
    fail = true;
    await syncPlaylistSources([flaky], { force: true });
    expect(allPlaylistChannelIds()).toEqual(["a"]);
    expect(playlistSourceStatuses()["t1"].state).toBe("error");
    // Backed off: the next sync does not ask again.
    await syncPlaylistSources([flaky]);
    expect(flaky.loadRows).toHaveBeenCalledTimes(2);
  });

  it("reset drops everything and a load that outlived it writes nothing back", async () => {
    let release: (() => void) | undefined;
    const slow: PlaylistChannelSource = {
      key: "t1",
      url: "t1",
      loadRows: () =>
        new Promise((resolve) => {
          release = () => resolve({ rows: [row("a")], tvgUrls: [] });
        }),
    };
    const landing = syncPlaylistSources([slow]);
    resetPlaylistChannels();
    release!();
    await landing;
    expect(allPlaylistChannelIds()).toEqual([]);
  });
});

describe("enginePlaylistRows", () => {
  it("pages the native store out, maps entries through the app's id, and closes the token", async () => {
    (loadPlaylist as jest.Mock).mockResolvedValue({ token: "T1", header: { tvgUrls: ["http://g/x", "ftp://no"] }, stats: { entries: 3 } });
    const entry = (name: string, url: string) => ({
      name,
      url,
      line: url,
      hasExtInf: true,
      tvgId: null,
      tvgName: null,
      tvgLogo: "http://logo/x.png",
      tvgChno: "7",
      groups: ["G"],
      tvgShift: null,
      radio: false,
      catchup: null,
      headers: { "user-agent": "ua" },
      kodiProps: {},
      drm: false,
      attrs: {},
    });
    (playlistEntries as jest.Mock).mockResolvedValueOnce([entry("One", "http://h/1.ts"), entry("Two", "http://h/2.ts"), entry("Drop", "http://h/3.ts")]);
    const { rows, tvgUrls } = await enginePlaylistRows({ key: "k", url: "http://h/list.m3u", loadRows: async () => ({ rows: [], tvgUrls: [] }) }, (e) => (e.name === "Drop" ? null : e.name));
    expect(cachedPlaylistFile).toHaveBeenCalledWith("http://h/list.m3u");
    expect(rows.map((r) => r.id)).toEqual(["One", "Two"]);
    expect(rows[0]).toMatchObject({ number: "7", logoUrl: "http://logo/x.png", streamUrl: "http://h/1.ts", headers: { "user-agent": "ua" }, originKey: "h", groups: ["G"] });
    expect(tvgUrls).toEqual(["http://g/x"]);
    expect(closePlaylist).toHaveBeenCalledWith("T1");
  });
});

describe("playlistOriginKey / playlistChannelFromEntry", () => {
  it("keys the origin by host and rejects entries the app's id rejects", () => {
    expect(playlistOriginKey("http://User@Host.example:8080/x.ts")).toBe("host.example");
    expect(playlistChannelFromEntry({ name: "n" } as never, null)).toBeNull();
  });
});
