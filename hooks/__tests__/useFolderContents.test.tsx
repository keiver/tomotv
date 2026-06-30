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
import { JellyfinItem } from "@/types/jellyfin";

jest.mock("@/hooks/useAppStateRefresh", () => ({ useAppStateRefresh: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchUserViews: jest.fn(),
  fetchFolderContents: jest.fn(),
  fetchPlaylistContents: jest.fn(),
}));

import { fetchFolderContents, fetchPlaylistContents, fetchUserViews } from "@/services/jellyfinApi";

const mockUserViews = fetchUserViews as jest.Mock;
const mockFolder = fetchFolderContents as jest.Mock;
const mockPlaylist = fetchPlaylistContents as jest.Mock;

type Hook = ReturnType<typeof useFolderContents>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef, { folderId: string | null; type?: "folder" | "playlist" }>(({ folderId, type }, ref) => {
  const result = useFolderContents(folderId, type);
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
});
