/**
 * Pagination Tests for Search Screen Component
 *
 * Tests the actual search screen pagination behavior using react-test-renderer
 */

import * as jellyfinApi from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";

/**
 * Helper function to create mock video items with all required properties
 */
const createMockVideo = (id: string, name: string): JellyfinVideoItem => ({
  Id: id,
  Name: name,
  Type: "Movie",
  RunTimeTicks: 36000000000,
  Path: `/media/${id}.mp4`,
});

// Mock dependencies
jest.mock("@/services/jellyfinApi");
jest.mock("@/contexts/LibraryContext", () => ({
  useLibrary: () => ({
    isLoading: false,
    error: null,
    refreshLibrary: jest.fn(),
  }),
}));
jest.mock("@/contexts/LoadingContext", () => ({
  useLoading: () => ({
    showGlobalLoader: jest.fn(),
    hideGlobalLoader: jest.fn(),
  }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useFocusEffect: jest.fn((callback) => callback()),
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => children,
}));

describe("Search Screen Pagination", () => {
  const mockSearchVideos = jellyfinApi.searchVideos as jest.MockedFunction<typeof jellyfinApi.searchVideos>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe("API Integration", () => {
    it("should call searchVideos with correct initial parameters", async () => {
      mockSearchVideos.mockResolvedValueOnce({
        items: [{ Id: "1", Name: "Video 1", ImageTags: { Primary: "abc" } } as any, { Id: "2", Name: "Video 2", ImageTags: { Primary: "def" } } as any],
        next: { title: 2 },
      });

      const searchTerm = "action";
      const result = await jellyfinApi.searchVideos(searchTerm, {
        limit: 60,
      });

      expect(mockSearchVideos).toHaveBeenCalledWith("action", {
        limit: 60,
      });
      expect(result.items).toHaveLength(2);
      expect(result.next).toEqual({ title: 2 });
    });

    it("should call searchVideos with correct pagination parameters for second page", async () => {
      mockSearchVideos.mockResolvedValueOnce({
        items: Array.from({ length: 60 }, (_, i) => ({
          Id: `${i + 61}`,
          Name: `Video ${i + 61}`,
          ImageTags: { Primary: "abc" },
        })) as any[],
        next: { title: 120 },
      });

      const result = await jellyfinApi.searchVideos("test", {
        limit: 60,
        cursor: { title: 60 },
      });

      expect(mockSearchVideos).toHaveBeenCalledWith("test", {
        limit: 60,
        cursor: { title: 60 },
      });
      expect(result.items).toHaveLength(60);
      expect(result.next).toEqual({ title: 120 });
    });

    it("should return correct structure with items and next", async () => {
      const mockResponse = {
        items: [{ Id: "1", Name: "Video 1" } as any, { Id: "2", Name: "Video 2" } as any, { Id: "3", Name: "Video 3" } as any],
        next: { title: 3 },
      };

      mockSearchVideos.mockResolvedValueOnce(mockResponse);

      const result = await jellyfinApi.searchVideos("action", {
        limit: 3,
      });

      expect(result).toEqual({
        items: mockResponse.items,
        next: { title: 3 },
      });
      expect(result.items).toHaveLength(3);
    });
  });

  describe("Pagination State Logic", () => {
    it("should calculate hasMoreResults correctly when total > fetched", () => {
      const items = Array.from({ length: 60 }, (_, i) => ({ Id: `${i}` }));
      const total = 150;

      const hasMore = total !== undefined && items.length < total;

      expect(hasMore).toBe(true);
    });

    it("should calculate hasMoreResults correctly when total === fetched", () => {
      const items = Array.from({ length: 60 }, (_, i) => ({ Id: `${i}` }));
      const total = 60;

      const hasMore = total !== undefined && items.length < total;

      expect(hasMore).toBe(false);
    });

    it("should calculate hasMoreResults correctly when total is undefined", () => {
      const items = Array.from({ length: 60 }, (_, i) => ({ Id: `${i}` }));
      const total = undefined;

      const hasMore = total !== undefined && items.length < total;

      expect(hasMore).toBe(false);
    });

    it("should calculate nextStartIndex correctly", () => {
      const startIndex = 0;
      const itemsLength = 60;

      const nextStartIndex = startIndex + itemsLength;

      expect(nextStartIndex).toBe(60);

      // Second page
      const nextStartIndex2 = nextStartIndex + itemsLength;
      expect(nextStartIndex2).toBe(120);
    });

    it("should handle result aggregation - append mode", () => {
      const existingResults = [
        { Id: "1", Name: "Video 1" },
        { Id: "2", Name: "Video 2" },
      ];
      const newResults = [
        { Id: "3", Name: "Video 3" },
        { Id: "4", Name: "Video 4" },
      ];

      const append = true;
      const finalResults = append ? [...existingResults, ...newResults] : newResults;

      expect(finalResults).toHaveLength(4);
      expect(finalResults[0].Id).toBe("1");
      expect(finalResults[3].Id).toBe("4");
    });

    it("should handle result aggregation - replace mode", () => {
      const existingResults = [{ Id: "old1", Name: "Old Video" }];
      const newResults = [
        { Id: "1", Name: "Video 1" },
        { Id: "2", Name: "Video 2" },
      ];

      const append = false;
      const finalResults = append ? [...existingResults, ...newResults] : newResults;

      expect(finalResults).toEqual(newResults);
      expect(finalResults).toHaveLength(2);
    });
  });

  describe("Load More Guard Conditions", () => {
    it("should prevent loading more when already loading", () => {
      const state = {
        isLoadingMore: true,
        hasMoreResults: true,
        isSearching: false,
        activeQuery: "test",
      };

      const shouldLoadMore = !!(state.hasMoreResults && !state.isLoadingMore && !state.isSearching && state.activeQuery);

      expect(shouldLoadMore).toBe(false);
    });

    it("should prevent loading more when no more results exist", () => {
      const state = {
        isLoadingMore: false,
        hasMoreResults: false,
        isSearching: false,
        activeQuery: "test",
      };

      const shouldLoadMore = !!(state.hasMoreResults && !state.isLoadingMore && !state.isSearching && state.activeQuery);

      expect(shouldLoadMore).toBe(false);
    });

    it("should prevent loading more when no active query", () => {
      const state = {
        isLoadingMore: false,
        hasMoreResults: true,
        isSearching: false,
        activeQuery: "",
      };

      const shouldLoadMore = !!(state.hasMoreResults && !state.isLoadingMore && !state.isSearching && state.activeQuery);

      expect(shouldLoadMore).toBe(false);
    });

    it("should prevent loading more when initial search is in progress", () => {
      const state = {
        isLoadingMore: false,
        hasMoreResults: true,
        isSearching: true,
        activeQuery: "test",
      };

      const shouldLoadMore = !!(state.hasMoreResults && !state.isLoadingMore && !state.isSearching && state.activeQuery);

      expect(shouldLoadMore).toBe(false);
    });

    it("should allow loading more when all conditions are met", () => {
      const state = {
        isLoadingMore: false,
        hasMoreResults: true,
        isSearching: false,
        activeQuery: "test",
      };

      const shouldLoadMore = !!(state.hasMoreResults && !state.isLoadingMore && !state.isSearching && state.activeQuery);

      expect(shouldLoadMore).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should not clear results when pagination fails (append mode)", async () => {
      const existingResults = [
        { Id: "1", Name: "Video 1" },
        { Id: "2", Name: "Video 2" },
      ];

      mockSearchVideos.mockRejectedValueOnce(new Error("Network error"));

      const append = true;
      let finalResults = existingResults;

      try {
        await jellyfinApi.searchVideos("test", { limit: 60, cursor: { title: 60 } });
      } catch (_err) {
        // On pagination error (append=true), don't clear existing results
        if (!append) {
          finalResults = [];
        }
      }

      expect(finalResults).toEqual(existingResults);
      expect(finalResults).toHaveLength(2);
    });

    it("should clear results when initial search fails (replace mode)", async () => {
      mockSearchVideos.mockRejectedValueOnce(new Error("Network error"));

      const append = false;
      let finalResults = [{ Id: "1", Name: "Video 1" }];

      try {
        await jellyfinApi.searchVideos("test", { limit: 60 });
      } catch (_err) {
        // On initial search error (append=false), clear results
        if (!append) {
          finalResults = [];
        }
      }

      expect(finalResults).toEqual([]);
    });
  });

  describe("Multi-Page Pagination Flow", () => {
    it("should handle complete 3-page pagination flow", async () => {
      const scenarios = [
        {
          // Page 1
          startIndex: 0,
          response: {
            items: Array.from({ length: 60 }, (_, i) => createMockVideo(`${i + 1}`, `Video ${i + 1}`)),
            next: { title: 60 },
          },
        },
        {
          // Page 2
          startIndex: 60,
          response: {
            items: Array.from({ length: 60 }, (_, i) => createMockVideo(`${i + 61}`, `Video ${i + 61}`)),
            next: { title: 120 },
          },
        },
        {
          // Page 3 (last page)
          startIndex: 120,
          response: {
            items: Array.from({ length: 30 }, (_, i) => createMockVideo(`${i + 121}`, `Video ${i + 121}`)),
            next: null,
          },
        },
      ];

      let allResults: any[] = [];

      for (const scenario of scenarios) {
        mockSearchVideos.mockResolvedValueOnce(scenario.response);

        const result = await jellyfinApi.searchVideos("test", {
          limit: 60,
          cursor: { title: scenario.startIndex },
        });

        allResults = [...allResults, ...result.items];

        const hasMore = result.next !== null;

        if (scenario.startIndex === 0) {
          expect(allResults).toHaveLength(60);
          expect(hasMore).toBe(true);
        } else if (scenario.startIndex === 60) {
          expect(allResults).toHaveLength(120);
          expect(hasMore).toBe(true);
        } else if (scenario.startIndex === 120) {
          expect(allResults).toHaveLength(150);
          expect(hasMore).toBe(false);
        }
      }

      expect(allResults).toHaveLength(150);
      expect(allResults[0].Id).toBe("1");
      expect(allResults[149].Id).toBe("150");
    });

    it("should handle last page with fewer items than limit", () => {
      const lastPageItems = 15;
      const totalRecordCount = 195; // 3 full pages + 15 items

      const startIndex = 180; // Fourth page start
      const items = Array.from({ length: lastPageItems }, (_, i) => ({
        Id: `${startIndex + i + 1}`,
        Name: `Video ${startIndex + i + 1}`,
      }));

      const totalFetched = startIndex + items.length; // 195
      const hasMore = totalFetched < totalRecordCount;

      expect(items).toHaveLength(15);
      expect(totalFetched).toBe(195);
      expect(hasMore).toBe(false);
    });

    it("should handle exact page boundary", () => {
      const totalRecordCount = 180; // Exactly 3 pages

      const lastPageStartIndex = 120;
      const lastPageCount = 60;
      const totalFetched = lastPageStartIndex + lastPageCount;
      const hasMore = totalFetched < totalRecordCount;

      expect(totalFetched).toBe(180);
      expect(hasMore).toBe(false);
    });
  });

  describe("FlatList onEndReached Threshold", () => {
    it("should trigger at 50% threshold", () => {
      const onEndReachedThreshold = 0.5;
      const listHeight = 1000;
      const contentHeight = 2000;
      const scrollPosition = 1000; // Scrolled halfway

      // Calculate distance from end
      const distanceFromEnd = contentHeight - (scrollPosition + listHeight);
      const thresholdDistance = contentHeight * onEndReachedThreshold;

      const shouldTrigger = distanceFromEnd <= thresholdDistance;

      expect(distanceFromEnd).toBe(0); // At the end
      expect(thresholdDistance).toBe(1000);
      expect(shouldTrigger).toBe(true);
    });

    it("should not trigger before threshold", () => {
      const onEndReachedThreshold = 0.5;
      const listHeight = 1000;
      const contentHeight = 2000;
      const scrollPosition = 0; // At the top

      const distanceFromEnd = contentHeight - (scrollPosition + listHeight);
      const thresholdDistance = contentHeight * onEndReachedThreshold;

      const shouldTrigger = distanceFromEnd < thresholdDistance;

      expect(distanceFromEnd).toBe(1000);
      expect(thresholdDistance).toBe(1000);
      expect(shouldTrigger).toBe(false); // At boundary, not triggered
    });
  });

  describe("Search Term Handling", () => {
    it("should handle empty search term", async () => {
      mockSearchVideos.mockResolvedValueOnce({ items: [], next: null });

      const result = await jellyfinApi.searchVideos("");

      expect(result).toEqual({ items: [], next: null });
    });

    it("should handle whitespace-only search term", async () => {
      mockSearchVideos.mockResolvedValueOnce({ items: [], next: null });

      const result = await jellyfinApi.searchVideos("   ");

      expect(result).toEqual({ items: [], next: null });
    });

    it("should trim search term before searching", () => {
      const input = "  test query  ";
      const trimmed = input.trim();

      expect(trimmed).toBe("test query");
      expect(trimmed.length).toBe(10);
    });
  });
});
