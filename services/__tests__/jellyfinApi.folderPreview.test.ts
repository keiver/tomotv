/**
 * Tests for fetchFolderPreviewItems, the videos a cover-less folder card stacks. The query is
 * Jellyfin's own folder-image pick widened to the stack's count, and a second card asking for
 * the same folder is served from the request cache.
 */
import { fetchFolderPreviewItems, FOLDER_PREVIEW_COUNT, refreshConfig } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

describe("fetchFolderPreviewItems", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          { Id: "e1", Name: "S01E01", Type: "Movie" },
          { Id: "e2", Name: "S01E02", Type: "Movie" },
        ],
        TotalRecordCount: 36,
      }),
    });
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

  it("asks for the folder's first videos, recursively, by name, three at most", async () => {
    const items = await fetchFolderPreviewItems("folder-westworld");

    expect(items.map((item) => item.Id)).toEqual(["e1", "e2"]);
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.pathname).toBe("/Items");
    expect(url.searchParams.get("ParentId")).toBe("folder-westworld");
    expect(url.searchParams.get("Recursive")).toBe("true");
    expect(url.searchParams.get("SortBy")).toBe("SortName");
    expect(url.searchParams.get("Limit")).toBe(String(FOLDER_PREVIEW_COUNT));
    expect(url.searchParams.get("IncludeItemTypes")?.split(",")).toEqual(expect.arrayContaining(["Movie", "Episode", "Video"]));
    expect(url.searchParams.get("IncludeItemTypes")?.split(",")).not.toContain("Audio");
  });

  it("serves a second card for the same folder from the cache", async () => {
    await fetchFolderPreviewItems("folder-cached");
    await fetchFolderPreviewItems("folder-cached");

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
