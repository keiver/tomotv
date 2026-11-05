import {
  keepMultiviewOrder,
  MULTIVIEW_LAYOUTS,
  multiviewChannels,
  multiviewFeatured,
  multiviewSpotCount,
  multiviewSpots,
  multiviewSpotsBottom,
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

const STAGES: Record<string, MultiviewSpace> = {
  appleTv: { width: 1920, height: 878, gap: 2 },
  iPhonePortrait: { width: 393, height: 660, gap: 2 },
  iPhoneLandscape: { width: 852, height: 270, gap: 2 },
  iPadLandscape: { width: 1194, height: 700, gap: 2 },
  iPadPortrait: { width: 834, height: 1000, gap: 2 },
  macWide: { width: 1800, height: 900, gap: 2 },
  macTall: { width: 900, height: 1500, gap: 2 },
};

const EPSILON = 0.5;

function overlaps(a: MultiviewRect, b: MultiviewRect): boolean {
  return a.x + EPSILON < b.x + b.width && b.x + EPSILON < a.x + a.width && a.y + EPSILON < b.y + b.height && b.y + EPSILON < a.y + a.height;
}

describe("multiviewSpots", () => {
  it("holds 2, 2, 3, 4 and 4 spots, and only the equal layouts have no big spot", () => {
    expect(MULTIVIEW_LAYOUTS.map(multiviewSpotCount)).toEqual([2, 2, 3, 4, 4]);
    expect(MULTIVIEW_LAYOUTS.filter(multiviewFeatured)).toEqual(["twoFeatured", "onePlusTwo", "onePlusThree"]);
  });

  for (const [name, stage] of Object.entries(STAGES)) {
    it(`${name}: every layout fills the stage edge to edge, spots split by the line alone, none overlapping, the big spot the largest`, () => {
      for (const layout of MULTIVIEW_LAYOUTS) {
        const rects = multiviewSpots(layout, stage);
        expect(rects).toHaveLength(multiviewSpotCount(layout));
        expect(Math.min(...rects.map((rect) => rect.x))).toBe(0);
        expect(Math.min(...rects.map((rect) => rect.y))).toBe(0);
        expect(Math.max(...rects.map((rect) => rect.x + rect.width))).toBeCloseTo(stage.width, 5);
        expect(Math.max(...rects.map((rect) => rect.y + rect.height))).toBeCloseTo(stage.height, 5);
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
        // Every point of the stage is in a spot or on a line beside one.
        const reach = stage.gap / 2 + EPSILON;
        for (let px = 0.5; px < stage.width; px += stage.width / 40)
          for (let py = 0.5; py < stage.height; py += stage.height / 40)
            expect(rects.some((rect) => px >= rect.x - reach && px <= rect.x + rect.width + reach && py >= rect.y - reach && py <= rect.y + rect.height + reach)).toBe(true);
        const area = (rect: MultiviewRect) => rect.width * rect.height;
        if (multiviewFeatured(layout)) for (const rect of rects.slice(1)) expect(area(rects[0])).toBeGreaterThan(area(rect) * 2);
      }
    });
  }

  it("leaves a 2 pt line between spots that meet, and none at the stage's edge", () => {
    const [a, b] = multiviewSpots("two", { width: 1000, height: 281, gap: 2 });
    expect(a).toEqual({ x: 0, y: 0, width: 499, height: 281 });
    expect(b).toEqual({ x: 501, y: 0, width: 499, height: 281 });
  });

  it("puts the satellites beside the big spot on a wide stage and under it on a tall one", () => {
    const wide = multiviewSpots("onePlusThree", STAGES.appleTv);
    expect(wide.slice(1).every((rect) => rect.x > wide[0].x + wide[0].width)).toBe(true);
    const tall = multiviewSpots("onePlusThree", STAGES.iPhonePortrait);
    expect(tall.slice(1).every((rect) => rect.y > tall[0].y + tall[0].height)).toBe(true);
  });

  it("stacks a tall window's 2x2 into one column, where a 2x2 would cut its pictures more", () => {
    const grid = multiviewSpots("grid4", STAGES.macTall);
    expect(new Set(grid.map((rect) => Math.round(rect.x))).size).toBe(1);
  });

  it("gives nothing for an empty stage, and the bottom edge the strip starts under", () => {
    expect(multiviewSpots("two", { width: 0, height: 500, gap: 2 })).toEqual([]);
    const rects = multiviewSpots("two", STAGES.iPhonePortrait);
    expect(multiviewSpotsBottom(rects, 2)).toBeCloseTo(STAGES.iPhonePortrait.height + 1, 5);
  });
});
