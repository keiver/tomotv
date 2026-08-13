/**
 * Tests for the played-state surface backing the watched checkmark:
 * setVideoPlayed (POST/DELETE /PlayedItems toggle, subscriber notification,
 * override-map bookkeeping) and markItemPlayed (the no-HTTP path the playback
 * reporter uses when a session closes past the completion threshold).
 */
import { markItemPlayed, refreshConfig, setVideoPlayed, subscribePlayedChange } from "../jellyfinApi";
import { clearPlayedCache, getPlayedOverrides } from "../playedCache";

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

describe("played state", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();
    clearPlayedCache();

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });

    // getConfig serves its in-memory cache; force it to re-read this suite's credentials
    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastRequest(): [string, RequestInit] {
    const calls = (global.fetch as jest.Mock).mock.calls;
    return calls[calls.length - 1] as [string, RequestInit];
  }

  describe("setVideoPlayed", () => {
    it("POSTs to PlayedItems when marking watched", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await setVideoPlayed("item-1", true);

      const [url, init] = lastRequest();
      expect(url).toBe("http://192.168.1.100:8096/UserPlayedItems/item-1?userId=test-user-id");
      expect(init.method).toBe("POST");
    });

    it("DELETEs from PlayedItems when marking unwatched", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await setVideoPlayed("item-1", false);

      const [url, init] = lastRequest();
      expect(url).toBe("http://192.168.1.100:8096/UserPlayedItems/item-1?userId=test-user-id");
      expect(init.method).toBe("DELETE");
    });

    it("records the override and notifies subscribers on success", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });
      const listener = jest.fn();
      const unsubscribe = subscribePlayedChange(listener);

      await setVideoPlayed("item-1", true);

      expect(getPlayedOverrides().get("item-1")).toBe(true);
      expect(listener).toHaveBeenCalledWith("item-1", true);
      unsubscribe();
    });

    it("throws on a failed response and leaves no override behind", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
      const listener = jest.fn();
      const unsubscribe = subscribePlayedChange(listener);

      await expect(setVideoPlayed("item-1", true)).rejects.toThrow("Failed to mark played: 500");

      expect(getPlayedOverrides().has("item-1")).toBe(false);
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe("markItemPlayed", () => {
    it("records the override and notifies subscribers without any HTTP call", () => {
      const listener = jest.fn();
      const unsubscribe = subscribePlayedChange(listener);

      markItemPlayed("item-2", true);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(getPlayedOverrides().get("item-2")).toBe(true);
      expect(listener).toHaveBeenCalledWith("item-2", true);
      unsubscribe();
    });
  });
});
