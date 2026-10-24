import { useEffect, useMemo } from "react";
import { Animated, Easing, StyleSheet, useAnimatedValue } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

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
  const turn = useAnimatedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, turn]);

  const rotate = useMemo(() => turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }), [turn]);

  // Insets of -width sit the arc on the parent's border, which absolute children otherwise start inside.
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.arc,
        { borderWidth: width, borderRadius: radius, borderTopColor: color, borderRightColor: color, top: -width, right: -width, bottom: -width, left: -width },
        { transform: [{ rotate }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  arc: {
    position: "absolute",
    borderColor: "transparent",
  },
});
