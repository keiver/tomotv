/**
 * Tests for the useFolderContents hook: first-page load (root / folder / playlist), the per-folder
 * cache with its TTL, pagination via loadMore, error handling, and refresh. Rendered with
 * react-test-renderer (the project's hook-testing pattern) through a null-rendering harness that
 * exposes the hook's return value via a ref.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useFolderContents } from "@/hooks/useFolderContents";
import { clearFolderContentsCache } from "@/services/folderContentsCache";
import { addFavoriteIds, clearFavoriteIdsCache } from "@/services/favoritesCache";
import { EMPTY_FILTERS, JellyfinItem, LibraryFilters } from "@/types/jellyfin";

jest.mock("@/hooks/useAppStateRefresh", () => ({ useAppStateRefresh: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchUserViews: jest.fn(),
  fetchFolderContents: jest.fn(),
  fetchPlaylistContents: jest.fn(),
  fetchFavoriteIds: jest.fn(() => Promise.resolve(new Set<string>())),
}));

import { fetchFavoriteIds, fetchFolderContents, fetchPlaylistContents, fetchUserViews } from "@/services/jellyfinApi";

const mockUserViews = fetchUserViews as jest.Mock;
const mockFolder = fetchFolderContents as jest.Mock;
const mockPlaylist = fetchPlaylistContents as jest.Mock;
const mockFavoriteIds = fetchFavoriteIds as jest.Mock;

type Hook = ReturnType<typeof useFolderContents>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef, { folderId: string | null; type?: "folder" | "playlist"; filters?: LibraryFilters }>(({ folderId, type, filters }, ref) => {
  const result = useFolderContents(folderId, type, filters);
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

const items = (...ids: string[]): JellyfinItem[] => ids.map((id) => ({ Id: id, Name: id, Type: "Folder" }) as JellyfinItem);

const NOW = 1_000_000;

async function mount(folderId: string | null, type?: "folder" | "playlist") {
  const ref = React.createRef<HookRef>();
  await act(async () => {
    TestRenderer.create(<Harness ref={ref} folderId={folderId} type={type} />);
  });
  return ref;
}

describe("useFolderContents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearFolderContentsCache();
    clearFavoriteIdsCache();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    (Date.now as jest.Mock).mockRestore();
  });

  describe("first page", () => {
    it("loads the libraries root from fetchUserViews when folderId is null", async () => {
      mockUserViews.mockResolvedValue({ items: items("movies", "shows"), total: undefined });
      const ref = await mount(null);
      expect(mockUserViews).toHaveBeenCalledTimes(1);
      expect(mockFolder).not.toHaveBeenCalled();
      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["movies", "shows"]);
      expect(ref.current!.get().isLoading).toBe(false);
      expect(ref.current!.get().hasMoreResults).toBe(false);
    });

    it("loads a folder from fetchFolderContents with the first-page params", async () => {
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });
      const ref = await mount("folder-1");
      expect(mockFolder).toHaveBeenCalledWith("folder-1", { limit: 60, startIndex: 0 });
      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["a"]);
    });

    it("loads a playlist from fetchPlaylistContents when type is playlist", async () => {
      mockPlaylist.mockResolvedValue({ items: items("track"), total: 1 });
      const ref = await mount("pl-1", "playlist");
      expect(mockPlaylist).toHaveBeenCalledWith("pl-1", { limit: 60, startIndex: 0 });
      expect(mockFolder).not.toHaveBeenCalled();
      expect(ref.current!.get().items[0].Id).toBe("track");
    });

    it("sets error and clears items when the fetch rejects", async () => {
      mockFolder.mockRejectedValue(new Error("boom"));
      const ref = await mount("folder-x");
      expect(ref.current!.get().error).toBe("boom");
      expect(ref.current!.get().items).toEqual([]);
      expect(ref.current!.get().isLoading).toBe(false);
    });
  });

  describe("favorite hearts", () => {
    it("annotates unfiltered items with IsFavorite from a warm cache", async () => {
      addFavoriteIds(["a"]);
      mockFolder.mockResolvedValue({ items: items("a", "b"), total: 2 });

      const ref = await mount("album-1");

      const [a, b] = ref.current!.get().items;
      expect(a.UserData?.IsFavorite).toBe(true);
      expect(b.UserData?.IsFavorite).toBeUndefined();
      // Warm cache → no cold load fired.
      expect(mockFavoriteIds).not.toHaveBeenCalled();
    });

    it("cold-loads favorites once when the cache is empty, then annotates", async () => {
      mockFolder.mockResolvedValue({ items: items("a", "b"), total: 2 });
      // The real fetchFavoriteIds seeds the cache; mirror that here so annotate() sees the id.
      mockFavoriteIds.mockImplementation(async () => {
        addFavoriteIds(["a"]);
        return new Set(["a"]);
      });

      const ref = await mount("album-1");

      expect(mockFavoriteIds).toHaveBeenCalledWith("album-1");
      expect(ref.current!.get().items.find((i) => i.Id === "a")?.UserData?.IsFavorite).toBe(true);
    });

    it("does not annotate (or cold-load) while filtered — the server already carries favorite state", async () => {
      addFavoriteIds(["a"]);
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });

      const ref = React.createRef<HookRef>();
      await act(async () => {
        TestRenderer.create(<Harness ref={ref} folderId="album-1" filters={{ ...EMPTY_FILTERS, favorite: true }} />);
      });

      // Guard returns the list untouched; no extra favorites fetch for a filtered view.
      expect(ref.current!.get().items[0].UserData?.IsFavorite).toBeUndefined();
      expect(mockFavoriteIds).not.toHaveBeenCalled();
    });
  });

  describe("caching", () => {
    it("serves the first page from cache within the TTL (no second fetch)", async () => {
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });
      await mount("folder-1");
      expect(mockFolder).toHaveBeenCalledTimes(1);

      (Date.now as jest.Mock).mockReturnValue(NOW + 60_000); // +1 min, within the 5 min TTL
      const ref = await mount("folder-1");
      expect(mockFolder).toHaveBeenCalledTimes(1);
      expect(ref.current!.get().items[0].Id).toBe("a");
    });

    it("refetches once the cache entry is older than the TTL", async () => {
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });
      await mount("folder-1");
      expect(mockFolder).toHaveBeenCalledTimes(1);

      (Date.now as jest.Mock).mockReturnValue(NOW + 6 * 60_000); // +6 min, past the 5 min TTL
      await mount("folder-1");
      expect(mockFolder).toHaveBeenCalledTimes(2);
    });
  });

  describe("pagination", () => {
    it("reports hasMoreResults when total exceeds the first page", async () => {
      mockFolder.mockResolvedValue({ items: items("a", "b"), total: 5 });
      const ref = await mount("folder-1");
      expect(ref.current!.get().hasMoreResults).toBe(true);
    });

    it("appends the next page and advances startIndex on loadMore", async () => {
      mockFolder.mockResolvedValueOnce({ items: items("a", "b"), total: 4 }).mockResolvedValueOnce({ items: items("c", "d"), total: 4 });
      const ref = await mount("folder-1");

      await act(async () => {
        ref.current!.get().loadMore();
      });

      expect(mockFolder).toHaveBeenNthCalledWith(2, "folder-1", { limit: 60, startIndex: 2 });
      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["a", "b", "c", "d"]);
      expect(ref.current!.get().hasMoreResults).toBe(false);
    });

    it("does nothing on loadMore when there are no more results", async () => {
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });
      const ref = await mount("folder-1");

      await act(async () => {
        ref.current!.get().loadMore();
      });
      expect(mockFolder).toHaveBeenCalledTimes(1);
    });
  });

  describe("overlapping loads", () => {
    it("ignores a stale first-page load that resolves after a refresh", async () => {
      let resolveInitial!: (v: { items: JellyfinItem[]; total?: number }) => void;
      const initial = new Promise<{ items: JellyfinItem[]; total?: number }>((r) => {
        resolveInitial = r;
      });
      mockFolder.mockReturnValueOnce(initial).mockResolvedValueOnce({ items: items("fresh"), total: 1 });

      const ref = await mount("folder-1"); // initial fetch still in flight
      expect(ref.current!.get().isLoading).toBe(true);

      await act(async () => {
        ref.current!.get().refresh(); // newer load resolves with "fresh"
      });
      expect(ref.current!.get().items[0].Id).toBe("fresh");

      await act(async () => {
        resolveInitial({ items: items("stale"), total: 1 }); // older load resolves last
        await initial;
      });

      expect(ref.current!.get().items[0].Id).toBe("fresh"); // stale result is dropped
    });

    it("drops an in-flight loadMore page when a refresh replaces the list", async () => {
      let resolveMore!: (v: { items: JellyfinItem[]; total?: number }) => void;
      const morePage = new Promise<{ items: JellyfinItem[]; total?: number }>((r) => {
        resolveMore = r;
      });
      mockFolder
        .mockResolvedValueOnce({ items: items("a", "b"), total: 4 }) // first page (more available)
        .mockReturnValueOnce(morePage) // loadMore — left in flight
        .mockResolvedValueOnce({ items: items("fresh"), total: 1 }); // refresh replaces the list

      const ref = await mount("folder-1");
      expect(ref.current!.get().hasMoreResults).toBe(true);

      act(() => {
        ref.current!.get().loadMore(); // in flight, not awaited
      });
      await act(async () => {
        ref.current!.get().refresh(); // newer first-page load wins
      });
      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["fresh"]);

      await act(async () => {
        resolveMore({ items: items("c", "d"), total: 4 }); // stale page resolves last
        await morePage;
      });

      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["fresh"]); // not ["fresh","c","d"]
    });
  });

  describe("refresh", () => {
    it("drops the cache and refetches fresh data", async () => {
      mockFolder.mockResolvedValueOnce({ items: items("old"), total: 1 }).mockResolvedValueOnce({ items: items("new"), total: 1 });
      const ref = await mount("folder-1");
      expect(ref.current!.get().items[0].Id).toBe("old");

      await act(async () => {
        ref.current!.get().refresh();
      });

      expect(mockFolder).toHaveBeenCalledTimes(2);
      expect(ref.current!.get().items[0].Id).toBe("new");
    });
  });

  describe("library filters (issue #54)", () => {
    async function mountWithFilters(folderId: string, filters?: LibraryFilters) {
      const ref = React.createRef<HookRef>();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(<Harness ref={ref} folderId={folderId} filters={filters} />);
      });
      const setFilters = async (next?: LibraryFilters) => {
        await act(async () => {
          renderer.update(<Harness ref={ref} folderId={folderId} filters={next} />);
        });
      };
      return { ref, setFilters };
    }

    it("passes active filters through to fetchFolderContents", async () => {
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });
      const filters = { ...EMPTY_FILTERS, favorite: true };

      await mountWithFilters("folder-1", filters);

      expect(mockFolder).toHaveBeenCalledWith("folder-1", { limit: 60, startIndex: 0, filters });
    });

    it("refetches from page one when the selection changes", async () => {
      mockFolder.mockResolvedValue({ items: items("a"), total: 1 });
      const { setFilters } = await mountWithFilters("folder-1", { ...EMPTY_FILTERS, favorite: true });
      expect(mockFolder).toHaveBeenCalledTimes(1);

      await setFilters({ ...EMPTY_FILTERS, favorite: true, genres: ["Rock"] });

      expect(mockFolder).toHaveBeenCalledTimes(2);
      expect(mockFolder).toHaveBeenLastCalledWith("folder-1", { limit: 60, startIndex: 0, filters: { ...EMPTY_FILTERS, favorite: true, genres: ["Rock"] } });
    });

    it("bypasses the cache while filtered and never poisons the unfiltered entry", async () => {
      mockFolder.mockResolvedValue({ items: items("plain"), total: 1 });
      await mount("folder-1"); // unfiltered — cached
      expect(mockFolder).toHaveBeenCalledTimes(1);

      mockFolder.mockResolvedValue({ items: items("filtered"), total: 1 });
      await mountWithFilters("folder-1", { ...EMPTY_FILTERS, favorite: true }); // must not read the cache
      expect(mockFolder).toHaveBeenCalledTimes(2);

      const ref = await mount("folder-1"); // unfiltered again, within TTL — original cache survives
      expect(mockFolder).toHaveBeenCalledTimes(2);
      expect(ref.current!.get().items[0].Id).toBe("plain");
    });

    it("drops repeated ids across shuffled pages (SortBy=Random reshuffles per request)", async () => {
      const shuffle = { ...EMPTY_FILTERS, shuffle: true };
      mockFolder.mockResolvedValueOnce({ items: items("a", "b"), total: 4 }).mockResolvedValueOnce({ items: items("b", "c"), total: 4 });
      const { ref } = await mountWithFilters("folder-1", shuffle);

      await act(async () => {
        ref.current!.get().loadMore();
      });

      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["a", "b", "c"]);
    });

    it("halts pagination when a shuffled page is all duplicates", async () => {
      const shuffle = { ...EMPTY_FILTERS, shuffle: true };
      mockFolder.mockResolvedValueOnce({ items: items("a", "b"), total: 6 }).mockResolvedValueOnce({ items: items("a", "b"), total: 6 });
      const { ref } = await mountWithFilters("folder-1", shuffle);
      expect(ref.current!.get().hasMoreResults).toBe(true);

      await act(async () => {
        ref.current!.get().loadMore();
      });

      expect(ref.current!.get().items.map((i) => i.Id)).toEqual(["a", "b"]);
      expect(ref.current!.get().hasMoreResults).toBe(false);
    });
  });
});
