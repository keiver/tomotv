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
