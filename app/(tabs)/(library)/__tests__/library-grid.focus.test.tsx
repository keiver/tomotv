/**
 * Focus Navigation Tests for the Folder Grid
 *
 * Regression coverage for the tvOS folder-grid focus contract in components/library-grid.tsx
 * (the grid renders packed rows of mixed-shape cards; the Home tab's shelf layout is
 * components/home-shelves.tsx). Up out of the top row is UIKit's own traversal into the screen's
 * navigation bar, so the grid states only two rules of its own: Down out of a ragged last row to
 * the final card, and which card takes the mount-time focus claim. These tests mirror those rules
 * as `renderRow` applies them, anchored to the real packing source (utils/artworkRows) so a change
 * to the layout math is caught here too.
 *
 * Rules under test (components/library-grid.tsx `renderRow`):
 *   nextFocusDown = isSecondToLastRow && isStrandedAboveLastRow(card, lastRowWidth) ? lastCardHandle : undefined
 *   hasTVPreferredFocus = card is the focus target (focusItemId, else the first item)
 *
 * Same logic-mirror style as app/(tabs)/__tests__/search.focus.test.tsx.
 */

import { isStrandedAboveLastRow, packArtworkRows } from "@/utils/artworkRows";

const LAST_CARD_HANDLE = 7373;

// Fixtures mirror the grid's call: ratio per item, uniform height, real packing.
const pack = (ratios: number[], availableWidth: number) => packArtworkRows(ratios, availableWidth, (r) => ({ ratio: r, height: 100 }), 0);

describe("Folder Grid Focus Navigation (packed rows)", () => {
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
    // Mirror of focusTargetId in library-grid.tsx: the "Show In Folder" target once it has
    // loaded, else the first item.
    const focusTargetIdFor = (focusItemId: string | undefined, ids: string[]) => (focusItemId && ids.includes(focusItemId) ? focusItemId : ids[0]);

    it("targets focusItemId when present, else the first item", () => {
      expect(focusTargetIdFor(undefined, ["a", "b"])).toBe("a");
      expect(focusTargetIdFor("b", ["a", "b"])).toBe("b");
    });

    it("falls back to the first item while the target's page has not loaded", () => {
      expect(focusTargetIdFor("missing", ["a", "b"])).toBe("a");
    });
  });

  describe("mount-time claim gating", () => {
    // Mirror of claimsFocusOnMount in library-grid.tsx: only the target card claims, only while
    // this screen is on top (the claim writes an app-wide slot), and only until the latch is set.
    const claims = (isFocusTarget: boolean, isScreenFocused: boolean, handoffDone: boolean) => isFocusTarget && isScreenFocused && !handoffDone;

    it("claims once, from the target card of the screen on top", () => {
      expect(claims(true, true, false)).toBe(true);
      expect(claims(false, true, false)).toBe(false); // not the target
      expect(claims(true, false, false)).toBe(false); // covered screen
      expect(claims(true, true, true)).toBe(false); // latched: the viewer owns focus
    });
  });
});
