import { keepMultiviewOrder, MULTIVIEW_ASPECT, MULTIVIEW_MAX_TILES, multiviewCapacity, multiviewChannels, multiviewLayout, type MultiviewRect, type MultiviewSpace } from "../src/multiviewLayout";

describe("multiviewChannels", () => {
  const list = Array.from({ length: 20 }, (_, i) => `c${i + 90}`);

  it("puts the chosen channel first, then the channels around it in list order, half before and the rest after", () => {
    expect(multiviewChannels(list, "c101", 8)).toEqual(["c101", "c98", "c99", "c100", "c102", "c103", "c104", "c105"]);
  });

  it("wraps at the ends of the list", () => {
    expect(multiviewChannels(list, "c90", 5)).toEqual(["c90", "c108", "c109", "c91", "c92"]);
  });

  it("passes over the channels it is told to skip, and keeps the count", () => {
    const skip = (id: string) => id === "c100" || id === "c102";
    expect(multiviewChannels(list, "c101", 5, skip)).toEqual(["c101", "c98", "c99", "c103", "c104"]);
  });

  it("keeps the tiles on screen in place when one drops out, and fills the end from the fresh list", () => {
    expect(keepMultiviewOrder(["m", "a", "b", "c"], ["m", "x", "a", "b", "c", "d"], 4, (id) => id !== "b")).toEqual(["m", "a", "c", "x"]);
    expect(keepMultiviewOrder(["b", "m", "a"], ["m", "a", "z"], 3, () => true)).toEqual(["b", "m", "a"]);
    expect(keepMultiviewOrder(["m", "a", "b"], ["m", "a"], 2, () => true)).toEqual(["m", "a"]);
  });

  it("gives what a short list has, each channel once", () => {
    expect(multiviewChannels(["a", "b", "c"], "b", 8)).toEqual(["b", "a", "c"]);
    expect(multiviewChannels(["a"], "a", 8)).toEqual(["a"]);
    expect(multiviewChannels(["a", "b"], "z", 8)).toEqual([]);
  });
});

const SPACES: Record<string, MultiviewSpace> = {
  appleTv: { width: 1920, height: 1080, minTileWidth: 384, gap: 24 },
  iPhonePortrait: { width: 393, height: 852, minTileWidth: 160, gap: 8 },
  iPhoneLandscape: { width: 852, height: 393, minTileWidth: 160, gap: 8 },
  iPadLandscape: { width: 1194, height: 834, minTileWidth: 160, gap: 12 },
  iPadPortrait: { width: 834, height: 1194, minTileWidth: 160, gap: 12 },
  macWindow: { width: 1512, height: 900, minTileWidth: 160, gap: 12 },
};

const EPSILON = 0.5;

function overlaps(a: MultiviewRect, b: MultiviewRect): boolean {
  return a.x + EPSILON < b.x + b.width && b.x + EPSILON < a.x + a.width && a.y + EPSILON < b.y + b.height && b.y + EPSILON < a.y + a.height;
}

describe("multiviewLayout", () => {
  it("fills the window with one tile at 16:9", () => {
    expect(multiviewLayout(1, SPACES.appleTv)).toEqual([{ x: 0, y: 0, width: 1920, height: 1080 }]);
  });

  it("returns null for zero tiles, more than the maximum, or an empty window", () => {
    expect(multiviewLayout(0, SPACES.appleTv)).toBeNull();
    expect(multiviewLayout(MULTIVIEW_MAX_TILES + 1, SPACES.macWindow)).toBeNull();
    expect(multiviewLayout(2, { ...SPACES.appleTv, width: 0 })).toBeNull();
  });

  for (const [name, space] of Object.entries(SPACES)) {
    it(`${name}: every count up to its capacity gives one rect per tile inside the window, none overlapping, the main the widest`, () => {
      const capacity = multiviewCapacity(space);
      expect(capacity).toBeGreaterThan(1);
      for (let count = 2; count <= capacity; count++) {
        const rects = multiviewLayout(count, space)!;
        expect(rects).toHaveLength(count);
        const [main, ...satellites] = rects;
        for (const rect of rects) {
          expect(rect.x).toBeGreaterThanOrEqual(-EPSILON);
          expect(rect.y).toBeGreaterThanOrEqual(-EPSILON);
          expect(rect.x + rect.width).toBeLessThanOrEqual(space.width + EPSILON);
          expect(rect.y + rect.height).toBeLessThanOrEqual(space.height + EPSILON);
        }
        for (const satellite of satellites) {
          expect(satellite.width).toBeGreaterThanOrEqual(space.minTileWidth - EPSILON);
          expect(satellite.width).toBeLessThanOrEqual(main.width / 2 + EPSILON);
          expect(satellite.height).toBeCloseTo(satellite.width / MULTIVIEW_ASPECT, 5);
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    });
  }

  it("gives the same rects for the same input", () => {
    expect(multiviewLayout(6, SPACES.iPadLandscape)).toEqual(multiviewLayout(6, SPACES.iPadLandscape));
  });

  it("on Apple TV places 2 to 4 tiles as a main with a column of 3 satellite slots beside it", () => {
    const rects = multiviewLayout(4, SPACES.appleTv)!;
    expect(Math.round(rects[0].width)).toBe(1443);
    expect(rects.slice(1).every((rect) => rect.x > rects[0].x + rects[0].width)).toBe(true);
    expect(multiviewLayout(2, SPACES.appleTv)![0]).toEqual(rects[0]);
  });
});

describe("multiviewCapacity", () => {
  it("fits 8 tiles on a 1920x1080 Apple TV screen with 384 pt satellites, and 9 do not fit", () => {
    expect(multiviewCapacity(SPACES.appleTv)).toBe(8);
    expect(multiviewLayout(9, SPACES.appleTv)).toBeNull();
  });

  it("is 1 when no satellite can reach the minimum width", () => {
    expect(multiviewCapacity({ width: 300, height: 200, minTileWidth: 160, gap: 8 })).toBe(1);
  });

  it("follows the window: a narrower Mac window holds fewer tiles", () => {
    expect(multiviewCapacity({ ...SPACES.macWindow, width: 700, height: 500 })).toBeLessThan(multiviewCapacity(SPACES.macWindow));
  });
});
