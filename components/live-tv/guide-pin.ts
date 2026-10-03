import { Animated } from "react-native";

type Node = Animated.Value | Animated.AnimatedInterpolation<number>;

/** max(0, x) on the native driver: identity above zero, clamped below it. */
const floorAtZero = (node: Animated.AnimatedInterpolation<number>) => node.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp", extrapolateRight: "extend" });

/**
 * How far a cell's content slides to stay on the grid's visible left edge: clamp(scrollX - left, 0,
 * width - contentWidth). Native nodes, so the pin moves inside the grid's own scroll event.
 */
export function pinOffset(scrollX: Node, left: number, width: number, contentWidth: Node): Animated.AnimatedInterpolation<number> {
  const pinned = floorAtZero(Animated.subtract(scrollX, new Animated.Value(left)));
  const room = floorAtZero(Animated.subtract(new Animated.Value(width), contentWidth));
  // min(pinned, room) = pinned - max(0, pinned - room)
  return Animated.subtract(pinned, floorAtZero(Animated.subtract(pinned, room)));
}

/**
 * A cell's stretch on screen, for a 1pt body centred on the cell's left edge: from the visible edge (or the
 * cell's start) to its end, at most a screen wide, a point at the far end once the cell has scrolled past.
 */
export function visibleSpan(scrollX: Node, left: number, width: number, viewportWidth: number): { translateX: Animated.AnimatedInterpolation<number>; scaleX: Animated.AnimatedInterpolation<number> } {
  const pinned = floorAtZero(Animated.subtract(scrollX, new Animated.Value(left)));
  // min(pinned, width - 1), then min(width - start, viewportWidth): each min(a, b) = a - max(0, a - b).
  const start = Animated.subtract(pinned, floorAtZero(Animated.subtract(pinned, new Animated.Value(width - 1))));
  const shown = Animated.subtract(new Animated.Value(width), start);
  const span = Animated.subtract(shown, floorAtZero(Animated.subtract(shown, new Animated.Value(viewportWidth))));
  return { translateX: Animated.add(start, Animated.multiply(span, 0.5)), scaleX: span };
}

/**
 * How far a box anchored to a cell's right edge slides left to stay on the grid's visible right
 * edge: min(0, scrollX + viewportWidth - (left + width)).
 */
export function pinRightOffset(scrollX: Node, left: number, width: number, viewportWidth: number): Animated.AnimatedInterpolation<number> {
  const overhang = floorAtZero(Animated.subtract(new Animated.Value(left + width - viewportWidth), scrollX));
  return Animated.subtract(new Animated.Value(0), overhang);
}
