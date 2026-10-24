import { useCardPalette } from "@/hooks/useCardPalette";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Easing, type LayoutChangeEvent, Platform, StyleSheet, useAnimatedValue } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

// Sweeping segment width as a fraction of the track.
const SEGMENT = 0.35;

interface SearchLoadingBarProps {
  active: boolean;
}

/**
 * Indeterminate accent sweep pinned to the bottom edge of the search field while a
 * query is in flight. Same accent-on-dark language as CardNavProgress and
 * FolderLoadingBar, but looping: a search has no measurable progress to trickle
 * toward. Honors Reduce Motion (static full-width fill, no sweep). Purely
 * presentational and hidden from assistive tech; the results list announces its
 * own loading state.
 */
export function SearchLoadingBar({ active }: SearchLoadingBarProps) {
  const sweep = useAnimatedValue(0);
  const opacity = useAnimatedValue(0);
  const reducedMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width), []);

  useEffect(() => {
    if (!active) {
      const fade = Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true });
      fade.start();
      return () => fade.stop();
    }
    const fade = Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true });
    fade.start();
    if (reducedMotion) return () => fade.stop();
    sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }));
    loop.start();
    return () => {
      fade.stop();
      loop.stop();
    };
  }, [active, reducedMotion, sweep, opacity]);

  // The segment enters fully off-track left and exits fully off-track right.
  const translateX = useMemo(() => sweep.interpolate({ inputRange: [0, 1], outputRange: [-SEGMENT * trackWidth, trackWidth] }), [sweep, trackWidth]);

  const { accent } = useCardPalette();

  return (
    <Animated.View pointerEvents="none" onLayout={onLayout} style={[styles.track, { opacity }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.fill, { backgroundColor: accent }, reducedMotion ? styles.fillStatic : { transform: [{ translateX }] }]} />
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
    left: 0,
    width: `${SEGMENT * 100}%`,
  },
  fillStatic: {
    width: "100%",
  },
});
