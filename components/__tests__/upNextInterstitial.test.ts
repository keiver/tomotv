import { countdownRemainingMs, upNextLayout } from "@/components/up-next-interstitial";

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const COLUMN_AND_CHROME = 280 + 28 + 16 * 2;

describe("countdownRemainingMs", () => {
  it("has the whole clock left before it starts", () => {
    expect(countdownRemainingMs(0)).toBe(5000);
  });

  it("has the unspent share left when paused midway", () => {
    expect(countdownRemainingMs(0.4)).toBe(3000);
  });

  it("has nothing left once the clock has run out", () => {
    expect(countdownRemainingMs(1)).toBe(0);
  });

  it("stays inside the clock for an out-of-range progress", () => {
    expect(countdownRemainingMs(1.2)).toBe(0);
    expect(countdownRemainingMs(-0.5)).toBe(5000);
  });
});

describe("upNextLayout", () => {
  it("keeps the stack on a portrait phone", () => {
    expect(upNextLayout({ width: 393, height: 852 }, { top: 59, right: 0, bottom: 34, left: 0 }, 16 / 9)).toEqual({ sideBySide: false, posterHeight: 220 });
  });

  it("keeps the stack on a landscape tablet", () => {
    expect(upNextLayout({ width: 1180, height: 820 }, { top: 24, right: 0, bottom: 20, left: 0 }, 16 / 9).sideBySide).toBe(false);
  });

  it("seats the poster beside the text on a landscape phone", () => {
    const insets = { top: 0, right: 59, bottom: 21, left: 59 };
    expect(upNextLayout({ width: 852, height: 393 }, insets, 16 / 9)).toEqual({ sideBySide: true, posterHeight: 220 });
  });

  it("shrinks a wide thumbnail until poster and column fit the width", () => {
    const window = { width: 667, height: 375 };
    const { sideBySide, posterHeight } = upNextLayout(window, NO_INSETS, 16 / 9);
    expect(sideBySide).toBe(true);
    expect(posterHeight).toBe(183);
    expect(posterHeight * (16 / 9) + COLUMN_AND_CHROME).toBeLessThanOrEqual(window.width);
  });

  it("leaves a portrait poster at full height when the width allows it", () => {
    expect(upNextLayout({ width: 667, height: 375 }, NO_INSETS, 2 / 3).posterHeight).toBe(220);
  });

  it("caps the poster to the frame height", () => {
    expect(upNextLayout({ width: 900, height: 200 }, NO_INSETS, 2 / 3).posterHeight).toBe(168);
  });

  it("never returns a negative height when the column fills the width", () => {
    expect(upNextLayout({ width: 300, height: 300 }, NO_INSETS, 16 / 9).posterHeight).toBe(0);
  });
});
