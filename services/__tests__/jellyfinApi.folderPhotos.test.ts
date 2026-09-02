/**
 * Tests for fetchFolderPhotos, the set the photo viewer steps through. The viewer used to open
 * on one 60-item page, so a photo sorting past it landed at index -1 and the folder's FIRST
 * photo opened instead. Each case uses a distinct folder id so the shared request cache can't
 * serve one test's answer to another.
 */
import { JellyfinItem } from "@/types/jellyfin";
import { fetchFolderPhotos, refreshConfig } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

describe("fetchFolderPhotos", () => {
  const mockSecureStore = require("expo-secure-store");

  const photo = (id: string): JellyfinItem => ({ Id: id, Name: id, Type: "Photo" }) as JellyfinItem;
  const video = (id: string): JellyfinItem => ({ Id: id, Name: id, Type: "Movie" }) as JellyfinItem;

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

  /** Serves `items` a page at a time, honoring StartIndex/Limit the way the server does. */
  function serveFolder(items: JellyfinItem[]) {
    (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
      const url = new URL(input);
      const startIndex = Number(url.searchParams.get("StartIndex") ?? 0);
      const limit = Number(url.searchParams.get("Limit") ?? 60);
      return {
        ok: true,
        json: async () => ({ Items: items.slice(startIndex, startIndex + limit), TotalRecordCount: items.length }),
      };
    });
  }

  it("sweeps past the first page so a late photo is in the set", async () => {
    const items = Array.from({ length: 1200 }, (_, i) => photo(`late-p${i}`));
    serveFolder(items);

    const photos = await fetchFolderPhotos("folder-late");

    expect(photos).toHaveLength(1200);
    expect(photos.findIndex((p) => p.Id === "late-p1100")).toBe(1100);
  });

  it("has no ceiling: a folder past 4,000 items keeps every photo", async () => {
    const items = Array.from({ length: 4500 }, (_, i) => photo(`big-p${i}`));
    serveFolder(items);

    const photos = await fetchFolderPhotos("folder-big");

    expect(photos).toHaveLength(4500);
    expect(global.fetch).toHaveBeenCalledTimes(9);
  });

  it("keeps the grid's order and drops everything that is not a photo", async () => {
    serveFolder([video("mixed-v1"), photo("mixed-p1"), video("mixed-v2"), photo("mixed-p2")]);

    const photos = await fetchFolderPhotos("folder-mixed");

    expect(photos.map((p) => p.Id)).toEqual(["mixed-p1", "mixed-p2"]);
  });

  it("stops on a short page rather than asking for one more", async () => {
    serveFolder([photo("short-p1")]);

    const photos = await fetchFolderPhotos("folder-short");

    expect(photos.map((p) => p.Id)).toEqual(["short-p1"]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
