import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/** One revolution. Slow enough to read as a record rather than a loading spinner. */
const TURN_MS = 3200;

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
 * The grooves are what make it read as a disc at this size, and they are also what make the
 * rotation visible — a plain ring turning looks static.
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

  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.MEDIA_BACKGROUND, borderWidth: 1.5, borderColor: color }} />
      <View style={groove(size * 0.16)} />
      {/* The one asymmetric mark, and the only reason the turning is visible at all: concentric
          rings and a centred label look identical at every angle. Reads as the light catching
          the grooves. */}
      <View
        style={{
          position: "absolute",
          top: size / 2 - 0.5,
          left: size / 2,
          width: size / 2 - 1,
          height: 1,
          backgroundColor: color,
          opacity: 0.75,
        }}
      />
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
  );
}
