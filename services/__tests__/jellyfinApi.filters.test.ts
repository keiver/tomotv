/**
 * Tests for the library-filters API surface (issue #54): filtered fetchFolderContents
 * (recursive flatten, Filters/Genres/ArtistIds params, shuffle sort), the /Genres and
 * /Artists metadata endpoints, and the favorite toggle + its pub/sub.
 *
 * Split from jellyfinApi.test.ts to keep that file from growing further.
 */
import { fetchFilteredVideos, fetchFolderContents, fetchLibraryGenres, fetchLibraryArtists, setVideoFavorite, subscribeFavoriteChange } from "../jellyfinApi";
import { EMPTY_FILTERS } from "@/types/jellyfin";

// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock managers to prevent cache clearing errors in tests
jest.mock("@/services/libraryManager", () => ({
  libraryManager: {
    clearCache: jest.fn(),
  },
}));

describe("library filters (issue #54)", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(() => {
    // Default: an empty answer for anything not explicitly queued. A user-data filter now checks
    // /Users/{id}/Views first (a library root can't answer those filters server-side, see
    // fetchViewRootFiltered), and an empty Views list keeps every case here on the server-side path.
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ Items: [], TotalRecordCount: 0, StartIndex: 0 }) })) as unknown as typeof fetch;

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const emptyItemsResponse = { Items: [], TotalRecordCount: 0, StartIndex: 0 };

  function lastRequestUrl(): URL {
    const calls = (global.fetch as jest.Mock).mock.calls;
    return new URL(calls[calls.length - 1][0] as string);
  }

  describe("fetchFolderContents with filters", () => {
    it("keeps the legacy non-recursive browse query when no filters are active", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1");

      const url = lastRequestUrl();
      expect(url.searchParams.get("Recursive")).toBeNull();
      expect(url.searchParams.get("Filters")).toBeNull();
      expect(url.searchParams.get("Genres")).toBeNull();
      expect(url.searchParams.get("SortBy")).toBe("SortName");
      expect(url.searchParams.get("IncludeItemTypes")).toContain("Folder");
    });

    it("flattens to a recursive MediaTypes query when a filter is active", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, favorite: true } });

      const url = lastRequestUrl();
      expect(url.searchParams.get("Recursive")).toBe("true");
      expect(url.searchParams.get("Filters")).toBe("IsFavorite");
      // MediaTypes, NOT IncludeItemTypes: Jellyfin 10.11 view-root recursive queries return
      // zero results with IncludeItemTypes for music/musicvideos/photos/tvshows libraries.
      // Folders carry no MediaType, so the flatten still excludes them.
      expect(url.searchParams.get("MediaTypes")).toBe("Video,Audio,Photo");
      expect(url.searchParams.get("IncludeItemTypes")).toBeNull();
    });

    it("combines status filters comma-delimited", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, favorite: true, unplayed: true } });

      expect(lastRequestUrl().searchParams.get("Filters")).toBe("IsFavorite,IsUnplayed");
    });

    it("sends multiple genres PIPE-delimited, never comma (the PR #51 bug)", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, genres: ["Rock", "Jazz"] } });

      expect(lastRequestUrl().searchParams.get("Genres")).toBe("Rock|Jazz");
    });

    it("filters by a decade-named genre as a genre, not a year", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, genres: ["90s"] } });

      const url = lastRequestUrl();
      expect(url.searchParams.get("Genres")).toBe("90s");
      expect(url.searchParams.get("Years")).toBeNull();
    });

    it("sends artist ids COMMA-delimited and switches to IncludeItemTypes", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, artistIds: ["artist-1", "artist-2"] } });

      const url = lastRequestUrl();
      // ArtistIds is COMMA-delimited (pipe is ignored and returns the whole library) — the
      // opposite of Genres. Verified against the real server.
      expect(url.searchParams.get("ArtistIds")).toBe("artist-1,artist-2");
      // ArtistIds is honored only with IncludeItemTypes on 10.11 view-root queries; MediaTypes
      // silently ignores it. Artists live on Audio/MusicVideo items.
      expect(url.searchParams.get("IncludeItemTypes")).toBe("Audio,MusicVideo");
      expect(url.searchParams.get("MediaTypes")).toBeNull();
    });

    it("uses IncludeItemTypes when artist is combined with genre/status; genre pipe, artist comma", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, favorite: true, genres: ["Rock", "Jazz"], artistIds: ["a1", "a2"] } });

      const url = lastRequestUrl();
      expect(url.searchParams.get("IncludeItemTypes")).toBe("Audio,MusicVideo");
      expect(url.searchParams.get("MediaTypes")).toBeNull();
      expect(url.searchParams.get("Filters")).toBe("IsFavorite");
      expect(url.searchParams.get("Genres")).toBe("Rock|Jazz");
      expect(url.searchParams.get("ArtistIds")).toBe("a1,a2");
    });

    it("shuffle switches SortBy to Random", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1", { filters: { ...EMPTY_FILTERS, shuffle: true } });

      expect(lastRequestUrl().searchParams.get("SortBy")).toBe("Random");
    });

    it("requests UserData so favorite state reaches the UI", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => emptyItemsResponse });

      await fetchFolderContents("folder-1");

      expect(lastRequestUrl().searchParams.get("EnableUserData")).toBe("true");
    });
  });

  describe("fetchFilteredVideos (full-set queue source)", () => {
    it("uses the same flatten filter shape as the grid, with a stable SortName order", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [{ Id: "a" }], TotalRecordCount: 1 }) });

      await fetchFilteredVideos("lib-1", { ...EMPTY_FILTERS, genres: ["Rock", "Jazz"], shuffle: true });

      const url = lastRequestUrl();
      expect(url.searchParams.get("Recursive")).toBe("true");
      expect(url.searchParams.get("Genres")).toBe("Rock|Jazz");
      expect(url.searchParams.get("MediaTypes")).toBe("Video,Audio,Photo");
      // Fetched stably even when shuffle is on — shuffle happens client-side, not via SortBy=Random,
      // so pagination can't duplicate/miss items.
      expect(url.searchParams.get("SortBy")).toBe("SortName");
    });

    it("switches to IncludeItemTypes for artist filters, comma-delimited ids", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [], TotalRecordCount: 0 }) });

      await fetchFilteredVideos("lib-1", { ...EMPTY_FILTERS, artistIds: ["a1", "a2"] });

      const url = lastRequestUrl();
      expect(url.searchParams.get("IncludeItemTypes")).toBe("Audio,MusicVideo");
      expect(url.searchParams.get("MediaTypes")).toBeNull();
      expect(url.searchParams.get("ArtistIds")).toBe("a1,a2");
    });

    it("paginates until the full set is collected", async () => {
      const page = (n: number) => ({ Items: Array.from({ length: n }, (_, i) => ({ Id: `id-${i}` })), TotalRecordCount: 500 + 3 });
      const pages = [page(500), page(3)];
      // Route by URL: the favorite filter checks /Views first (an empty list means "not a library
      // root", so this stays on the server-side paging path being tested here).
      let itemCalls = 0;
      (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
        if (new URL(input).pathname.endsWith("/Views")) return { ok: true, json: async () => ({ Items: [] }) };
        const body = pages[itemCalls++] ?? { Items: [] };
        return { ok: true, json: async () => body };
      });

      const result = await fetchFilteredVideos("lib-1", { ...EMPTY_FILTERS, favorite: true });

      expect(itemCalls).toBe(2);
      expect(result).toHaveLength(503);
    });
  });

  describe("fetchLibraryGenres", () => {
    function mockGenreEndpoints(byPath: Record<string, unknown>) {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        const { pathname } = new URL(url);
        return Promise.resolve({ ok: true, json: async () => byPath[pathname] ?? { Items: [] } });
      });
    }

    it("merges /Genres and /MusicGenres scoped to the library and user", async () => {
      // Both entity endpoints: video genres and music genres are separate entities in
      // Jellyfin, and music-typed items index theirs under /MusicGenres.
      mockGenreEndpoints({
        "/Genres": {
          Items: [
            { Id: "g1", Name: "Rock" },
            { Id: "g2", Name: "90s" },
          ],
        },
        "/MusicGenres": {
          Items: [
            { Id: "m1", Name: "Jazz" },
            { Id: "m2", Name: "Rock" },
          ],
        },
      });

      const result = await fetchLibraryGenres("library-1");

      const calledPaths = (global.fetch as jest.Mock).mock.calls.map((call) => new URL(call[0] as string));
      expect(calledPaths.map((u) => u.pathname).sort()).toEqual(["/Genres", "/MusicGenres"]);
      calledPaths.forEach((u) => {
        expect(u.searchParams.get("ParentId")).toBe("library-1");
        expect(u.searchParams.get("UserId")).toBe("test-user-id");
      });
      expect(result).toEqual(["90s", "Jazz", "Rock"]); // deduped + sorted
    });

    it("still returns one endpoint's genres when the other fails", async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (new URL(url).pathname === "/MusicGenres") return Promise.resolve({ ok: false, status: 500 });
        return Promise.resolve({ ok: true, json: async () => ({ Items: [{ Id: "g1", Name: "Rock" }] }) });
      });

      expect(await fetchLibraryGenres("library-1")).toEqual(["Rock"]);
    });

    it("returns empty when the library has no genre entities", async () => {
      mockGenreEndpoints({});

      expect(await fetchLibraryGenres("library-1")).toEqual([]);
    });
  });

  describe("fetchLibraryArtists", () => {
    it("queries /Artists scoped to the library and user", async () => {
      const mockResponse = { Items: [{ Id: "a1", Name: "Lake Street Dive" }] };
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => mockResponse });

      const result = await fetchLibraryArtists("library-1");

      const url = lastRequestUrl();
      expect(url.pathname).toBe("/Artists");
      expect(url.searchParams.get("ParentId")).toBe("library-1");
      expect(url.searchParams.get("UserId")).toBe("test-user-id");
      expect(result).toEqual(mockResponse.Items);
    });

    it("returns empty for libraries without artists (hides the section)", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      expect(await fetchLibraryArtists("library-1")).toEqual([]);
    });
  });

  describe("setVideoFavorite", () => {
    it("POSTs to FavoriteItems when marking", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await setVideoFavorite("video-1", true);

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/Users/test-user-id/FavoriteItems/video-1"), expect.objectContaining({ method: "POST" }));
    });

    it("DELETEs from FavoriteItems when unmarking", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await setVideoFavorite("video-1", false);

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/Users/test-user-id/FavoriteItems/video-1"), expect.objectContaining({ method: "DELETE" }));
    });

    it("notifies favorite subscribers on success and stops after unsubscribe", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
      const listener = jest.fn();
      const unsubscribe = subscribeFavoriteChange(listener);

      await setVideoFavorite("video-1", true);
      expect(listener).toHaveBeenCalledTimes(1);
      // Carries the toggled id + new state so subscribers can repaint that card in place.
      expect(listener).toHaveBeenCalledWith("video-1", true);

      unsubscribe();
      await setVideoFavorite("video-1", false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify subscribers when the request fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
      const listener = jest.fn();
      const unsubscribe = subscribeFavoriteChange(listener);

      await expect(setVideoFavorite("video-1", true)).rejects.toThrow();
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
});
