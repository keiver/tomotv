/**
 * Tests for fetchItemFolderPath — the ancestor walk behind "Show In Folder" on a Continue
 * Watching card. It turns an item id into the breadcrumb the folder route takes: library
 * root first, immediate parent last, with the server's own containers above the library
 * dropped. Every case uses a distinct item id so the shared request cache can't serve one
 * test's answer to another.
 */
import { fetchItemFolderPath, refreshConfig } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: {
    clearCache: jest.fn(),
  },
}));

describe("fetchItemFolderPath", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });

    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastRequestUrl(): URL {
    const calls = (global.fetch as jest.Mock).mock.calls;
    return new URL(calls[calls.length - 1][0] as string);
  }

  it("GETs the item's Ancestors endpoint scoped to the signed-in user", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => [] });

    await fetchItemFolderPath("item-url");

    const url = lastRequestUrl();
    expect(url.pathname).toBe("/Items/item-url/Ancestors");
    // Without userId the server answers with the physical tree instead of the user's own library
    expect(url.searchParams.get("userId")).toBe("test-user-id");
  });

  it("reverses the nearest-first response into a breadcrumb and stops at the library", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      // The order the server answers in: immediate parent first, walking up to its root.
      json: async () => [
        { Id: "season-1", Name: "Season 1", Type: "Season" },
        { Id: "series-1", Name: "Star Trek", Type: "Series" },
        { Id: "lib-tv", Name: "Shows", Type: "CollectionFolder" },
        // Above the library: never browsable in the app, whatever the server calls it.
        { Id: "media-folders", Name: "Media Folders", Type: "Folder" },
        { Id: "root", Name: "Root", Type: "UserRootFolder" },
      ],
    });

    await expect(fetchItemFolderPath("item-episode")).resolves.toEqual([
      { id: "lib-tv", name: "Shows", type: "folder" },
      { id: "series-1", name: "Star Trek", type: "folder" },
      { id: "season-1", name: "Season 1", type: "folder" },
    ]);
  });

  it("marks a playlist hop so the folder route uses the playlist endpoint", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { Id: "pl-1", Name: "Road Trip", Type: "Playlist" },
        { Id: "lib-music", Name: "Music", Type: "CollectionFolder" },
      ],
    });

    await expect(fetchItemFolderPath("item-playlist")).resolves.toEqual([
      { id: "lib-music", name: "Music", type: "folder" },
      { id: "pl-1", name: "Road Trip", type: "playlist" },
    ]);
  });

  it("returns an empty path when the item has no ancestors", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => [] });

    await expect(fetchItemFolderPath("item-orphan")).resolves.toEqual([]);
  });

  it("returns an empty path on a server error so the caller can say so", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(fetchItemFolderPath("item-500")).resolves.toEqual([]);
  });

  it("returns an empty path on a network error without throwing", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));

    await expect(fetchItemFolderPath("item-offline")).resolves.toEqual([]);
  });
});
