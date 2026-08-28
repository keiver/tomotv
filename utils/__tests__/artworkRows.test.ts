import { cardSlotRatio, itemSlotRatio, itemSlotShape, slotCardPadding, slotRowHeights } from "@/constants/app";
import { CardMetrics, isStrandedAboveLastRow, packArtworkRows, PackedRow } from "../artworkRows";

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
    // Last row: never justified to fill, but matches the previous row's card size.
    expect(rows[1].cards).toHaveLength(1);
    expect(rows[1].cards[0].cardHeight).toBeCloseTo(rows[0].cards[0].cardHeight, 5);
    expect(rows[1].width).toBeCloseTo(160, 5);
  });

  it("breaks where the justified scale costs least", () => {
    // 100 + 100 + 5 = 205 > 203. With the third card scale ≈ 0.990 (cheap even with the
    // shrink penalty); without it 1.015 → the third card joins the row.
    const rows = pack([1.0, 1.0, 0.05], 203);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(3);
    expect(rows[0].width).toBeCloseTo(203, 5);
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(100 * (203 / 205), 5);
  });

  it("prefers stretching fewer cards over squeezing one more in", () => {
    // Four 100-wide cards into 350: four fit at 0.875 (penalized cost ≈ 0.19), three
    // stretch to 1.167 (cost ≈ 0.15) → the row takes three, larger.
    const rows = pack([1.0, 1.0, 1.0, 1.0], 350);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards).toHaveLength(3);
    expect(rows[0].width).toBeCloseTo(350, 5);
    expect(rows[0].cards[0].cardHeight).toBeCloseTo(100 * (350 / 300), 5);
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
    // The lone last-row poster matches the previous row's card size.
    expect(rows[1].cards[0].cardHeight).toBeCloseTo(rows[0].cards[0].cardHeight, 5);
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

// Invariants every packed layout must satisfy, whatever the input.
function expectSaneLayout<T>(rows: PackedRow<T>[], items: readonly T[], availableWidth: number) {
  // Conservation: every item exactly once, in order.
  const packedItems = rows.flatMap((row) => row.cards.map((card) => card.item));
  expect(packedItems).toEqual([...items]);
  for (const row of rows) {
    expect(row.cards.length).toBeGreaterThan(0);
    const height = row.cards[0].cardHeight;
    let x = 0;
    for (const card of row.cards) {
      // All finite and positive — one NaN poisons the whole list's styles.
      expect(Number.isFinite(card.width)).toBe(true);
      expect(Number.isFinite(card.cardHeight)).toBe(true);
      expect(Number.isFinite(card.x)).toBe(true);
      expect(card.width).toBeGreaterThan(0);
      expect(card.cardHeight).toBeGreaterThan(0);
      // One height per row, contiguous left edges.
      expect(card.cardHeight).toBe(height);
      expect(card.x).toBeCloseTo(x, 5);
      x += card.width;
    }
    expect(row.width).toBeCloseTo(x, 5);
  }
  // The last row never overflows (it only ever adopts a scale capped by its exact fill).
  if (rows.length > 0 && availableWidth > 0) {
    expect(rows[rows.length - 1].width).toBeLessThanOrEqual(availableWidth + 1e-6);
  }
}

describe("packArtworkRows (robustness)", () => {
  // Deterministic LCG so failures reproduce.
  const lcg = (seed: number) => () => (seed = (seed * 48271) % 2147483647) / 2147483647;

  it("holds the layout invariants for large mixed batches at real device metrics", () => {
    for (const [windowWidth, windowHeight, isTV] of [
      [393, 852, false],
      [852, 393, false],
      [1024, 768, false],
      [1920, 1080, true],
    ] as const) {
      const padding = slotCardPadding(isTV);
      const heights = slotRowHeights(windowWidth, windowHeight, 0, 0, isTV, "grid");
      const rand = lcg(42);
      // Aspect pool mirrors real folders: posters, squares, thumbs, and no-art items.
      const aspects = Array.from({ length: 200 }, () => [2 / 3, 1.0, 16 / 9, 1.78, 0.68, undefined][Math.floor(rand() * 6)]);
      const rows = packArtworkRows(aspects, windowWidth, (aspect) => ({ ratio: itemSlotRatio(aspect), height: heights[itemSlotShape(aspect)] }), padding);
      expectSaneLayout(rows, aspects, windowWidth);
      // Full rows justify to the width, give or take the MIN/MAX scale clamps (a clamped
      // row deviates fractionally rather than distorting card sizes). The 6% band still
      // catches real packing bugs — a card-slot mismatch leaves 20%+ holes.
      for (const row of rows.slice(0, -1)) {
        expect(row.width).toBeGreaterThan(windowWidth * 0.94);
        expect(row.width).toBeLessThan(windowWidth * 1.06);
      }
    }
  });

  it("allocates each card exactly the width its component renders at", () => {
    // THE regression: the packer sized no-art items by folder orientation while the card
    // rendered itself square, leaving holes in justified rows. Both sides must derive from
    // the same shape mapping for every aspect the server can send — garbage included.
    const padding = slotCardPadding(false);
    const heights = slotRowHeights(393, 852, 0, 0, false, "grid");
    const aspects = [2 / 3, 1.0, 16 / 9, undefined, null, 0, NaN, -1, Infinity, 0.85, 1.25, 1.26, 3.5];
    const rows = packArtworkRows(aspects, 393, (aspect) => ({ ratio: itemSlotRatio(aspect), height: heights[itemSlotShape(aspect)] }), padding);
    for (const row of rows) {
      for (const card of row.cards) {
        // The card component's width formula (video-grid-item / folder-grid-item,
        // cardHeight branch): (cardHeight - 2*padding) * cardSlotRatio + 2*padding.
        const rendered = (card.cardHeight - 2 * padding) * cardSlotRatio(true, card.item, "portrait") + 2 * padding;
        expect(card.width).toBeCloseTo(rendered, 5);
      }
    }
  });

  it("survives a transient zero or negative available width", () => {
    for (const badWidth of [0, -100, NaN]) {
      const rows = packArtworkRows([1, 1.5, 2 / 3], badWidth, (r) => ({ ratio: r, height: 100 }), 6);
      expectSaneLayout(rows, [1, 1.5, 2 / 3], badWidth);
    }
  });

  it("survives garbage metrics without emitting NaN", () => {
    const garbage: CardMetrics[] = [
      { ratio: NaN, height: 100 },
      { ratio: 0, height: 100 },
      { ratio: -2, height: 100 },
      { ratio: Infinity, height: 100 },
      { ratio: 1, height: NaN },
      { ratio: 1, height: 0 },
      { ratio: 1, height: -50 },
    ];
    const rows = packArtworkRows(garbage, 393, (m) => m, 6);
    expectSaneLayout(rows, garbage, 393);
  });

  it("treats a bad ratio as square", () => {
    // One good square card and one NaN-ratio card at the same height pack identically.
    const rows = packArtworkRows(
      [
        { ratio: 1, height: 100 },
        { ratio: NaN, height: 100 },
      ],
      500,
      (m) => m,
      0,
    );
    expect(rows[0].cards[0].width).toBeCloseTo(rows[0].cards[1].width, 5);
  });

  it("survives a height smaller than the padding", () => {
    // inner = height - 2*padding goes non-positive; the guard floors it instead of
    // feeding a negative height into every scale.
    const rows = packArtworkRows([1, 1], 393, () => ({ ratio: 1, height: 8 }), 6);
    expectSaneLayout(rows, [1, 1], 393);
  });

  it("packs a single no-art item as a square card", () => {
    const padding = slotCardPadding(false);
    const heights = slotRowHeights(393, 852, 0, 0, false, "grid");
    const rows = packArtworkRows([undefined], 393, (aspect) => ({ ratio: itemSlotRatio(aspect), height: heights[itemSlotShape(aspect)] }), padding);
    expect(rows).toHaveLength(1);
    const card = rows[0].cards[0];
    // Square: inner width equals inner height.
    expect(card.width - 2 * padding).toBeCloseTo(card.cardHeight - 2 * padding, 5);
  });

  it("keeps every card inside the viewport at real metrics", () => {
    const padding = slotCardPadding(true);
    const heights = slotRowHeights(1920, 1080, 0, 0, true, "grid");
    const rand = lcg(7);
    const aspects = Array.from({ length: 100 }, () => [2 / 3, 1.0, 16 / 9, undefined][Math.floor(rand() * 4)]);
    const rows = packArtworkRows(aspects, 1920, (aspect) => ({ ratio: itemSlotRatio(aspect), height: heights[itemSlotShape(aspect)] }), padding);
    for (const row of rows) {
      for (const card of row.cards) {
        expect(card.x + card.width).toBeLessThanOrEqual(1920 + 1e-6);
      }
    }
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
