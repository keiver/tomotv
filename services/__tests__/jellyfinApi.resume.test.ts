/**
 * Tests for the server-side resume surface backing the Continue Watching row:
 * fetchResumeItems (query shape, null-on-failure so the row can distinguish a
 * transient error from an empty list) and clearResumePosition (mark-unplayed
 * DELETE, which resets PlaybackPositionTicks without marking the item played).
 */
import { fetchResumeItems, clearResumePosition } from "../jellyfinApi";

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

describe("server-side resume list", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(() => {
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastRequestUrl(): URL {
    const calls = (global.fetch as jest.Mock).mock.calls;
    return new URL(calls[calls.length - 1][0] as string);
  }

  describe("fetchResumeItems", () => {
    it("GETs the user's Items/Resume endpoint with user data enabled", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [] }) });

      await fetchResumeItems();

      const url = lastRequestUrl();
      expect(url.pathname).toBe("/Users/test-user-id/Items/Resume");
      expect(url.searchParams.get("EnableUserData")).toBe("true");
      // Audio included so music with a persisted position shows in Continue Watching
      expect(url.searchParams.get("MediaTypes")).toBe("Video,Audio");
      expect(url.searchParams.get("Limit")).toBe("20");
    });

    it("respects the limit parameter", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [] }) });

      await fetchResumeItems(5);

      expect(lastRequestUrl().searchParams.get("Limit")).toBe("5");
    });

    it("returns the server's items", async () => {
      const items = [{ Id: "a", Name: "Movie A" }];
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: items }) });

      await expect(fetchResumeItems()).resolves.toEqual(items);
    });

    it("returns null (not []) on a server error so callers can keep stale items", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(fetchResumeItems()).resolves.toBeNull();
    });

    it("returns null on a network error without throwing", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));

      await expect(fetchResumeItems()).resolves.toBeNull();
    });
  });

  describe("clearResumePosition", () => {
    it("DELETEs from PlayedItems (mark-unplayed resets the resume position)", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await clearResumePosition("item-1");

      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls[calls.length - 1][0]).toBe("http://192.168.1.100:8096/Users/test-user-id/PlayedItems/item-1");
      expect((calls[calls.length - 1][1] as RequestInit).method).toBe("DELETE");
    });

    it("throws on a failed response so the row can log the miss", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(clearResumePosition("item-1")).rejects.toThrow("Failed to clear resume position: 500");
    });
  });
});
