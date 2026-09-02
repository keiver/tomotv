import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

// Sweeping segment width as a fraction of the track, in percent.
const SEGMENT = 35;
// The slideshow countdown pill's metrics, so every wait in the app is the same object.
const PILL_WIDTH = 240;
const PILL_HEIGHT = 8;
const PILL_INSET = 2;

interface LoadingBarProps {
  /** Spoken while the bar is up. Nothing is drawn as text; omit where the surrounding view announces the wait itself. */
  label?: string;
  /** False fades the bar out in place instead of unmounting it. */
  active?: boolean;
  /** "pill" centers a rounded track in its parent, "edge" is a flush strip on the parent's bottom edge. */
  variant?: "pill" | "edge";
  style?: StyleProp<ViewStyle>;
}

/**
 * Indeterminate gold sweep: the app's one "this is working" mark, in the same gold-on-dark
 * language as the slideshow countdown and CardNavProgress. A fetch has no measurable progress,
 * so the segment loops. Honors Reduce Motion with a static fill.
 */
export function LoadingBar({ label, active = true, variant = "pill", style }: LoadingBarProps) {
  const sweep = useSharedValue(0);
  const opacity = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (active) {
      opacity.value = withTiming(1, { duration: 120 });
      if (!reducedMotion) {
        sweep.value = 0;
        sweep.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }), -1);
      }
    } else {
      cancelAnimation(sweep);
      opacity.value = withTiming(0, { duration: 200 });
    }
    return () => cancelAnimation(sweep);
  }, [active, reducedMotion, sweep, opacity]);

  const trackStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // The segment enters fully off-track left and exits fully off-track right.
  const fillStyle = useAnimatedStyle(() => ({ left: `${-SEGMENT + sweep.value * (100 + SEGMENT)}%` }));
  const pill = variant === "pill";

  return (
    <Animated.View
      pointerEvents="none"
      style={[pill ? styles.pillTrack : styles.edgeTrack, style, trackStyle]}
      accessible={!!label}
      accessibilityRole={label ? "progressbar" : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}>
      <Animated.View style={[styles.fill, pill && styles.pillFill, reducedMotion ? styles.fillStatic : fillStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Clipped ends: the sweep is drawn past both edges and the radius cuts it into a capsule.
  pillTrack: {
    alignSelf: "center",
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    backgroundColor: COLORS.SURFACE_MUTED,
    overflow: "hidden",
  },
  // Bottom edge of a field's rounded card; the host's overflow clips the strip to the corners.
  edgeTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.isTV ? 4 : 3,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: `${SEGMENT}%`,
    backgroundColor: COLORS.ACCENT,
  },
  pillFill: {
    top: PILL_INSET,
    bottom: PILL_INSET,
    borderRadius: PILL_INSET,
  },
  fillStatic: {
    left: 0,
    width: "100%",
  },
});
