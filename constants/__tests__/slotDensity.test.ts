import { GRID, gridEdgePadding, itemSlotRatio, shelfHeadingBlock, shelfSpacing, slotCardPadding, slotRowHeights } from "../app";

const PAD = slotCardPadding(false);
/** The width a card renders at for a given row height (video-grid-item / folder-grid-item). */
const cardWidth = (height: number, ratio: number) => (height - 2 * PAD) * ratio + 2 * PAD;

type Device = { name: string; short: number; long: number; landscapeInset: number };
const DEVICES: Device[] = [
  { name: "iPhone 15", short: 393, long: 852, landscapeInset: 59 },
  { name: "iPad mini", short: 744, long: 1133, landscapeInset: 0 },
  { name: "iPad 9.7", short: 768, long: 1024, landscapeInset: 0 },
  { name: "iPad Pro 13", short: 1032, long: 1376, landscapeInset: 0 },
];

const SHAPES = [
  { key: "portrait" as const, ratio: GRID.PORTRAIT_RATIO },
  { key: "square" as const, ratio: 1 },
  { key: "landscape" as const, ratio: GRID.LANDSCAPE_RATIO },
];

function metrics(device: Device, orientation: "portrait" | "landscape", surface: "shelf" | "grid" = "shelf") {
  const [w, h] = orientation === "portrait" ? [device.short, device.long] : [device.long, device.short];
  const inset = orientation === "portrait" ? 0 : device.landscapeInset;
  const heights = slotRowHeights(w, h, inset, inset, false, surface);
  const usable = w - 2 * gridEdgePadding(inset, false);
  return { heights, usable };
}

describe("slotRowHeights on TV", () => {
  it("ignores window height — the TV branch is width-only and predates the density model", () => {
    const a = slotRowHeights(1920, 1080, 80, 80, true);
    expect(slotRowHeights(1920, 999, 80, 80, true)).toEqual(a);
    expect(slotRowHeights(1920, 1080, 80, 80, true, "grid")).toEqual(a);
    // One converged height for every shape, so a mixed TV row never stretches a card.
    expect(a).toEqual({ portrait: 314, square: 314, landscape: 314 });
  });
});

describe("slotRowHeights density", () => {
  it("lands the reference phone in portrait on exactly the declared per-screen counts", () => {
    const { heights, usable } = metrics(DEVICES[0], "portrait");
    const per = GRID.DENSITY_PER_SCREEN;
    expect(usable / cardWidth(heights.portrait, GRID.PORTRAIT_RATIO)).toBeCloseTo(per.portrait, 1);
    expect(usable / cardWidth(heights.square, 1)).toBeCloseTo(per.square, 1);
    expect(usable / cardWidth(heights.landscape, GRID.LANDSCAPE_RATIO)).toBeCloseTo(per.landscapeShelf, 1);
    const grid = metrics(DEVICES[0], "portrait", "grid");
    expect(grid.usable / cardWidth(grid.heights.landscape, GRID.LANDSCAPE_RATIO)).toBeCloseTo(per.landscapeGrid, 1);
  });

  it("never rounds a whole-card count away from the size it asked for", () => {
    // THE regression: an iPhone 17 Pro Max asks for 3.84 posters per screen. Stepping that
    // off its whole-number quantum ALWAYS upward landed 4.5 and shrank every poster 23%.
    const { heights, usable } = metrics({ name: "iPhone 17 Pro Max", short: 440, long: 956, landscapeInset: 62 }, "portrait");
    expect(usable / cardWidth(heights.portrait, GRID.PORTRAIT_RATIO)).toBeCloseTo(GRID.DENSITY_PER_SCREEN.portrait, 1);
    expect(heights.portrait).toBe(163);
  });

  it("never inflates a card on rotation", () => {
    // THE regression: heights derived from width alone made every card 35% bigger in
    // landscape, so the wider screen showed FEWER shelves than the portrait one.
    for (const device of DEVICES) {
      for (const surface of ["shelf", "grid"] as const) {
        const p = metrics(device, "portrait", surface);
        const l = metrics(device, "landscape", surface);
        for (const { key, ratio } of SHAPES) {
          // The slack is half-card quantization at low counts (a grid base of 2 rounds up in
          // portrait and down in landscape); the bug this guards was +35%.
          expect(cardWidth(l.heights[key], ratio)).toBeLessThanOrEqual(cardWidth(p.heights[key], ratio) * 1.12);
        }
      }
    }
  });

  it("fills a portrait viewport with the four home shelves", () => {
    // A 13-inch iPad in portrait left 30% of the screen empty at the width-derived size:
    // the same stack that fills its 1032pt landscape does not reach the bottom of its 1376.
    for (const device of DEVICES) {
      const { heights } = metrics(device, "portrait");
      const tallest = Math.max(heights.portrait, heights.square, heights.landscape);
      // Libraries is all-wide, the other three carry mixed art and render at their tallest.
      const stack = heights.landscape + 3 * tallest + 4 * shelfHeadingBlock(shelfSpacing(false, device.short, device.long));
      expect((stack + shelfSpacing(false, device.short, device.long).chrome) / device.long).toBeGreaterThan(0.85);
    }
  });

  it("spends the extra landscape width on more cards, never on bigger ones", () => {
    for (const device of DEVICES) {
      const p = metrics(device, "portrait");
      const l = metrics(device, "landscape");
      for (const { key, ratio } of SHAPES) {
        expect(l.usable / cardWidth(l.heights[key], ratio)).toBeGreaterThan(p.usable / cardWidth(p.heights[key], ratio));
      }
    }
  });

  it("gives a tablet bigger cards AND more of them than the reference phone", () => {
    // Not pairwise across tablets: card size follows the viewport HEIGHT once the fill
    // correction engages, so a taller-but-narrower iPad carries larger point sizes.
    const [phone, ...tablets] = DEVICES.map((d) => metrics(d, "portrait"));
    for (const { key, ratio } of SHAPES) {
      const phoneSize = cardWidth(phone.heights[key], ratio);
      for (const tablet of tablets) {
        const size = cardWidth(tablet.heights[key], ratio);
        expect(size).toBeGreaterThan(phoneSize);
        expect(tablet.usable / size).toBeGreaterThan(phone.usable / phoneSize);
      }
    }
  });

  it("never lets a card eat a third of a screen wider than the reference phone", () => {
    // Worst case is a mixed row: MediaShelf renders every card at the row's TALLEST shape,
    // so a 16:9 thumb next to one poster renders at the poster's height.
    for (const device of DEVICES) {
      for (const orientation of ["portrait", "landscape"] as const) {
        const { heights, usable } = metrics(device, orientation);
        if (usable <= GRID.DENSITY_REFERENCE_WIDTH - 2 * GRID.SIDE_PADDING.phone) continue;
        const tallest = Math.max(heights.portrait, heights.square, heights.landscape);
        for (const { ratio } of SHAPES) {
          expect(cardWidth(tallest, ratio) / usable).toBeLessThanOrEqual(GRID.MAX_CARD_WIDTH_SHARE);
        }
      }
    }
  });

  it("survives a window height reported as zero mid-layout", () => {
    for (const badHeight of [0, -1, NaN]) {
      const heights = slotRowHeights(1024, badHeight, 0, 0, false);
      for (const { key, ratio } of SHAPES) {
        expect(heights[key]).toBeGreaterThan(2 * PAD);
        expect(cardWidth(heights[key], ratio)).toBeLessThan(1024);
      }
    }
  });

  it("agrees with the ratio the cards actually render at", () => {
    const { heights } = metrics(DEVICES[1], "landscape");
    expect(cardWidth(heights.portrait, itemSlotRatio(2 / 3))).toBeCloseTo(cardWidth(heights.portrait, GRID.PORTRAIT_RATIO), 5);
    expect(cardWidth(heights.landscape, itemSlotRatio(16 / 9))).toBeCloseTo(cardWidth(heights.landscape, GRID.LANDSCAPE_RATIO), 5);
  });
});
