import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/** One revolution. Slow enough to read as a record rather than a loading spinner. */
const TURN_MS = 3200;
/** Stroke shared by the disc's rim and the two marks, so they read as one drawing. */
const STROKE = 1.5;

interface SpinningDiscProps {
  size: number;
  /** Turns while true, holds its angle while false. */
  spinning: boolean;
  color?: string;
}

/**
 * A record, drawn with concentric views: the project carries no SVG, and adding one for a
 * shape made of circles would be a dependency and a prebuild for nothing.
 *
 * The two radial marks are what make the rotation visible at all — concentric rings and a
 * centred label look identical at every angle.
 */
export function SpinningDisc({ size, spinning, color = COLORS.ACCENT }: SpinningDiscProps) {
  const angle = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!spinning || reducedMotion) {
      // Left where it stopped rather than snapped to zero, the way a record does.
      cancelAnimation(angle);
      return;
    }
    angle.set(withRepeat(withTiming(angle.get() + 360, { duration: TURN_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(angle);
  }, [spinning, reducedMotion, angle]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));

  const groove = (inset: number) => ({
    position: "absolute" as const,
    top: inset,
    left: inset,
    width: size - inset * 2,
    height: size - inset * 2,
    borderRadius: (size - inset * 2) / 2,
    borderWidth: 1,
    borderColor: color,
    opacity: 0.55,
  });

  const label = size * 0.34;
  const hole = Math.max(2, size * 0.1);

  // The two marks run from the label out to just inside the rim, one above centre and one
  // below, so they read as a pair of lines rather than one bar crossing the record.
  const markInner = label / 2;
  const markLength = Math.max(1, size / 2 - STROKE - markInner);
  const mark = (above: boolean) => ({
    position: "absolute" as const,
    left: (size - STROKE) / 2,
    top: above ? size / 2 - markInner - markLength : size / 2 + markInner,
    width: STROKE,
    height: markLength,
    backgroundColor: color,
  });

  return (
    <>
      <Animated.View style={[{ width: size, height: size }, style]}>
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.MEDIA_BACKGROUND, borderWidth: STROKE, borderColor: color }} />
        <View style={groove(size * 0.16)} />
        <View style={mark(true)} />
        <View style={mark(false)} />
        <View
          style={{
            position: "absolute",
            top: (size - label) / 2,
            left: (size - label) / 2,
            width: label,
            height: label,
            borderRadius: label / 2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: (size - hole) / 2,
            left: (size - hole) / 2,
            width: hole,
            height: hole,
            borderRadius: hole / 2,
            backgroundColor: COLORS.MEDIA_BACKGROUND,
          }}
        />
      </Animated.View>
    </>
  );
}
