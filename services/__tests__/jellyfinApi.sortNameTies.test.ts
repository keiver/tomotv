/**
 * The queue and sweep fetchers order same-named neighbours by season/episode. The server sorts
 * SortName then Name and nothing after, so a flat episode folder a mixed library scanned as ten
 * "Show" movies comes back in row order; the grid, the play queue, the filtered queue and the
 * photo sweep must all agree on the corrected order.
 */
import { EMPTY_FILTERS, JellyfinItem } from "@/types/jellyfin";
import { fetchFilteredVideos, fetchFolderPhotos, fetchRecursiveVideos, refreshConfig } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

describe("SortName tie ordering in the queue and sweep fetchers", () => {
  const mockSecureStore = require("expo-secure-store");

  const episode = (n: number, extra: Partial<JellyfinItem> = {}): JellyfinItem =>
    ({
      Id: `e${n}`,
      Name: "Raised by Wolves",
      Type: "Movie",
      MediaType: "Video",
      Path: `/media/Raised.by.Wolves.S01/Raised.by.Wolves.2020.S01E${String(n).padStart(2, "0")}.mkv`,
      ...extra,
    }) as JellyfinItem;
  const ROW_ORDER = [4, 6, 2, 3, 8, 1, 7, 5, 10, 9];
  const EXPECTED = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"];

  beforeEach(async () => {
    global.fetch = jest.fn();
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Serves `items` a page at a time in the given order, honoring StartIndex/Limit. */
  function serve(pick: (url: URL) => JellyfinItem[]) {
    (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
      const url = new URL(input);
      const items = pick(url);
      const startIndex = Number(url.searchParams.get("StartIndex") ?? 0);
      const limit = Number(url.searchParams.get("Limit") ?? 60);
      return { ok: true, json: async () => ({ Items: items.slice(startIndex, startIndex + limit), TotalRecordCount: items.length }) };
    });
  }

  describe("fetchRecursiveVideos (the folder play queue)", () => {
    it("returns the recursive sweep in season/episode order", async () => {
      serve(() => ROW_ORDER.map((n) => episode(n)));
      const queue = await fetchRecursiveVideos("ties-recursive");
      expect(queue.map((v) => v.Id)).toEqual(EXPECTED);
    });

    it("orders a run that straddles the 500-item page boundary", async () => {
      const filler = Array.from({ length: 499 }, (_, i) => ({ Id: `f${i}`, Name: `Filler ${String(i).padStart(3, "0")}`, Type: "Movie", Path: `/m/f${i}.mkv` }) as JellyfinItem);
      serve(() => [...filler, episode(2), episode(1)]);
      const queue = await fetchRecursiveVideos("ties-straddle");
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(queue.slice(-2).map((v) => v.Id)).toEqual(["e1", "e2"]);
      expect(queue.slice(0, 499).map((v) => v.Id)).toEqual(filler.map((v) => v.Id));
    });

    it("orders the direct-children fallback too", async () => {
      serve((url) => (url.searchParams.get("Recursive") === "true" ? [] : [episode(2), episode(1)]));
      const queue = await fetchRecursiveVideos("ties-direct");
      expect(queue.map((v) => v.Id)).toEqual(["e1", "e2"]);
    });

    it("leaves differently named videos in server order", async () => {
      const list = [
        { Id: "a", Name: "Alpha", Type: "Movie", Path: "/x/Alpha.S01E09.mkv" },
        { Id: "b", Name: "Beta", Type: "Movie", Path: "/x/Beta.S01E01.mkv" },
      ] as JellyfinItem[];
      serve(() => list);
      const queue = await fetchRecursiveVideos("ties-distinct");
      expect(queue.map((v) => v.Id)).toEqual(["a", "b"]);
    });
  });

  describe("fetchFilteredVideos (the filtered play queue)", () => {
    it("returns the filtered set in season/episode order", async () => {
      serve((url) => (url.pathname.endsWith("/Items") ? ROW_ORDER.map((n) => episode(n)) : []));
      const queue = await fetchFilteredVideos("ties-filtered", { ...EMPTY_FILTERS, genres: ["Drama"] });
      expect(queue.map((v) => v.Id)).toEqual(EXPECTED);
    });
  });

  describe("fetchFolderPhotos (the viewer's sweep)", () => {
    it("mirrors the grid's corrected order for same-named photos", async () => {
      const photo = (n: number): JellyfinItem => ({ Id: `p${n}`, Name: "Trip", Type: "Photo", Path: `/pics/Trip.S01E${String(n).padStart(2, "0")}.jpg` }) as JellyfinItem;
      serve(() => [photo(3), { Id: "v", Name: "Trip", Type: "Movie", Path: "/pics/Trip.S01E02.mp4" } as JellyfinItem, photo(1)]);
      const photos = await fetchFolderPhotos("ties-photos");
      expect(photos.map((p) => p.Id)).toEqual(["p1", "p3"]);
    });
  });
});
