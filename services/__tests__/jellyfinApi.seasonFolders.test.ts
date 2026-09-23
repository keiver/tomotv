/**
 * Series listings built from file paths: a season-less series lists its files flat in episode
 * order with its subfolders after, and a season folder the server could not number lists the
 * files under its path. Everything else keeps the server's browse.
 */
import { fetchFolderContents, fetchFolderPreviewItems, fetchRecursiveVideos, refreshConfig } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

const ROOT = "/media/Shows/Show";
const episode = (absolute: string, season: number, index: number, title = "Title") => ({
  Id: `n${absolute}`,
  Name: `Show - ${absolute} - ${title}`,
  Path: `${ROOT}/Show - ${absolute} - ${title}.mkv`,
  Type: "Episode",
  SeriesId: "series",
  ParentIndexNumber: season,
  IndexNumber: index,
});
const special = { Id: "special", Name: "Show - Special", Path: `${ROOT}/Extras/Show - Special.mkv`, Type: "Episode", SeriesId: "series", ParentIndexNumber: 1, IndexNumber: 3 };
const extrasFolder = { Id: "extras", Name: "Extras", Type: "Season", Path: `${ROOT}/Extras`, SeriesId: "series" };
// Pathless seasons are the server's guesses from the loose files.
const guessedSeasons = [
  { Id: "specials", Name: "Specials", Type: "Season", IndexNumber: 0 },
  { Id: "s1", Name: "Season 1", Type: "Season", IndexNumber: 1 },
  { Id: "s2", Name: "Season 2", Type: "Season", IndexNumber: 2 },
];
// Server SortName order: split pairs, the special among season 1, the title split last.
const EPISODES = [episode("001", 0, 1), episode("002", 0, 2), episode("100", 1, 0), special, episode("151", 1, 51), episode("150", 2, 50, "250 Title")];

type Route = (url: URL) => unknown;

function serve(route: Route) {
  global.fetch = jest.fn(async (input: string) => {
    const body = route(new URL(input)) ?? { Items: [], TotalRecordCount: 0 };
    return { ok: true, json: async () => body };
  }) as unknown as typeof fetch;
}

const list = (items: unknown[]) => ({ Items: items, TotalRecordCount: items.length });

function seriesServer(episodes = EPISODES): Route {
  return (url) => {
    const p = url.searchParams;
    if (url.pathname === "/Items/extras") return extrasFolder;
    if (p.get("ParentId") === "series" && p.get("IncludeItemTypes") === "Episode") return list(episodes);
    if (p.get("ParentId") === "series" && p.get("Recursive") === "false") return list([...guessedSeasons, extrasFolder]);
    return null;
  };
}

describe("series listings from file paths", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    jest.resetModules();
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(config[key] || null);
    });
    await refreshConfig();
    const { clearRequestCache } = require("@/services/requestCache");
    clearRequestCache();
  });

  it("lists a season-less series flat, in episode order, subfolders after", async () => {
    serve(seriesServer());
    const { items, total } = await fetchFolderContents("series", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["n001", "n002", "n100", "n150", "n151", "extras"]);
    expect(total).toBe(6);
  });

  it("pages the flat listing without gaps or repeats", async () => {
    serve(seriesServer());
    const first = await fetchFolderContents("series", { limit: 4 });
    const second = await fetchFolderContents("series", { limit: 4, startIndex: 4 });
    expect([...first.items, ...second.items].map((item) => item.Id)).toEqual(["n001", "n002", "n100", "n150", "n151", "extras"]);
    expect(first.total).toBe(6);
    expect(second.total).toBe(6);
  });

  it("keeps the server's seasons when the loose files state a season", async () => {
    const marked = [{ ...episode("001", 1, 1), Name: "Show S01E01", Path: `${ROOT}/Show S01E01.mkv` }];
    serve(seriesServer(marked));
    const { items } = await fetchFolderContents("series", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["specials", "s1", "s2", "extras"]);
  });

  it("keeps the server's seasons when every season is a folder", async () => {
    serve((url) => (url.searchParams.get("ParentId") === "series" && url.searchParams.get("Recursive") === "false" ? list([extrasFolder]) : null));
    const { items } = await fetchFolderContents("series", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["extras"]);
  });

  it("keeps the server's seasons when the episode sweep fails", async () => {
    const route = seriesServer();
    global.fetch = jest.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get("IncludeItemTypes") === "Episode") return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => route(url) ?? list([]) };
    }) as unknown as typeof fetch;
    const { items } = await fetchFolderContents("series", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["specials", "s1", "s2", "extras"]);
  });

  it("lists only the folders when every file sits in one and the seasons regroup them", async () => {
    const partOne = { Id: "part1", Name: "Part 1", Type: "Season", Path: `${ROOT}/Part 1`, SeriesId: "series" };
    const filed = { Id: "e1", Name: "Show S01E01", Path: `${ROOT}/Part 1/Show S01E01.mkv`, Type: "Episode", SeriesId: "series", ParentIndexNumber: 1, IndexNumber: 1 };
    serve((url) => {
      const p = url.searchParams;
      if (p.get("IncludeItemTypes") === "Episode") return list([filed]);
      if (p.get("Recursive") === "false") return list([{ Id: "s1", Name: "Season 1", Type: "Season", IndexNumber: 1 }, partOne]);
      return null;
    });
    const { items } = await fetchFolderContents("series", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["part1"]);
  });

  it("lists a numberless season folder's files from their paths", async () => {
    serve(seriesServer());
    const { items, total } = await fetchFolderContents("extras", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["special"]);
    expect(total).toBe(1);
  });

  it("previews and queues a numberless season folder from the same files", async () => {
    serve(seriesServer());
    expect((await fetchFolderPreviewItems("extras")).map((item) => item.Id)).toEqual(["special"]);
    expect((await fetchRecursiveVideos("extras")).map((item) => item.Id)).toEqual(["special"]);
  });

  it("lists each file of an episode the server merged by its folder's pair as its own card", async () => {
    const merged = { ...special, MediaSourceCount: 3 };
    const sources = ["special", "special-b", "special-c"].map((id) => ({ Id: id, Path: `${ROOT}/Extras/Show - ${id}.mkv` }));
    serve((url) => {
      const version = sources.find((source) => url.pathname === `/Items/${source.Id}`);
      if (version && url.searchParams.get("Fields") === "Path,MediaSources") return { ...merged, MediaSources: sources };
      if (version)
        return {
          Id: version.Id,
          Name: `Show - ${version.Id}`,
          Path: version.Path,
          Type: "Episode",
          SeriesId: "series",
          ParentIndexNumber: 1,
          IndexNumber: 3,
          ImageTags: { Primary: "shared", Thumb: "own" },
        };
      return seriesServer([...EPISODES.filter((item) => item !== special), merged])(url);
    });
    const { items, total } = await fetchFolderContents("extras", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["special", "special-b", "special-c"]);
    expect(items.every((item) => item.IndexNumber === undefined && item.ParentIndexNumber === undefined)).toBe(true);
    expect(items.map((item) => item.ImageTags)).toEqual([{ Thumb: "own" }, { Thumb: "own" }, { Thumb: "own" }]);
    expect(total).toBe(3);
    const series = await fetchFolderContents("series", { limit: 60 });
    expect(series.items.find((item) => item.Id === "extras")?.ChildCount).toBe(3);
  });

  it("keeps real versions merged when each file name states the pair", async () => {
    const merged = { ...special, MediaSourceCount: 2 };
    const sources = [
      { Id: "special", Path: `${ROOT}/Extras/Show S01E03 - 1080p.mkv` },
      { Id: "special-720", Path: `${ROOT}/Extras/Show S01E03 - 720p.mkv` },
    ];
    serve((url) => {
      if (url.pathname === "/Items/special") return { ...merged, MediaSources: sources };
      return seriesServer([...EPISODES.filter((item) => item !== special), merged])(url);
    });
    const { items } = await fetchFolderContents("extras", { limit: 60 });
    expect(items.map((item) => item.Id)).toEqual(["special"]);
  });

  it("leaves an empty folder empty when it is not a numberless season", async () => {
    serve((url) => (url.pathname === "/Items/plain" ? { Id: "plain", Type: "Folder", Path: "/media/plain" } : null));
    expect(await fetchFolderContents("plain", { limit: 60 })).toEqual({ items: [], total: 0 });
  });

  it("queues a split-run series in episode order", async () => {
    serve((url) => (url.searchParams.get("ParentId") === "series" && url.searchParams.get("Recursive") === "true" ? list(EPISODES) : null));
    const queue = await fetchRecursiveVideos("series");
    expect(queue.map((item) => item.Id)).toEqual(["n001", "n002", "n100", "n150", "n151", "special"]);
  });
});
