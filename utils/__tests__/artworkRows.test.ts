import { isStrandedAboveLastRow, packArtworkRows } from "../artworkRows";

// Simple fixtures: ratio IS the item, uniform height 100, padding 0 → natural width = 100 * ratio.
const pack = (ratios: number[], availableWidth: number) => packArtworkRows(ratios, availableWidth, (r) => ({ ratio: r, height: 100 }), 0);

describe("packArtworkRows (justified)", () => {
  it("wraps and justifies full rows to exactly fill the width", () => {
    // Naturals 150 each into 320: two per row; the full row scales up to 320.
    const rows = pack([1.5, 1.5, 1.5], 320);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards).toHaveLength(2);
    expect(rows[0].width).toBeCloseTo(320, 5);
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(320 / 3, 5); // ≈106.7, scaled above nominal
    // Last row stays natural — never scaled up to fill.
    expect(rows[1].cards).toHaveLength(1);
    expect(rows[1].width).toBeCloseTo(150, 5);
    expect(rows[1].cards[0].cardHeight).toBe(100);
  });

  it("breaks where the justified scale lands closest to 1", () => {
    // 100 + 100 + 20 = 220 > 210. With the third card scale ≈ 0.955 (off by 0.045);
    // without it 1.05 (off by 0.05) → the third card joins the row.
    const rows = pack([1.0, 1.0, 0.2], 210);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(3);
    expect(rows[0].width).toBeCloseTo(210, 5);
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(100 * (210 / 220), 5);
  });

  it("unifies a mixed row to its tallest shape — never uneven", () => {
    // Poster (2/3 at 135) + wide (16/9 at 100): the wide card grows to the poster's height,
    // making the pair 135*(2/3 + 16/9) = 330 wide → into 320 the row scales to ≈0.97 and
    // BOTH cards land on the same height. The trailing poster wraps to its own row.
    const rows = packArtworkRows(
      [
        { r: 2 / 3, h: 135 },
        { r: 16 / 9, h: 100 },
        { r: 2 / 3, h: 135 },
      ],
      320,
      ({ r, h }) => ({ ratio: r, height: h }),
      0,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].width).toBeCloseTo(320, 5);
    const scale = 320 / (135 * (2 / 3 + 16 / 9));
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(135 * scale, 5);
    // The wide card matches the poster's height exactly — no gap above it.
    expect(rows[0].cards[1].cardHeight).toBe(rows[0].cards[0].cardHeight);
    // The lone last-row poster keeps its nominal size.
    expect(rows[1].cards[0].cardHeight).toBe(135);
  });

  it("clamps degenerate scales instead of distorting", () => {
    // A near-viewport-wide card alone in a non-last row would scale to ≈0.22 — clamped to
    // 0.8, accepting fractional overflow over a distorted row.
    const rows = pack([4.5, 4.5], 100);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(80, 5);
  });

  it("keeps a lone underfilled last row at nominal size", () => {
    const rows = pack([1.0], 320);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards[0].cardHeight).toBe(100);
    expect(rows[0].width).toBeCloseTo(100, 5);
  });

  it("shrinks a last-row card wider than the viewport to fit", () => {
    const rows = pack([16 / 9], 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(56.25, 2);
    expect(rows[0].width).toBeCloseTo(100, 5);
  });

  it("tracks each card's left edge within its row", () => {
    // 150 + 50 + 100 = 300 ≤ 320 → one (last) row at natural sizes.
    const rows = pack([1.5, 0.5, 1.0], 320);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards.map((c) => c.x)).toEqual([0, 150, 200]);
  });

  it("returns no rows for no items", () => {
    expect(pack([], 320)).toEqual([]);
  });

  it("accounts for card padding in the width", () => {
    // (100 - 2*10) * 1 + 2*10 = 100
    const rows = packArtworkRows([1], 320, () => ({ ratio: 1, height: 100 }), 10);
    expect(rows[0].cards[0].width).toBe(100);
  });
});

describe("isStrandedAboveLastRow", () => {
  it("strands cards starting past the last row's right edge", () => {
    // Row 0 justifies to [0..160), [160..320). Last row: width 100.
    const rows = pack([1.5, 1.5, 1.0], 320);
    const [rowA, rowB] = rows;
    expect(isStrandedAboveLastRow(rowA.cards[0], rowB.width)).toBe(false); // overlaps below
    expect(isStrandedAboveLastRow(rowA.cards[1], rowB.width)).toBe(true); // starts at 160 ≥ 100
  });

  it("strands nothing when the last row spans at least as far", () => {
    const rows = pack([1.0, 1.0, 1.0, 1.0], 220);
    expect(rows).toHaveLength(2);
    const [rowA, rowB] = rows;
    expect(rowA.cards.every((c) => !isStrandedAboveLastRow(c, rowB.width))).toBe(true);
  });
});
