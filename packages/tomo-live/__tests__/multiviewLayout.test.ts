import {
  keepMultiviewOrder,
  MULTIVIEW_ASPECT,
  MULTIVIEW_LAYOUTS,
  multiviewChannels,
  multiviewCut,
  multiviewFeatured,
  multiviewFit,
  multiviewGroupCard,
  multiviewGroupCount,
  multiviewGroupRows,
  multiviewLiveCount,
  multiviewSpotCount,
  multiviewSpots,
  multiviewStripCard,
  type MultiviewRect,
  type MultiviewSpace,
} from "../src/multiviewLayout";

describe("multiviewChannels", () => {
  const list = Array.from({ length: 20 }, (_, i) => `c${i + 90}`);

  it("puts the chosen channel first, then the channels around it in list order, half before and the rest after", () => {
    expect(multiviewChannels(list, "c101", 4)).toEqual(["c101", "c100", "c102", "c103"]);
  });

  it("wraps at the ends of the list", () => {
    expect(multiviewChannels(list, "c90", 4)).toEqual(["c90", "c109", "c91", "c92"]);
  });

  it("passes over the channels it is told to skip, and keeps the count", () => {
    const skip = (id: string) => id === "c100" || id === "c102";
    expect(multiviewChannels(list, "c101", 4, skip)).toEqual(["c101", "c99", "c103", "c104"]);
  });

  it("keeps the spots on screen in place when one drops out, and fills the end from the fresh list", () => {
    expect(keepMultiviewOrder(["m", "a", "b", "c"], ["m", "x", "a", "b", "c", "d"], 4, (id) => id !== "b")).toEqual(["m", "a", "c", "x"]);
    expect(keepMultiviewOrder(["b", "m", "a"], ["m", "a", "z"], 3, () => true)).toEqual(["b", "m", "a"]);
    expect(keepMultiviewOrder(["m", "a", "b"], ["m", "a"], 2, () => true)).toEqual(["m", "a"]);
  });

  it("gives what a short list has, each channel once", () => {
    expect(multiviewChannels(["a", "b", "c"], "b", 4)).toEqual(["b", "a", "c"]);
    expect(multiviewChannels(["a"], "a", 4)).toEqual(["a"]);
    expect(multiviewChannels(["a", "b"], "z", 4)).toEqual([]);
  });
});

const STAGES: Record<string, Omit<MultiviewSpace, "gap">> = {
  appleTv: { width: 1920, height: 1080 },
  iPhonePortrait: { width: 393, height: 660 },
  iPhoneLandscape: { width: 852, height: 340 },
  iPadLandscape: { width: 1194, height: 760 },
  macWide: { width: 1800, height: 900 },
  macTall: { width: 900, height: 1500 },
};

const area = (rect: MultiviewRect) => rect.width * rect.height;
function overlaps(a: MultiviewRect, b: MultiviewRect): boolean {
  return a.x + 0.01 < b.x + b.width && b.x + 0.01 < a.x + a.width && a.y + 0.01 < b.y + b.height && b.y + 0.01 < a.y + a.height;
}

describe("multiviewSpots", () => {
  it("holds 4, 3, 4, 6, 6 and 7 spots, at most four of them live and first, and only the two big-spot layouts are featured", () => {
    expect(MULTIVIEW_LAYOUTS.map(multiviewSpotCount)).toEqual([4, 3, 4, 6, 6, 7]);
    expect(MULTIVIEW_LAYOUTS.map(multiviewLiveCount)).toEqual([4, 3, 4, 3, 4, 4]);
    for (const layout of MULTIVIEW_LAYOUTS) {
      const { spots } = multiviewCut(layout);
      const live = multiviewLiveCount(layout);
      expect(spots.slice(0, live).every((spot) => spot.live)).toBe(true);
      expect(spots.slice(live).every((spot) => !spot.live)).toBe(true);
    }
    expect(MULTIVIEW_LAYOUTS.filter(multiviewFeatured)).toEqual(["bigThree", "bigTwo"]);
  });

  for (const [name, stage] of Object.entries(STAGES)) {
    it(`${name}: every spot and the strip row is a whole 16:9 picture, together filling the largest 16:9 box the stage holds, none overlapping`, () => {
      const box = Math.min(stage.width, stage.height * MULTIVIEW_ASPECT);
      for (const layout of MULTIVIEW_LAYOUTS) {
        const placed = multiviewSpots(layout, { ...stage, gap: 0 });
        expect(placed.spots).toHaveLength(multiviewSpotCount(layout));
        for (const rect of placed.spots) expect(rect.width / rect.height).toBeCloseTo(MULTIVIEW_ASPECT, 5);
        const all = [...placed.spots, ...(placed.strip ? [placed.strip] : [])];
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j])).toBe(false);
        expect(all.reduce((sum, rect) => sum + area(rect), 0)).toBeCloseTo(box * (box / MULTIVIEW_ASPECT), 3);
        expect(Math.min(...all.map((rect) => rect.x))).toBeCloseTo((stage.width - box) / 2, 5);
        expect(Math.min(...all.map((rect) => rect.y))).toBe(0);
        if (placed.strip) expect(placed.strip.height * MULTIVIEW_ASPECT).toBeCloseTo(placed.cell, 5);
      }
    });
  }

  it("puts the strip in the bottom row of every layout but the 2x2 and the three halves", () => {
    const tv = { ...STAGES.appleTv, gap: 2 };
    expect(MULTIVIEW_LAYOUTS.filter((layout) => multiviewSpots(layout, tv).strip !== null)).toEqual(["bigThree", "bigTwo", "rowThree", "halvesTwo"]);
    const { strip } = multiviewSpots("bigThree", tv);
    expect(strip).toEqual({ x: 0, y: 810 + 1, width: 1920, height: 270 - 1 });
  });

  it("leaves a 2 pt line between spots that meet and none at the screen's edge", () => {
    const [a, b, c, d] = multiviewSpots("grid4", { width: 1920, height: 1080, gap: 2 }).spots;
    expect(a).toEqual({ x: 0, y: 0, width: 959, height: 539 });
    expect(b).toEqual({ x: 961, y: 0, width: 959, height: 539 });
    expect(c).toEqual({ x: 0, y: 541, width: 959, height: 539 });
    expect(d).toEqual({ x: 961, y: 541, width: 959, height: 539 });
  });

  it("lays the strip's cards on the grid's columns at rest, and keeps the line on both sides of those scrolled in after them", () => {
    const tv = { width: 1920, height: 1080, gap: 2 };
    const { spots, cell } = multiviewSpots("bigThree", tv);
    const cards = [0, 1, 2, 3, 4].map((index) => multiviewStripCard(index, 4, cell, 2));
    expect(cards[0]).toEqual({ x: 0, width: 479 });
    expect(cards[3]).toEqual({ x: spots[1].x, width: spots[1].width });
    expect(cards[3].x + cards[3].width).toBe(1920);
    expect(cards[4]).toEqual({ x: 1921, width: 478 });
  });

  it("gives nothing for an empty stage", () => {
    expect(multiviewSpots("grid4", { width: 0, height: 500, gap: 2 })).toEqual({ spots: [], strip: null, cell: 0 });
  });
});

describe("multiviewFit", () => {
  for (const [name, stage] of Object.entries(STAGES)) {
    it(`${name}: every spot is a whole 16:9 picture inside the screen, none overlapping, and the group never covers a spot`, () => {
      for (const layout of MULTIVIEW_LAYOUTS) {
        const { spots, group } = multiviewFit(layout, { ...stage, gap: 0 });
        expect(spots).toHaveLength(multiviewSpotCount(layout));
        for (const rect of spots) {
          expect(rect.width / rect.height).toBeCloseTo(MULTIVIEW_ASPECT, 5);
          expect(rect.x).toBeGreaterThanOrEqual(-0.001);
          expect(rect.x + rect.width).toBeLessThanOrEqual(stage.width + 0.001);
        }
        for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(overlaps(spots[i], spots[j])).toBe(false);
        const first = multiviewGroupCard(0, group, 0);
        const card = { ...first, x: group.x + first.x, y: group.y + first.y };
        expect(card.width / card.height).toBeCloseTo(MULTIVIEW_ASPECT, 5);
        for (const rect of spots) expect(overlaps(rect, card)).toBe(false);
      }
    });
  }

  it("keeps the 16:9 cut's places on a 16:9 screen, the group's first row where the strip row was", () => {
    const tv = { width: 1920, height: 1080, gap: 2 };
    for (const layout of MULTIVIEW_LAYOUTS) {
      const fit = multiviewFit(layout, tv);
      const placed = multiviewSpots(layout, tv);
      for (let i = 0; i < placed.spots.length; i++) {
        expect(fit.spots[i].x).toBeCloseTo(placed.spots[i].x, 5);
        expect(fit.spots[i].y).toBeCloseTo(placed.spots[i].y, 5);
        expect(fit.spots[i].width).toBeCloseTo(placed.spots[i].width, 5);
      }
      if (placed.strip) expect(fit.group.y).toBeCloseTo(placed.strip.y - 1, 5);
    }
  });

  it("on a screen taller than wide runs the big spots the full width, stacked, and the group below in rows", () => {
    const phone = { width: 393, height: 700, gap: 0 };
    const big = multiviewFit("bigThree", phone);
    expect(big.spots[0]).toMatchObject({ x: 0, y: 0, width: 393 });
    expect(big.spots.slice(1).map((rect) => rect.width)).toEqual([131, 131, 131]);
    expect(big.group).toMatchObject({ x: 0, columns: 3, width: 393, skip: { columns: 0, rows: 0 } });
    expect(big.group.y).toBeCloseTo(big.spots[1].y + big.spots[1].height, 5);
    const three = multiviewFit("rowThree", phone);
    expect(three.spots.slice(0, 3).map((rect) => rect.width)).toEqual([393, 393, 393]);
    expect(three.spots.slice(0, 3).map((rect) => rect.x)).toEqual([0, 0, 0]);
  });

  it("on a screen a little wider than the cut runs the group down the side of the spots and on in full rows under them, leaving no band", () => {
    const { spots, group } = multiviewFit("rowThree", { width: 2000, height: 742, gap: 0 });
    expect(group).toEqual({ x: 0, y: 0, width: 2000, columns: 4, skip: { columns: 3, rows: 2 } });
    expect(Math.max(...spots.map((rect) => rect.x + rect.width))).toBeCloseTo(1500, 5);
    const bottom = Math.max(...spots.map((rect) => rect.y + rect.height));
    const cards = [0, 1, 2, 5].map((index) => multiviewGroupCard(index, group, 0));
    expect(cards[0]).toMatchObject({ x: 1500, y: 0, width: 500 });
    expect(cards[1]).toMatchObject({ x: 1500, y: bottom / 2 });
    expect(cards[2]).toMatchObject({ x: 0, y: bottom });
    expect(cards[3].x + cards[3].width).toBeCloseTo(2000, 5);
    expect(multiviewGroupCount(group, 3)).toBe(6);
    expect(multiviewGroupRows(group, 6)).toBe(3);
    expect(multiviewGroupRows(group, 2)).toBe(2);
  });

  it("on iPhone turned sideways puts a column of cards beside the 2x2 and the next row just under it", () => {
    const { spots, group } = multiviewFit("grid4", { width: 734, height: 340, gap: 0 });
    expect(group).toMatchObject({ x: 0, y: 0, columns: 5, skip: { columns: 4, rows: 4 } });
    expect(Math.max(...spots.map((rect) => rect.x + rect.width)) + group.width / 5).toBeCloseTo(734, 5);
    expect(multiviewGroupCard(4, group, 0).y).toBeCloseTo(Math.max(...spots.map((rect) => rect.y + rect.height)), 5);
  });

  it("on a very wide window fills the height with the spots and the rest of the width with columns of cards, centred", () => {
    const { spots, group } = multiviewFit("grid4", { width: 3000, height: 600, gap: 0 });
    expect(Math.max(...spots.map((rect) => rect.y + rect.height))).toBeCloseTo(600, 5);
    expect(group.columns - group.skip.columns).toBe(7);
    expect(group.x).toBeCloseTo((3000 - group.width) / 2, 5);
    expect(Math.min(...spots.map((rect) => rect.x))).toBeCloseTo(group.x, 5);
  });

  it("keeps a 2 pt line between group cards and between the cards and the spots, and none at the screen's edge", () => {
    const group = multiviewFit("bigThree", { width: 1920, height: 1080, gap: 2 }).group;
    const [a, b] = [0, 1].map((index) => multiviewGroupCard(index, group, 2));
    expect(a).toEqual({ x: 0, y: 1, width: 479, height: 268 });
    expect(b.x - (a.x + a.width)).toBe(2);
    const fifth = multiviewGroupCard(4, group, 2);
    expect(fifth.y - (a.y + a.height)).toBe(2);
    expect(multiviewGroupCard(3, group, 2).x + multiviewGroupCard(3, group, 2).width).toBe(1920);
  });
});
