import { Animated } from "react-native";
import { pinOffset, pinRightOffset } from "@/components/live-tv/guide-pin";

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
