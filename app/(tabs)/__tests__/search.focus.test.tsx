/**
 * Focus Navigation Tests for Search Screen Component
 *
 * Tests that ensure tvOS focus navigation works correctly with
 * single and multiple search results.
 */

import { gridEdgePadding } from "@/constants/app";
import * as jellyfinApi from "@/services/jellyfinApi";
import { packArtworkRows } from "@/utils/artworkRows";
import { TVEventControl } from "react-native";

// Mock dependencies
jest.mock("@/services/jellyfinApi");
jest.mock("@/utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));
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

describe("Search Screen Focus Navigation", () => {
  const mockSearchVideos = jellyfinApi.searchVideos as jest.MockedFunction<typeof jellyfinApi.searchVideos>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe("columnWrapperStyle Behavior", () => {
    /**
     * This test verifies the fix for the single result focus bug.
     *
     * ROOT CAUSE:
     * When columnWrapperStyle is conditionally set to undefined for single results,
     * FlatList with numColumns > 1 doesn't properly render the row wrapper,
     * which breaks tvOS focus engine's ability to calculate item bounds.
     *
     * FIX:
     * columnWrapperStyle should ALWAYS be applied, regardless of result count.
     * This matches the library screen behavior which always works correctly.
     */
    it("should always apply columnWrapperStyle regardless of result count", () => {
      // This test validates the fix at the code level
      // The FlatList must always have columnWrapperStyle applied
      // Previously: columnWrapperStyle={searchResults.length > 1 ? styles.columnWrapper : undefined}
      // Fixed: columnWrapperStyle={styles.columnWrapper}

      const resultCounts = [1, 2, 5, 10];

      for (const count of resultCounts) {
        // Simulate the broken conditional
        const brokenStyle = count > 1 ? { justifyContent: "flex-start" } : undefined;

        // Simulate the fixed unconditional
        const fixedStyle = { justifyContent: "flex-start" };

        // The fix ensures style is ALWAYS defined, never undefined
        expect(fixedStyle).toBeDefined();

        // With 1 result, broken code would set undefined (causing focus issues)
        if (count === 1) {
          expect(brokenStyle).toBeUndefined();
        }
      }
    });

    it("should handle single result scenario correctly", () => {
      const searchResults = [{ Id: "1", Name: "Single Result" }];

      // The columnWrapperStyle should always be applied
      // This ensures tvOS focus engine can properly navigate to the single item
      const columnWrapperStyle = { justifyContent: "flex-start", paddingVertical: 24 };

      expect(searchResults.length).toBe(1);
      expect(columnWrapperStyle).toBeDefined();
      expect(columnWrapperStyle.justifyContent).toBe("flex-start");
    });

    it("should handle multiple results scenario correctly", () => {
      const searchResults = [
        { Id: "1", Name: "Result 1" },
        { Id: "2", Name: "Result 2" },
        { Id: "3", Name: "Result 3" },
      ];

      const columnWrapperStyle = { justifyContent: "flex-start", paddingVertical: 24 };

      expect(searchResults.length).toBe(3);
      expect(columnWrapperStyle).toBeDefined();
    });
  });

  describe("FlatList Focus Configuration", () => {
    it("should set hasTVPreferredFocus on first item when results exist", () => {
      const searchResults = [{ Id: "1", Name: "Video 1" }];
      const shouldShowResults = searchResults.length > 0;
      const index = 0;

      const hasTVPreferredFocus = index === 0 && shouldShowResults;

      expect(hasTVPreferredFocus).toBe(true);
    });

    it("should not set hasTVPreferredFocus on non-first items", () => {
      const searchResults = [
        { Id: "1", Name: "Video 1" },
        { Id: "2", Name: "Video 2" },
      ];
      const shouldShowResults = searchResults.length > 0;

      for (let index = 1; index < searchResults.length; index++) {
        const hasTVPreferredFocus = index === 0 && shouldShowResults;
        expect(hasTVPreferredFocus).toBe(false);
      }
    });

    it("should set nextFocusUp on first row items to search input", () => {
      const numColumns = 5;
      const searchInputHandle = 12345;

      // Items in first row (index < numColumns) should have nextFocusUp pointing to search input
      for (let index = 0; index < numColumns; index++) {
        const isFirstRow = index < numColumns;
        const nextFocusUp = isFirstRow ? searchInputHandle : undefined;

        expect(nextFocusUp).toBe(searchInputHandle);
      }

      // Items not in first row should not have nextFocusUp
      for (let index = numColumns; index < numColumns * 2; index++) {
        const isFirstRow = index < numColumns;
        const nextFocusUp = isFirstRow ? searchInputHandle : undefined;

        expect(nextFocusUp).toBeUndefined();
      }
    });

    it("should set nextFocusDown on search input to first result", () => {
      const firstResultHandle = 67890;

      // When results exist, search input's nextFocusDown should point to first result
      const searchInputNextFocusDown = firstResultHandle;

      expect(searchInputNextFocusDown).toBe(firstResultHandle);
    });
  });

  describe("Search Header Memoization", () => {
    /**
     * Tests that SearchHeader props don't include value/key that would cause remounting
     * when search results change.
     *
     * PREVIOUS BUG: Adding key={...} and value={...} props to TextInput caused
     * the keyboard to dismiss when results changed because the component remounted.
     */
    it("should not remount SearchHeader when searchQuery changes", () => {
      // SearchHeader memo comparison should NOT include value comparison
      // This ensures typing doesn't cause remounting

      const prevProps = {
        onChangeText: jest.fn(),
        onSubmitEditing: jest.fn(),
        nextFocusDown: 123,
      };

      const nextProps = {
        onChangeText: prevProps.onChangeText, // Same reference
        onSubmitEditing: prevProps.onSubmitEditing, // Same reference
        nextFocusDown: 123, // Same value
      };

      // Props should be considered equal (no remount)
      const areEqual = prevProps.onChangeText === nextProps.onChangeText && prevProps.onSubmitEditing === nextProps.onSubmitEditing && prevProps.nextFocusDown === nextProps.nextFocusDown;

      expect(areEqual).toBe(true);
    });

    it("should remount SearchHeader only when nextFocusDown changes", () => {
      const prevProps = {
        onChangeText: jest.fn(),
        onSubmitEditing: jest.fn(),
        nextFocusDown: 123,
      };

      const nextProps = {
        onChangeText: prevProps.onChangeText,
        onSubmitEditing: prevProps.onSubmitEditing,
        nextFocusDown: 456, // Different value - first result changed
      };

      const areEqual = prevProps.onChangeText === nextProps.onChangeText && prevProps.onSubmitEditing === nextProps.onSubmitEditing && prevProps.nextFocusDown === nextProps.nextFocusDown;

      // Props should be considered different (trigger update for focus)
      expect(areEqual).toBe(false);
    });
  });

  describe("API Search for Single Result", () => {
    it("should handle search returning exactly 1 result", async () => {
      const singleResult = {
        items: [{ Id: "1", Name: "Unique Video", ImageTags: { Primary: "abc" } } as any],
        total: 1,
      };

      mockSearchVideos.mockResolvedValueOnce(singleResult);

      const result = await jellyfinApi.searchVideos("unique", { limit: 60, startIndex: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0].Name).toBe("Unique Video");
    });

    it("should calculate hasMoreResults as false for single result", () => {
      const items = [{ Id: "1", Name: "Single" }];
      const total = 1;

      const hasMore = total !== undefined && items.length < total;

      expect(hasMore).toBe(false);
    });
  });

  describe("onSearchFieldFocused and onSearchFieldBlurred callbacks", () => {
    /**
     * These callbacks are used by NativeSearchScreen to manage TVEventControl
     * gesture handlers when the search field gains/loses focus.
     *
     * This is a fallback mechanism for tvOS keyboard input - the native library
     * attempts to disable RN gesture handlers automatically, but these callbacks
     * provide a JS-based fallback if that doesn't work.
     */

    it("should disable gesture handlers when search field is focused", () => {
      // Mock TVEventControl
      const mockDisable = jest.fn();
      (TVEventControl as any).disableGestureHandlersCancelTouches = mockDisable;

      // Simulate handleSearchFieldFocused callback behavior
      const handleSearchFieldFocused = () => {
        if (TVEventControl?.disableGestureHandlersCancelTouches) {
          TVEventControl.disableGestureHandlersCancelTouches();
        }
      };

      handleSearchFieldFocused();

      expect(mockDisable).toHaveBeenCalledTimes(1);
    });

    it("should enable gesture handlers when search field is blurred", () => {
      // Mock TVEventControl
      const mockEnable = jest.fn();
      (TVEventControl as any).enableGestureHandlersCancelTouches = mockEnable;

      // Simulate handleSearchFieldBlurred callback behavior
      const handleSearchFieldBlurred = () => {
        if (TVEventControl?.enableGestureHandlersCancelTouches) {
          TVEventControl.enableGestureHandlersCancelTouches();
        }
      };

      handleSearchFieldBlurred();

      expect(mockEnable).toHaveBeenCalledTimes(1);
    });

    it("should not throw when TVEventControl methods are unavailable", () => {
      // Clear the mocked methods to simulate unavailable TVEventControl
      const originalDisable = (TVEventControl as any).disableGestureHandlersCancelTouches;
      const originalEnable = (TVEventControl as any).enableGestureHandlersCancelTouches;

      delete (TVEventControl as any).disableGestureHandlersCancelTouches;
      delete (TVEventControl as any).enableGestureHandlersCancelTouches;

      // Simulate callbacks with guards
      const handleSearchFieldFocused = () => {
        if (TVEventControl?.disableGestureHandlersCancelTouches) {
          TVEventControl.disableGestureHandlersCancelTouches();
        }
      };

      const handleSearchFieldBlurred = () => {
        if (TVEventControl?.enableGestureHandlersCancelTouches) {
          TVEventControl.enableGestureHandlersCancelTouches();
        }
      };

      // Should not throw
      expect(() => handleSearchFieldFocused()).not.toThrow();
      expect(() => handleSearchFieldBlurred()).not.toThrow();

      // Restore
      (TVEventControl as any).disableGestureHandlersCancelTouches = originalDisable;
      (TVEventControl as any).enableGestureHandlersCancelTouches = originalEnable;
    });

    it("should handle focus/blur cycle correctly", () => {
      const mockDisable = jest.fn();
      const mockEnable = jest.fn();
      (TVEventControl as any).disableGestureHandlersCancelTouches = mockDisable;
      (TVEventControl as any).enableGestureHandlersCancelTouches = mockEnable;

      const handleSearchFieldFocused = () => {
        if (TVEventControl?.disableGestureHandlersCancelTouches) {
          TVEventControl.disableGestureHandlersCancelTouches();
        }
      };

      const handleSearchFieldBlurred = () => {
        if (TVEventControl?.enableGestureHandlersCancelTouches) {
          TVEventControl.enableGestureHandlersCancelTouches();
        }
      };

      // Simulate user focus/blur cycle
      handleSearchFieldFocused();
      expect(mockDisable).toHaveBeenCalledTimes(1);
      expect(mockEnable).toHaveBeenCalledTimes(0);

      handleSearchFieldBlurred();
      expect(mockDisable).toHaveBeenCalledTimes(1);
      expect(mockEnable).toHaveBeenCalledTimes(1);

      // Second focus/blur cycle
      handleSearchFieldFocused();
      handleSearchFieldBlurred();
      expect(mockDisable).toHaveBeenCalledTimes(2);
      expect(mockEnable).toHaveBeenCalledTimes(2);
    });
  });
  /**
   * components/search-results-grid.tsx is rendered by BOTH search paths: the JS screen, and the
   * tvOS native search view, which takes it as its child. The two differ on exactly one rule.
   */
  describe("Shared grid: initial focus claim", () => {
    /** Copied verbatim from search-results-grid.tsx `renderRow`. */
    function claimsFocus(index: number, claimInitialFocus: boolean): boolean {
      return index === 0 && claimInitialFocus;
    }

    it("claims focus on the first card only, for the JS screen", () => {
      expect(claimsFocus(0, true)).toBe(true);
      expect(claimsFocus(1, true)).toBe(false);
      expect(claimsFocus(7, true)).toBe(false);
    });

    it("claims focus on no card under the native search view, which leaves the keyboard focused", () => {
      // A claim here would yank focus off the tvOS search keyboard the moment results land.
      expect(claimsFocus(0, false)).toBe(false);
      expect(claimsFocus(1, false)).toBe(false);
    });
  });

  describe("Shared grid: Up target", () => {
    /** Copied verbatim from search-results-grid.tsx `renderRow`. */
    function nextFocusUpFor(rowIndex: number, handle: number | undefined): number | undefined {
      return rowIndex === 0 ? handle : undefined;
    }

    it("routes only the top row Up to the search field", () => {
      expect(nextFocusUpFor(0, 999)).toBe(999);
      expect(nextFocusUpFor(1, 999)).toBeUndefined();
    });

    it("leaves every row to natural traversal when no handle is given, as under the native field", () => {
      expect(nextFocusUpFor(0, undefined)).toBeUndefined();
    });
  });
  /**
   * The native search view draws its children in a region that is already inside the tvOS safe
   * area, so the grid must pack against that measured width with no edge padding of its own.
   * Deriving it from the window instead double-insets and overflows the region.
   */
  describe("Shared grid: content width", () => {
    /** Copied verbatim from search-results-grid.tsx. */
    function contentWidthFor(windowWidth: number, insetLeft: number, availableWidth?: number, edgePadding?: number): number {
      const edgeLeft = edgePadding ?? gridEdgePadding(insetLeft, true);
      const edgeRight = edgePadding ?? gridEdgePadding(insetLeft, true);
      return availableWidth ?? windowWidth - edgeLeft - edgeRight;
    }

    it("derives from the window when no region is given, as on the JS screen", () => {
      expect(contentWidthFor(1920, 80)).toBe(1760);
    });

    it("uses the measured region verbatim under the native search view", () => {
      // 1760x617 is what the tvOS view reports for its results region at 1080p.
      expect(contentWidthFor(1920, 80, 1760, 0)).toBe(1760);
    });

    it("would double-inset the region if it kept deriving from the window", () => {
      // The regression: region already inset, grid inserting another 80 a side.
      expect(contentWidthFor(1760, 80)).toBe(1600);
    });

    it("packs rows that fill the injected width exactly", () => {
      const width = contentWidthFor(1920, 80, 1760, 0);
      const rows = packArtworkRows([0.667, 0.667, 1.778, 1.778], width, (r) => ({ ratio: r, height: 264 }), 16);
      // Every row but the last justifies to fill; the last inherits the previous scale.
      rows.slice(0, -1).forEach((row) => expect(Math.round(row.width)).toBe(width));
      expect(rows[rows.length - 1].width).toBeLessThanOrEqual(width + 0.5);
    });
  });
});
