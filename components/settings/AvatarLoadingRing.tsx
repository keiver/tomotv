import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

interface AvatarLoadingRingProps {
  /** Stroke of the resting ring it sits on. */
  width: number;
  /** Outer radius of that ring. */
  radius: number;
  /** The arc's ink: gold on a dark surface, the bar's ink on the gold panel. */
  color: string;
}

/** A half-arc turning in an avatar's ring slot while that account connects. */
export function AvatarLoadingRing({ width, radius, color }: AvatarLoadingRingProps) {
  const turn = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    turn.value = 0;
    turn.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [reducedMotion, turn]);

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));

  // Insets of -width sit the arc on the parent's border, which absolute children otherwise start inside.
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.arc, { borderWidth: width, borderRadius: radius, borderTopColor: color, borderRightColor: color, top: -width, right: -width, bottom: -width, left: -width }, spin]}
    />
  );
}

const styles = StyleSheet.create({
  arc: {
    position: "absolute",
    borderColor: "transparent",
  },
});
