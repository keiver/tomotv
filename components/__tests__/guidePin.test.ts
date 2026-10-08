import { Animated } from "react-native";
import { pinOffset, pinRightOffset, visibleSpan } from "@/components/live-tv/guide-pin";

/** The node's current value, as the props node reads it on a render. */
const valueOf = (node: Animated.AnimatedInterpolation<number>) => (node as unknown as { __getValue: () => number }).__getValue();

describe("pinOffset", () => {
  it("pins a label to the visible edge without pushing it out of its cell", () => {
    const scrollX = new Animated.Value(0);
    const labelWidth = new Animated.Value(120);
    const pin = pinOffset(scrollX, 100, 400, labelWidth);
    expect(valueOf(pin)).toBe(0);
    scrollX.setValue(250);
    expect(valueOf(pin)).toBe(150);
    scrollX.setValue(900);
    expect(valueOf(pin)).toBe(280);
  });

  it("never pins a label wider than its cell", () => {
    expect(valueOf(pinOffset(new Animated.Value(900), 100, 80, new Animated.Value(120)))).toBe(0);
  });

  it("follows a label width measured after the node is built", () => {
    const labelWidth = new Animated.Value(0);
    const pin = pinOffset(new Animated.Value(900), 100, 400, labelWidth);
    expect(valueOf(pin)).toBe(400);
    labelWidth.setValue(120);
    expect(valueOf(pin)).toBe(280);
  });
});

describe("visibleSpan", () => {
  const spanOf = (scrollX: number, left: number, width: number, viewportWidth: number) => {
    const { translateX, scaleX } = visibleSpan(new Animated.Value(scrollX), left, width, viewportWidth);
    const scale = valueOf(scaleX);
    // A 1pt body centred on the cell's left edge, slid to the span's middle and scaled to its width.
    return { from: valueOf(translateX) - scale / 2, width: scale };
  };

  it("covers a cell that fits on screen up to its right line, and only its part past the visible edge once it is cut", () => {
    expect(spanOf(0, 100, 400, 1000)).toEqual({ from: 0, width: 399 });
    expect(spanOf(250, 100, 400, 1000)).toEqual({ from: 150, width: 249 });
  });

  it("covers one screen of a cell wider than the screen, from its start until the view moves into it", () => {
    expect(spanOf(0, 100, 3000, 1000)).toEqual({ from: 0, width: 1000 });
    expect(spanOf(2500, 100, 3000, 1000)).toEqual({ from: 2400, width: 599 });
  });

  it("leaves a point inside the right line of a cell scrolled wholly past the edge, clear of the next cell's ring", () => {
    expect(spanOf(900, 100, 400, 1000)).toEqual({ from: 398, width: 1 });
    expect(spanOf(500, 100, 400, 1000)).toEqual({ from: 398, width: 1 });
  });
});

describe("pinRightOffset", () => {
  it("holds a right-anchored box on the visible right edge while the cell runs past it, and on the cell's edge once it is in view", () => {
    const scrollX = new Animated.Value(0);
    // A cell from 100 to 3100 seen through a 1000-wide viewport.
    const pin = pinRightOffset(scrollX, 100, 3000, 1000);
    expect(valueOf(pin)).toBe(-2100);
    scrollX.setValue(1500);
    expect(valueOf(pin)).toBe(-600);
    scrollX.setValue(2500);
    expect(valueOf(pin)).toBe(0);
  });
});
