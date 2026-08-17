import { artworkSlotShape, cardSlotRatio, GRID, itemSlotRatio, itemSlotShape, slotRatio } from "../app";

describe("itemSlotShape", () => {
  it("snaps real aspects to the three card shapes", () => {
    expect(itemSlotShape(2 / 3)).toBe("portrait"); // movie poster
    expect(itemSlotShape(0.7)).toBe("portrait");
    expect(itemSlotShape(1.0)).toBe("square"); // album art
    expect(itemSlotShape(16 / 9)).toBe("landscape"); // episode thumb
    expect(itemSlotShape(1.5)).toBe("landscape");
  });

  it("holds the exact shape boundaries", () => {
    expect(itemSlotShape(0.8499)).toBe("portrait");
    expect(itemSlotShape(0.85)).toBe("square");
    expect(itemSlotShape(1.25)).toBe("square");
    expect(itemSlotShape(1.2501)).toBe("landscape");
  });

  it("matches artworkSlotShape for every valid aspect", () => {
    for (let aspect = 0.05; aspect <= 4; aspect += 0.05) {
      expect(itemSlotShape(aspect)).toBe(artworkSlotShape(aspect));
    }
  });

  it("falls back to square for missing aspects (the placeholder face is square art)", () => {
    expect(itemSlotShape(undefined)).toBe("square");
    expect(itemSlotShape(null)).toBe("square");
  });

  it("falls back to square for garbage aspects", () => {
    expect(itemSlotShape(0)).toBe("square");
    expect(itemSlotShape(-1)).toBe("square");
    expect(itemSlotShape(NaN)).toBe("square");
    expect(itemSlotShape(Infinity)).toBe("square");
    expect(itemSlotShape(-Infinity)).toBe("square");
  });
});

describe("itemSlotRatio", () => {
  it("maps each shape to its slot ratio", () => {
    expect(itemSlotRatio(2 / 3)).toBe(GRID.PORTRAIT_RATIO);
    expect(itemSlotRatio(1.0)).toBe(1);
    expect(itemSlotRatio(16 / 9)).toBe(GRID.LANDSCAPE_RATIO);
  });

  it("returns the square ratio for missing or garbage aspects", () => {
    for (const aspect of [undefined, null, 0, -1, NaN, Infinity]) {
      expect(itemSlotRatio(aspect)).toBe(1);
    }
  });

  it("always returns a finite positive ratio", () => {
    for (const aspect of [undefined, null, 0, -5, NaN, Infinity, -Infinity, 0.0001, 1000, 2 / 3, 1, 16 / 9]) {
      const ratio = itemSlotRatio(aspect);
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeGreaterThan(0);
    }
  });
});

describe("cardSlotRatio", () => {
  it("uses the item's snapped shape in fitArtwork surfaces", () => {
    expect(cardSlotRatio(true, 16 / 9, "portrait")).toBe(GRID.LANDSCAPE_RATIO);
    expect(cardSlotRatio(true, 2 / 3, "landscape")).toBe(GRID.PORTRAIT_RATIO);
    expect(cardSlotRatio(true, undefined, "landscape")).toBe(1);
  });

  it("uses the uniform slot outside fitArtwork, ignoring the aspect", () => {
    expect(cardSlotRatio(false, 16 / 9, "portrait")).toBe(slotRatio("portrait"));
    expect(cardSlotRatio(false, undefined, "landscape")).toBe(slotRatio("landscape"));
    expect(cardSlotRatio(false, 1.0, "portrait")).toBe(GRID.PORTRAIT_RATIO);
  });

  it("agrees with itemSlotRatio for every aspect in fitArtwork mode", () => {
    for (const aspect of [undefined, null, 0, NaN, -2, Infinity, 0.3, 0.85, 1, 1.25, 1.26, 16 / 9, 3]) {
      expect(cardSlotRatio(true, aspect, "portrait")).toBe(itemSlotRatio(aspect));
      expect(cardSlotRatio(true, aspect, "landscape")).toBe(itemSlotRatio(aspect));
    }
  });
});
