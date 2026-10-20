import { Easing } from "react-native";

const ease = Easing.inOut(Easing.quad);

/**
 * Interpolation stops for one there-and-back swing over a 0 to 1 phase: `from` to `to` by the
 * middle, back to `from` at the end, eased in and out on each half. A phase looped by a single
 * native timing then drives the whole swing without JS between cycles.
 */
export function swingStops(from: number, to: number, steps = 16): { inputRange: number[]; outputRange: number[] } {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    inputRange.push(t);
    outputRange.push(from + (to - from) * ease(t <= 0.5 ? t * 2 : (1 - t) * 2));
  }
  return { inputRange, outputRange };
}
