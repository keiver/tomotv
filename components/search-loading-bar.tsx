import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

// Sweeping segment width as a fraction of the track, in percent.
const SEGMENT = 35;

interface SearchLoadingBarProps {
  active: boolean;
}

/**
 * Indeterminate gold sweep pinned to the bottom edge of the search field while a
 * query is in flight. Same gold-on-dark language as CardNavProgress and
 * FolderLoadingBar, but looping — a search has no measurable progress to trickle
 * toward. Honors Reduce Motion (static full-width fill, no sweep). Purely
 * presentational and hidden from assistive tech; the results list announces its
 * own loading state.
 */
export function SearchLoadingBar({ active }: SearchLoadingBarProps) {
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

  return (
    <Animated.View pointerEvents="none" style={[styles.track, trackStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.fill, reducedMotion ? styles.fillStatic : fillStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Bottom edge of the search field's rounded card; the wrapper's overflow:
  // hidden clips the strip's ends to the corner radius.
  track: {
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
  fillStatic: {
    left: 0,
    width: "100%",
  },
});
