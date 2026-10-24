import { packArtworkRows } from "@/utils/artworkRows";
import { GRID, gridEdgePadding, liveRowHeight, slotCardPadding, slotRowHeights } from "../app";

/** Cards in the first full row of a channel grid packed at one shape. */
function perRow(width: number, height: number, isTV: boolean, ratio: number, live: boolean): number {
  const padding = slotCardPadding(isTV);
  const usable = width - 2 * gridEdgePadding(0, isTV);
  const landscape = slotRowHeights(width, height, 0, 0, isTV, "grid").landscape;
  const rowHeight = live ? liveRowHeight(landscape, padding) : landscape;
  const items = Array.from({ length: 24 }, (_, i) => i);
  const rows = packArtworkRows(items, usable, () => ({ ratio, height: rowHeight }), padding);
  return rows[0].cards.length;
}

describe("liveRowHeight", () => {
  it("draws a 16:9 card as wide as a 3:2 card on the landscape row", () => {
    const padding = slotCardPadding(true);
    const width = (h: number, ratio: number) => (h - 2 * padding) * ratio + 2 * padding;
    expect(width(liveRowHeight(300, padding), GRID.LIVE_RATIO)).toBeCloseTo(width(300, GRID.LANDSCAPE_RATIO), 6);
  });

  it.each([
    ["Apple TV", 1920, 1080, true],
    ["iPhone portrait", 393, 852, false],
    ["iPhone landscape", 852, 393, false],
    ["iPad landscape", 1376, 1032, false],
  ] as const)("keeps the channel grid's cards per row on %s", (_name, width, height, isTV) => {
    expect(perRow(width, height, isTV, GRID.LIVE_RATIO, true)).toBe(perRow(width, height, isTV, GRID.LANDSCAPE_RATIO, false));
  });

  it("holds four channel cards a row on Apple TV", () => {
    expect(perRow(1920, 1080, true, GRID.LIVE_RATIO, true)).toBe(4);
  });
});
