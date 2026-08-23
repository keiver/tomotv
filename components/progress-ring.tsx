import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/**
 * Rotations that show `fraction` of a ring, clockwise from twelve o'clock.
 *
 * Angles are measured clockwise from twelve. A circular view's border sides meet on the
 * diagonals, so two adjacent sides (top and right) draw one 180-degree arc spanning -45 to
 * 135 at rest. Each clip window shows one half of the circle, and its arc starts rotated onto
 * the other half where the clip hides it: the right half fills over the first 50%, the left
 * over the second.
 *
 * Right window is 0 to 180: hidden at arc [180,360] (rotation 225), full at [0,180] (405,
 * reached going clockwise so the fill sweeps down from twelve rather than up from six).
 * Left window is 180 to 360: hidden at [0,180] (rotation 45), full at [180,360] (225).
 *
 * Exported and pure so the geometry can be checked without rendering anything.
 */
export function ringRotations(fraction: number): { right: number; left: number } {
  const filled = Math.min(1, Math.max(0, fraction));
  return {
    right: 225 + 360 * Math.min(filled, 0.5),
    left: 45 + 360 * Math.max(0, filled - 0.5),
  };
}

/** One turn of the indeterminate ring. */
const SPIN_MS = 900;

interface ProgressRingProps {
  /** 0 to 1. Values outside are clamped. Ignored while `indeterminate`. */
  fraction: number;
  size: number;
  thickness: number;
  color: string;
  /** The unfilled remainder. Omit for no track. */
  trackColor?: string;
  /**
   * Nothing measurable yet: a quarter arc turns instead. A determinate ring frozen at zero is
   * indistinguishable from a broken one, which is what queued transfers looked like.
   */
  indeterminate?: boolean;
  /** How long the fill takes to catch up with a new fraction. */
  durationMs?: number;
}

/**
 * A circular progress ring, drawn with views because the project carries no SVG.
 *
 * Meant to sit BEHIND whatever it measures rather than over it: on tvOS an absolutely
 * positioned view above a focusable occludes the focus engine, and pointerEvents cannot opt
 * out of that.
 */
export function ProgressRing({ fraction, size, thickness, color, trackColor, indeterminate = false, durationMs = 400 }: ProgressRingProps) {
  const filled = useSharedValue(0);
  const spin = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const target = Math.min(1, Math.max(0, fraction));
    filled.set(reducedMotion ? target : withTiming(target, { duration: durationMs }));
  }, [fraction, durationMs, filled, reducedMotion]);

  useEffect(() => {
    if (!indeterminate || reducedMotion) {
      cancelAnimation(spin);
      spin.set(0);
      return;
    }
    spin.set(0);
    spin.set(withRepeat(withTiming(360, { duration: SPIN_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(spin);
  }, [indeterminate, reducedMotion, spin]);

  const rightStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${ringRotations(filled.get()).right}deg` }] }));
  const leftStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${ringRotations(filled.get()).left}deg` }] }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));

  const circle = {
    position: "absolute" as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: thickness,
  };
  // Two adjacent sides: the 180-degree arc each clip window reveals a slice of.
  const arc = { ...circle, borderTopColor: color, borderRightColor: color, borderBottomColor: "transparent", borderLeftColor: "transparent" };

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {!!trackColor && <View style={[circle, { borderColor: trackColor }]} />}
      {indeterminate ? (
        // One side only, so the turning is visible: a symmetric arc would look static.
        <Animated.View style={[circle, { borderTopColor: color, borderRightColor: "transparent", borderBottomColor: "transparent", borderLeftColor: "transparent" }, spinStyle]} />
      ) : (
        <>
          <View style={[styles.clip, { right: 0, width: size / 2, height: size }]}>
            <Animated.View style={[arc, { right: 0 }, rightStyle]} />
          </View>
          <View style={[styles.clip, { left: 0, width: size / 2, height: size }]}>
            <Animated.View style={[arc, { left: 0 }, leftStyle]} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
});
