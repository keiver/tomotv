/**
 * Focus Navigation Tests for the Folder Grid
 *
 * Regression coverage for the tvOS folder-grid focus contract in components/library-grid.tsx
 * (the grid renders packed rows of mixed-shape cards; the Home tab's shelf layout is
 * components/home-shelves.tsx). The component routes Up from the first row straight to the
 * pinned Filters button via `nextFocusUp` (a deterministic native handle, not a fragile
 * focus-guide redirect), and Down out of a ragged last row to the final card. These tests
 * mirror the rules the grid applies in `renderRow`, anchored to the real packing source
 * (utils/artworkRows) so a change to the layout math is caught here too.
 *
 * Rules under test (components/library-grid.tsx `renderRow`):
 *   nextFocusUp   = rowIndex === 0 ? filtersButtonHandle : undefined
 *   nextFocusDown = isSecondToLastRow && isStrandedAboveLastRow(card, lastRowWidth) ? lastCardHandle : undefined
 *   hasTVPreferredFocus = card is the focus target (focusItemId, else the first item)
 *
 * Same logic-mirror style as app/(tabs)/__tests__/search.focus.test.tsx.
 */

import { isStrandedAboveLastRow, packArtworkRows } from "@/utils/artworkRows";

const FILTERS_BUTTON_HANDLE = 4242;
const LAST_CARD_HANDLE = 7373;

/** The grid's per-row Up target, copied verbatim from library-grid.tsx `renderRow`. */
function nextFocusUpFor(rowIndex: number, filtersButtonHandle: number | undefined): number | undefined {
  return rowIndex === 0 ? filtersButtonHandle : undefined;
}

// Fixtures mirror the grid's call: ratio per item, uniform height, real packing.
const pack = (ratios: number[], availableWidth: number) => packArtworkRows(ratios, availableWidth, (r) => ({ ratio: r, height: 100 }), 0);

describe("Folder Grid Focus Navigation (packed rows)", () => {
  describe("nextFocusUp", () => {
    it("routes every first-row card Up to the Filters button, and no others", () => {
      const rows = pack([1.5, 1.5, 1.5, 1.5], 320); // 2 rows of 2
      rows.forEach((row, rowIndex) => {
        for (const _card of row.cards) {
          expect(nextFocusUpFor(rowIndex, FILTERS_BUTTON_HANDLE)).toBe(rowIndex === 0 ? FILTERS_BUTTON_HANDLE : undefined);
        }
      });
    });

    it("yields undefined until the header reports its native node", () => {
      expect(nextFocusUpFor(0, undefined)).toBeUndefined();
    });
  });

  describe("nextFocusDown — ragged last row", () => {
    /** The grid's per-card Down rule, copied verbatim from library-grid.tsx `renderRow`. */
    function nextFocusDownFor(rows: ReturnType<typeof pack>, rowIndex: number, cardIndex: number): number | undefined {
      const lastRowWidth = rows[rows.length - 1].width;
      const isSecondToLastRow = rowIndex === rows.length - 2;
      return isSecondToLastRow && isStrandedAboveLastRow(rows[rowIndex].cards[cardIndex], lastRowWidth) ? LAST_CARD_HANDLE : undefined;
    }

    it("routes cards starting past the last row's right edge to the final card", () => {
      // Row 0: two 150-wide cards (x 0, 150). Row 1: one 100-wide card.
      const rows = pack([1.5, 1.5, 1.0], 320);
      expect(nextFocusDownFor(rows, 0, 0)).toBeUndefined(); // overlaps the card below
      expect(nextFocusDownFor(rows, 0, 1)).toBe(LAST_CARD_HANDLE); // starts at 150 ≥ 100
    });

    it("overrides nothing when the last row is at least as wide", () => {
      const rows = pack([1.0, 1.0, 1.0, 1.0], 220); // 2 rows of 2, equal widths
      expect(nextFocusDownFor(rows, 0, 0)).toBeUndefined();
      expect(nextFocusDownFor(rows, 0, 1)).toBeUndefined();
    });

    it("never applies outside the second-to-last row", () => {
      const rows = pack([1.5, 1.5, 1.5, 1.5, 1.0], 320); // 3 rows: 2 + 2 + 1
      expect(nextFocusDownFor(rows, 0, 1)).toBeUndefined(); // first row, even though ragged below exists further down
      expect(nextFocusDownFor(rows, 1, 1)).toBe(LAST_CARD_HANDLE); // second-to-last row, stranded
    });

    it("single row: no rule fires", () => {
      const rows = pack([1.5, 1.0], 320);
      expect(rows).toHaveLength(1);
      // rows.length - 2 === -1: no row qualifies as second-to-last.
      expect(rows.length - 2).toBeLessThan(0);
    });
  });

  describe("hasTVPreferredFocus", () => {
    it("targets focusItemId when present, else the first item", () => {
      // Mirror of focusTargetId in library-grid.tsx.
      const focusTargetIdFor = (focusItemId: string | undefined, ids: string[]) => (focusItemId && ids.includes(focusItemId) ? focusItemId : ids[0]);
      expect(focusTargetIdFor(undefined, ["a", "b"])).toBe("a");
      expect(focusTargetIdFor("b", ["a", "b"])).toBe("b");
      expect(focusTargetIdFor("missing", ["a", "b"])).toBe("a");
    });
  });
});
