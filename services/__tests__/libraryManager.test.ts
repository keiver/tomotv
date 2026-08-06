import { libraryManager } from "../libraryManager";
import * as jellyfinApi from "../jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";

// Mock dependencies
jest.mock("../jellyfinApi");
jest.mock("@/utils/logger");
jest.mock("@/services/connectionRecovery", () => ({ attemptConnectionRecovery: jest.fn() }));

const mockFetchLibraryVideos = jellyfinApi.fetchLibraryVideos as jest.MockedFunction<typeof jellyfinApi.fetchLibraryVideos>;
const mockFetchLibraryName = jellyfinApi.fetchLibraryName as jest.MockedFunction<typeof jellyfinApi.fetchLibraryName>;

describe("LibraryManager", () => {
  const mockVideos: JellyfinVideoItem[] = [
    {
      Id: "1",
      Name: "Test Video 1",
      Type: "Movie",
      RunTimeTicks: 36000000000,
      Path: "/media/video1.mp4",
    },
    {
      Id: "2",
      Name: "Test Video 2",
      Type: "Movie",
      RunTimeTicks: 36000000000,
      Path: "/media/video2.mp4",
    },
  ];

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Reset singleton state
    libraryManager.clearCache();

    // Default mock implementations - return paginated response
    mockFetchLibraryVideos.mockResolvedValue({
      items: mockVideos,
      total: mockVideos.length,
    });
    mockFetchLibraryName.mockResolvedValue("Test Library");
  });

  describe("singleton pattern", () => {
    it("should return the same instance", () => {
      const instance1 = libraryManager;
      const instance2 = libraryManager;
      expect(instance1).toBe(instance2);
    });
  });

  describe("loadLibrary", () => {
    it("should load videos and library name on first call", async () => {
      await libraryManager.loadLibrary();

      const state = libraryManager.getState();

      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);
      expect(mockFetchLibraryVideos).toHaveBeenCalledWith({
        limit: 60,
        startIndex: 0,
      });
      expect(mockFetchLibraryName).toHaveBeenCalledTimes(1);
      expect(state.videos).toEqual(mockVideos);
      expect(state.libraryName).toBe("Test Library");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(null);
    });

    it("should use cache on subsequent calls within TTL", async () => {
      // First load
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);

      // Second load (should use cache)
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1); // Still 1, used cache

      const state = libraryManager.getState();
      expect(state.videos).toEqual(mockVideos);
    });

    it("should bypass cache when force=true", async () => {
      // First load
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);

      // Forced load (should bypass cache)
      await libraryManager.loadLibrary(true);
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(2); // Called again

      const state = libraryManager.getState();
      expect(state.videos).toEqual(mockVideos);
    });

    it("should reload library name when force=true", async () => {
      // First load
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryName).toHaveBeenCalledTimes(1);

      // Change mock return value
      mockFetchLibraryName.mockResolvedValue("New Library");

      // Forced load
      await libraryManager.loadLibrary(true);
      expect(mockFetchLibraryName).toHaveBeenCalledTimes(2);

      const state = libraryManager.getState();
      expect(state.libraryName).toBe("New Library");
    });

    it("should prevent duplicate simultaneous loads", async () => {
      // Simulate slow network by using a promise that doesn't resolve immediately
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockFetchLibraryVideos.mockReturnValue(promise as any);

      // Start two loads simultaneously
      const load1 = libraryManager.loadLibrary();
      const load2 = libraryManager.loadLibrary();

      // Resolve the promise
      resolvePromise!({ items: mockVideos, total: mockVideos.length });
      await Promise.all([load1, load2]);

      // Should only call fetchLibraryVideos once
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);
    });

    it("should handle fetch errors gracefully", async () => {
      mockFetchLibraryVideos.mockRejectedValue(new Error("Network error"));

      await libraryManager.loadLibrary();

      // Raw error text never reaches state — it is mapped to a friendly message.
      const state = libraryManager.getState();
      expect(state.error).toBe("Unable to connect to your Jellyfin server");
      expect(state.videos).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("should clear error on successful retry", async () => {
      // First call fails
      mockFetchLibraryVideos.mockRejectedValueOnce(new Error("Network error"));
      await libraryManager.loadLibrary();
      expect(libraryManager.getState().error).toBe("Unable to connect to your Jellyfin server");

      // Second call succeeds
      mockFetchLibraryVideos.mockResolvedValueOnce({
        items: mockVideos,
        total: mockVideos.length,
      });
      await libraryManager.loadLibrary(true);

      const state = libraryManager.getState();
      expect(state.error).toBe(null);
      expect(state.videos).toEqual(mockVideos);
    });

    it("should set isLoading to true during fetch and false after", async () => {
      let loadingDuringFetch = false;

      mockFetchLibraryVideos.mockImplementation(async () => {
        loadingDuringFetch = libraryManager.getState().isLoading;
        return { items: mockVideos, total: mockVideos.length };
      });

      await libraryManager.loadLibrary();

      expect(loadingDuringFetch).toBe(true);
      expect(libraryManager.getState().isLoading).toBe(false);
    });
  });

  describe("refreshLibrary", () => {
    it("should force reload bypassing cache", async () => {
      // Initial load
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);

      // Refresh should force reload
      await libraryManager.refreshLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribe", () => {
    it("should notify listener immediately with current state", () => {
      const listener = jest.fn();

      libraryManager.subscribe(listener);

      expect(listener).toHaveBeenCalledWith({
        videos: [],
        isLoading: false,
        isLoadingMore: false,
        hasMoreResults: false,
        error: null,
        libraryName: "JELLYFIN",
      });
    });

    it("should notify listener on state changes", async () => {
      const listener = jest.fn();
      libraryManager.subscribe(listener);

      // Clear initial call
      listener.mockClear();

      // Trigger state change
      await libraryManager.loadLibrary();

      // Should have been called at least twice (loading start, loading end)
      expect(listener).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          videos: mockVideos,
          libraryName: "Test Library",
        }),
      );
    });

    it("should return unsubscribe function", () => {
      const listener = jest.fn();
      const unsubscribe = libraryManager.subscribe(listener);

      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
      listener.mockClear();

      // After unsubscribe, listener should not be called
      libraryManager.clearCache();
      expect(listener).not.toHaveBeenCalled();
    });

    it("should support multiple subscribers", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      libraryManager.subscribe(listener1);
      libraryManager.subscribe(listener2);

      listener1.mockClear();
      listener2.mockClear();

      libraryManager.clearCache();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe("getState", () => {
    it("should return current state synchronously", () => {
      const state = libraryManager.getState();

      expect(state).toEqual({
        videos: [],
        isLoading: false,
        isLoadingMore: false,
        hasMoreResults: false,
        error: null,
        libraryName: "JELLYFIN",
      });
    });

    it("should return updated state after load", async () => {
      await libraryManager.loadLibrary();

      const state = libraryManager.getState();

      expect(state.videos).toEqual(mockVideos);
      expect(state.libraryName).toBe("Test Library");
    });
  });

  describe("clearCache", () => {
    it("should reset all state to initial values", async () => {
      // Load some data
      await libraryManager.loadLibrary();

      let state = libraryManager.getState();
      expect(state.videos.length).toBeGreaterThan(0);
      expect(state.libraryName).not.toBe("JELLYFIN");

      // Clear cache
      libraryManager.clearCache();

      state = libraryManager.getState();
      expect(state.videos).toEqual([]);
      expect(state.libraryName).toBe("JELLYFIN");
      expect(state.error).toBe(null);
      expect(state.hasMoreResults).toBe(false);
      expect(state.isLoadingMore).toBe(false);
    });

    it("should reset cache timestamp", async () => {
      jest.useFakeTimers();

      await libraryManager.loadLibrary();
      jest.advanceTimersByTime(1000); // Advance 1 second
      expect(libraryManager.getCacheAge()).toBeGreaterThan(0);

      libraryManager.clearCache();
      expect(libraryManager.getCacheAge()).toBe(0);

      jest.useRealTimers();
    });

    it("should notify listeners after clearing", () => {
      const listener = jest.fn();
      libraryManager.subscribe(listener);

      listener.mockClear();

      libraryManager.clearCache();

      // Listener should be notified
      expect(listener).toHaveBeenCalledWith({
        videos: [],
        isLoading: false,
        isLoadingMore: false,
        hasMoreResults: false,
        error: null,
        libraryName: "JELLYFIN",
      });
    });
  });

  describe("getCacheAge", () => {
    it("should return 0 when no data has been loaded", () => {
      expect(libraryManager.getCacheAge()).toBe(0);
    });

    it("should return age in seconds after loading", async () => {
      jest.useFakeTimers();

      await libraryManager.loadLibrary();
      jest.advanceTimersByTime(5000); // 5 seconds

      // Should be around 5 seconds (allowing some tolerance)
      const age = libraryManager.getCacheAge();
      expect(age).toBeGreaterThanOrEqual(4);
      expect(age).toBeLessThanOrEqual(6);

      jest.useRealTimers();
    });
  });

  describe("cache TTL behavior", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should refetch after cache TTL expires", async () => {
      // Initial load
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);

      // Advance time by 6 minutes (more than 5 min TTL)
      jest.advanceTimersByTime(6 * 60 * 1000);

      // Load again (should refetch)
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(2);
    });

    it("should use cache within TTL window", async () => {
      // Initial load
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);

      // Advance time by 4 minutes (less than 5 min TTL)
      jest.advanceTimersByTime(4 * 60 * 1000);

      // Load again (should use cache)
      await libraryManager.loadLibrary();
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe("loadMore pagination", () => {
    it("should load next page when loadMore is called", async () => {
      // Setup - first page has 2 items but total is 100
      mockFetchLibraryVideos.mockResolvedValueOnce({
        items: mockVideos,
        total: 100,
      });

      await libraryManager.loadLibrary();
      expect(libraryManager.getState().hasMoreResults).toBe(true);

      // Mock second page
      const page2Videos: JellyfinVideoItem[] = [
        {
          Id: "3",
          Name: "Test Video 3",
          Type: "Movie",
          RunTimeTicks: 36000000000,
          Path: "/media/video3.mp4",
        },
      ];
      mockFetchLibraryVideos.mockResolvedValueOnce({
        items: page2Videos,
        total: 100,
      });

      await libraryManager.loadMore();

      const state = libraryManager.getState();
      expect(state.videos).toHaveLength(3);
      expect(mockFetchLibraryVideos).toHaveBeenCalledWith({
        limit: 60,
        startIndex: 2, // After first 2 items
      });
    });

    it("should not load more when already loading", async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetchLibraryVideos.mockResolvedValueOnce({
        items: mockVideos,
        total: 100,
      });
      await libraryManager.loadLibrary();

      // Make loadMore hang
      mockFetchLibraryVideos.mockReturnValue(promise as any);
      const loadMore1 = libraryManager.loadMore();
      const loadMore2 = libraryManager.loadMore(); // Should be ignored

      resolvePromise!({ items: [], total: 100 });
      await Promise.all([loadMore1, loadMore2]);

      // Should only have been called twice (initial load + one loadMore)
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(2);
    });

    it("should not load more when hasMoreResults is false", async () => {
      mockFetchLibraryVideos.mockResolvedValueOnce({
        items: mockVideos,
        total: 2, // Same as items length
      });

      await libraryManager.loadLibrary();
      expect(libraryManager.getState().hasMoreResults).toBe(false);

      await libraryManager.loadMore();

      // Should not have made additional call
      expect(mockFetchLibraryVideos).toHaveBeenCalledTimes(1);
    });
  });
});
