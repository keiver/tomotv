import { cardSizeChoices, clampCardZoom, pinchedCardZoom, shownCardSize, steppedCardZoom } from "@/utils/cardZoom";

describe("card zoom", () => {
  it("offers every saved size on TV, and elsewhere only the sizes the window takes", () => {
    expect(cardSizeChoices(1, true)).toEqual([0.75, 1, 1.25, 1.5]);
    expect(cardSizeChoices(1, false)).toEqual([0.75, 1]);
    expect(cardSizeChoices(1.3, false)).toEqual([0.75, 1, 1.25]);
    expect(cardSizeChoices(2, false)).toEqual([0.75, 1, 1.25, 1.5]);
  });

  it("highlights the largest offered size at or under the saved zoom", () => {
    expect(shownCardSize(1.5, [0.75, 1, 1.25])).toBe(1.25);
    expect(shownCardSize(1.15, [0.75, 1, 1.25, 1.5])).toBe(1);
    expect(shownCardSize(1, [0.75, 1])).toBe(1);
    expect(shownCardSize(0.75, [0.75, 1, 1.25, 1.5])).toBe(0.75);
  });

  it("holds a stored zoom between three quarters and the window's ceiling", () => {
    expect(clampCardZoom(0.5, 1.8)).toBe(0.75);
    expect(clampCardZoom(1.2, 1.8)).toBe(1.2);
    expect(clampCardZoom(2.4, 1.8)).toBe(1.8);
    expect(clampCardZoom(1.4, 1)).toBe(1);
  });

  it("follows the fingers from the zoom the pinch started at, in steps of 0.05", () => {
    expect(pinchedCardZoom(1, 1.33, 2)).toBeCloseTo(1.35, 10);
    expect(pinchedCardZoom(1.2, 0.5, 2)).toBe(0.75);
    expect(pinchedCardZoom(1, 3, 1.6)).toBe(1.6);
    expect(pinchedCardZoom(1, 1.4, 1)).toBe(1);
  });

  it("steps one key press in or out by about 15 percent, within the same limits", () => {
    expect(steppedCardZoom(1, 1, 2)).toBeCloseTo(1.15, 10);
    expect(steppedCardZoom(1, -1, 2)).toBeCloseTo(0.85, 10);
    expect(steppedCardZoom(0.8, -1, 2)).toBe(0.75);
    expect(steppedCardZoom(1.9, 1, 2)).toBe(2);
  });
});
