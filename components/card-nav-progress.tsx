import React, { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;

// Simulated trickle: an instant ack, easing toward ~90% while loading, then snapping to 100% on the
// focus handoff. Real "percent remaining" can't be measured for a folder open (fetch + paint).
const START = 0.08;
const TRICKLE_TARGET = 0.9;

/**
 * Thin "navigation in progress" bar for the pressed grid card, shown while the next screen loads.
 * Sits at the card's bottom edge (the title area). The card is always focused while navigating and
 * its title bar is gold, so the fill is black with a red leading tip for depth — mirrors the focused
 * resume bar in video-grid-item. Honors Reduce Motion (static, no trickle). Purely presentational:
 * the owning card drives `active` via useCardNavProgress (start on press, clear on blur).
 */
export function CardNavProgress({ active }: { active: boolean }) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (active) {
      opacity.value = 1;
      if (reducedMotion) {
        progress.value = TRICKLE_TARGET;
      } else {
        progress.value = START;
        progress.value = withTiming(TRICKLE_TARGET, { duration: 900, easing: Easing.out(Easing.cubic) });
      }
    } else if (reducedMotion) {
      opacity.value = 0;
      progress.value = 0;
    } else {
      // Handoff: complete then fade (the card is usually covered by the destination by now).
      progress.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [active, reducedMotion, progress, opacity]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const trackStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View pointerEvents="none" style={[styles.track, trackStyle]}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: IS_TV ? 6 : 4,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#000000",
    // Red leading tip for depth.
    borderRightWidth: 3,
    borderRightColor: "#FF3B30",
  },
});
