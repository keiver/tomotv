import { isStrandedAboveLastRow, packArtworkRows } from "../artworkRows";

// Simple fixtures: ratio IS the item, height 100, padding 0 → card width = 100 * ratio.
const pack = (ratios: number[], availableWidth: number) => packArtworkRows(ratios, availableWidth, 100, (r) => r, 0);

describe("packArtworkRows", () => {
  it("fills a row and wraps when the next card would overflow", () => {
    // Widths 150, 150, 150 into 320 → two fit, third wraps.
    const rows = pack([1.5, 1.5, 1.5], 320);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards).toHaveLength(2);
    expect(rows[0].width).toBe(300);
    expect(rows[1].cards).toHaveLength(1);
    expect(rows[1].width).toBe(150);
  });

  it("tracks each card's left edge within its row", () => {
    const rows = pack([1.5, 0.5, 1.0], 320);
    // 150 + 50 + 100 = 300 ≤ 320 → one row.
    expect(rows).toHaveLength(1);
    expect(rows[0].cards.map((c) => c.x)).toEqual([0, 150, 200]);
  });

  it("mixes shapes in one row (poster + square + wide)", () => {
    // 2/3 → 66.7, 1 → 100, 16/9 → 177.8; sum ≈ 344 ≤ 350.
    const rows = pack([2 / 3, 1, 16 / 9], 350);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(3);
  });

  it("always places at least one card per row, even wider than the viewport", () => {
    const rows = pack([16 / 9], 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards[0].width).toBeCloseTo(177.78, 1);
  });

  it("returns no rows for no items", () => {
    expect(pack([], 320)).toEqual([]);
  });

  it("accounts for card padding in the width", () => {
    // (100 - 2*10) * 1 + 2*10 = 100
    const rows = packArtworkRows([1], 320, 100, () => 1, 10);
    expect(rows[0].cards[0].width).toBe(100);
  });
});

describe("isStrandedAboveLastRow", () => {
  it("strands cards starting past the last row's right edge", () => {
    // Row A: [0..150), [150..300). Row B (last): width 100.
    const rows = pack([1.5, 1.5, 1.0], 320);
    const [rowA, rowB] = rows;
    expect(isStrandedAboveLastRow(rowA.cards[0], rowB.width)).toBe(false); // overlaps below
    expect(isStrandedAboveLastRow(rowA.cards[1], rowB.width)).toBe(true); // starts at 150 ≥ 100
  });

  it("strands nothing when the last row is at least as wide", () => {
    const rows = pack([1.0, 1.0, 1.5, 1.0], 220);
    // Rows: [100, 100] (200), [150], [100]? — recompute: 100+100=200 ≤ 220; +150 → wrap; 150+100=250 > 220 → wrap.
    expect(rows).toHaveLength(3);
    const secondToLast = rows[1];
    expect(secondToLast.cards.every((c) => !isStrandedAboveLastRow(c, rows[2].width))).toBe(true);
  });
});
