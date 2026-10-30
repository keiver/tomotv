import { cardSizePicks, clampCardZoom, nearestCardSize, pinchedCardZoom, shownCardSize, steppedCardZoom } from "@/utils/cardZoom";

describe("card zoom", () => {
  it("offers the picks up to the window's ceiling", () => {
    expect(cardSizePicks(1)).toEqual([0.75, 0.85, 1]);
    expect(cardSizePicks(1.3)).toEqual([0.75, 0.85, 1, 1.15, 1.3]);
    expect(cardSizePicks(2)).toEqual([0.75, 0.85, 1, 1.15, 1.3, 1.5]);
  });

  it("chooses the pick nearest the drawn zoom", () => {
    expect(nearestCardSize(1.1, [0.75, 0.85, 1, 1.15, 1.3, 1.5])).toBe(1.15);
    expect(nearestCardSize(0.9, [0.75, 0.85, 1])).toBe(0.85);
    expect(nearestCardSize(1.6, [0.75, 0.85, 1, 1.15, 1.3, 1.5])).toBe(1.5);
  });

  it("lights the largest TV pill at or under the saved zoom", () => {
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
