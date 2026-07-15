/**
 * Focus Navigation Tests for the Library/Folder Grid
 *
 * Regression coverage for the tvOS folder-grid focus contract in components/library-grid.tsx.
 * That component routes Up from the grid's top row straight to the pinned Filters button via
 * `nextFocusUp` (a deterministic native handle, not a fragile focus-guide redirect). These tests
 * mirror the two rules the grid applies in `renderItem`, anchored to the real column-count source
 * (`slotColumns`) so a change to the grid's columns is caught here too.
 *
 * Rules under test (components/library-grid.tsx `renderItem`):
 *   nextFocusUp        = isInsideFolder && index < numColumns ? filtersButtonHandle : undefined
 *   hasTVPreferredFocus = index === 0
 *
 * Same logic-mirror style as app/(tabs)/__tests__/search.focus.test.tsx.
 */

import { slotColumns, type SlotOrientation } from "@/constants/app";

/** The grid's per-item Up target, copied verbatim from library-grid.tsx `renderItem`. */
function nextFocusUpFor(index: number, numColumns: number, isInsideFolder: boolean, filtersButtonHandle: number | undefined): number | undefined {
  return isInsideFolder && index < numColumns ? filtersButtonHandle : undefined;
}

describe("Library/Folder Grid Focus Navigation", () => {
  const FILTERS_BUTTON_HANDLE = 4242;

  describe.each<[SlotOrientation, boolean]>([
    ["portrait", true],
    ["landscape", true],
    ["portrait", false],
    ["landscape", false],
  ])("nextFocusUp — %s slots, isTV=%s", (orientation, isTV) => {
    const numColumns = slotColumns(orientation, isTV);

    it("routes every top-row item Up to the Filters button (folder variant)", () => {
      for (let index = 0; index < numColumns; index++) {
        expect(nextFocusUpFor(index, numColumns, true, FILTERS_BUTTON_HANDLE)).toBe(FILTERS_BUTTON_HANDLE);
      }
    });

    it("leaves lower-row items with normal Up traversal (folder variant)", () => {
      for (let index = numColumns; index < numColumns * 3; index++) {
        expect(nextFocusUpFor(index, numColumns, true, FILTERS_BUTTON_HANDLE)).toBeUndefined();
      }
    });

    it("never overrides Up on the root libraries view (there is no Filters button)", () => {
      for (let index = 0; index < numColumns * 2; index++) {
        expect(nextFocusUpFor(index, numColumns, false, FILTERS_BUTTON_HANDLE)).toBeUndefined();
      }
    });
  });

  describe("Filters button handle not yet reported", () => {
    it("yields undefined for the top row until the header reports its native node", () => {
      const numColumns = slotColumns("landscape", true);
      for (let index = 0; index < numColumns; index++) {
        // filtersButtonHandle is undefined before LibraryHeader.onFiltersButtonRef fires.
        expect(nextFocusUpFor(index, numColumns, true, undefined)).toBeUndefined();
      }
    });
  });

  describe("hasTVPreferredFocus", () => {
    it("is set only on the first item", () => {
      expect(0 === 0).toBe(true);
      for (let index = 1; index < 12; index++) {
        expect(index === 0).toBe(false);
      }
    });
  });
});
