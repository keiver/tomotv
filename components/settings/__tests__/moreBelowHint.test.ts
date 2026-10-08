import { hasMoreBelow, lastVisibleRow } from "@/components/settings/MoreBelowHint";

describe("lastVisibleRow", () => {
  it("is the last whole row in the window at rest", () => {
    expect(lastVisibleRow(0, 300, 100)).toBe(2);
  });

  it("follows the scroll offset", () => {
    expect(lastVisibleRow(200, 300, 100)).toBe(4);
  });

  it("absorbs sub-point offset drift", () => {
    expect(lastVisibleRow(99.6, 300, 100)).toBe(3);
  });
});

describe("hasMoreBelow", () => {
  it("is false before the cap is measured", () => {
    expect(hasMoreBelow(0, undefined, 300)).toBe(false);
  });

  it("is true while rows sit below the window", () => {
    expect(hasMoreBelow(0, 200, 300)).toBe(true);
    expect(hasMoreBelow(50, 200, 300)).toBe(true);
  });

  it("is false at the end, within a point of rounding", () => {
    expect(hasMoreBelow(100, 200, 300)).toBe(false);
    expect(hasMoreBelow(99.5, 200, 300)).toBe(false);
  });

  it("is false when everything fits", () => {
    expect(hasMoreBelow(0, 300, 300)).toBe(false);
  });
});
