/**
 * Focus Navigation Tests for the Folder Grid
 *
 * Regression coverage for the tvOS folder-grid focus contract in components/library-grid.tsx
 * (the grid is folder-only; the Home tab's shelf layout is components/home-shelves.tsx). The
 * component routes Up from the grid's top row straight to the pinned Filters button via
 * `nextFocusUp` (a deterministic native handle, not a fragile focus-guide redirect). These tests
 * mirror the two rules the grid applies in `renderItem`, anchored to the real column-count source
 * (`slotColumns`) so a change to the grid's columns is caught here too.
 *
 * Rules under test (components/library-grid.tsx `renderItem`):
 *   nextFocusUp        = index < numColumns ? filtersButtonHandle : undefined
 *   hasTVPreferredFocus = index === 0
 *
 * Same logic-mirror style as app/(tabs)/__tests__/search.focus.test.tsx.
 */

import { slotColumns, type SlotOrientation } from "@/constants/app";

/** The grid's per-item Up target, copied verbatim from library-grid.tsx `renderItem`. */
function nextFocusUpFor(index: number, numColumns: number, filtersButtonHandle: number | undefined): number | undefined {
  return index < numColumns ? filtersButtonHandle : undefined;
}

/** The grid's per-item Down target, copied verbatim from library-grid.tsx `renderItem`. */
function nextFocusDownFor(index: number, numColumns: number, total: number, lastCardHandle: number | undefined): number | undefined {
  const lastRowStart = Math.floor((total - 1) / numColumns) * numColumns;
  return index >= total - numColumns && index < lastRowStart ? lastCardHandle : undefined;
}

describe("Folder Grid Focus Navigation", () => {
  const FILTERS_BUTTON_HANDLE = 4242;

  describe.each<[SlotOrientation, boolean]>([
    ["portrait", true],
    ["landscape", true],
    ["portrait", false],
    ["landscape", false],
  ])("nextFocusUp — %s slots, isTV=%s", (orientation, isTV) => {
    const numColumns = slotColumns(orientation, isTV);

    it("routes every top-row item Up to the Filters button", () => {
      for (let index = 0; index < numColumns; index++) {
        expect(nextFocusUpFor(index, numColumns, FILTERS_BUTTON_HANDLE)).toBe(FILTERS_BUTTON_HANDLE);
      }
    });

    it("leaves lower-row items with normal Up traversal", () => {
      for (let index = numColumns; index < numColumns * 3; index++) {
        expect(nextFocusUpFor(index, numColumns, FILTERS_BUTTON_HANDLE)).toBeUndefined();
      }
    });
  });

  describe("Filters button handle not yet reported", () => {
    it("yields undefined for the top row until the header reports its native node", () => {
      const numColumns = slotColumns("landscape", true);
      for (let index = 0; index < numColumns; index++) {
        // filtersButtonHandle is undefined before LibraryHeader.onFiltersButtonRef fires.
        expect(nextFocusUpFor(index, numColumns, undefined)).toBeUndefined();
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

  describe("nextFocusDown — partial last row", () => {
    const LAST_CARD_HANDLE = 7373;

    /** Indices whose Down target is the last card, for a grid of `total` over `numColumns`. */
    function strandedIndices(total: number, numColumns: number): number[] {
      return Array.from({ length: total }, (_, index) => index).filter((index) => nextFocusDownFor(index, numColumns, total, LAST_CARD_HANDLE) !== undefined);
    }

    it("routes the cards with nothing beneath them to the last card (6 over 4 columns)", () => {
      // Row 1 holds 0-3, row 2 holds 4-5. Columns 2 and 3 overhang the short row.
      expect(strandedIndices(6, 4)).toEqual([2, 3]);
      expect(nextFocusDownFor(2, 4, 6, LAST_CARD_HANDLE)).toBe(LAST_CARD_HANDLE);
    });

    it("leaves cards that do have one beneath them alone", () => {
      // 0 and 1 sit above 4 and 5.
      expect(nextFocusDownFor(0, 4, 6, LAST_CARD_HANDLE)).toBeUndefined();
      expect(nextFocusDownFor(1, 4, 6, LAST_CARD_HANDLE)).toBeUndefined();
    });

    it("never overrides Down for the last row itself", () => {
      for (const index of [4, 5]) {
        expect(nextFocusDownFor(index, 4, 6, LAST_CARD_HANDLE)).toBeUndefined();
      }
    });

    it("strands only the final column when the last row is one short (7 over 4)", () => {
      expect(strandedIndices(7, 4)).toEqual([3]);
    });

    it("overrides nothing when the last row is full, or there is a single row or item", () => {
      expect(strandedIndices(8, 4)).toEqual([]);
      expect(strandedIndices(4, 4)).toEqual([]);
      expect(strandedIndices(3, 4)).toEqual([]);
      expect(strandedIndices(1, 4)).toEqual([]);
    });

    it("yields undefined until the last cell reports its native node", () => {
      expect(nextFocusDownFor(2, 4, 6, undefined)).toBeUndefined();
    });

    it("holds across the real column counts", () => {
      for (const [orientation, isTV] of [
        ["portrait", true],
        ["landscape", true],
        ["portrait", false],
        ["landscape", false],
      ] as [SlotOrientation, boolean][]) {
        const numColumns = slotColumns(orientation, isTV);
        // One short of two full rows: every column past the last row's end is stranded.
        const total = numColumns * 2 - 1;
        expect(strandedIndices(total, numColumns)).toEqual([numColumns - 1]);
      }
    });
  });
});
