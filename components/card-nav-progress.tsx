import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;

// Simulated trickle: an instant ack, easing toward ~90% while loading, then snapping to 100% on the
// focus handoff. Real "percent remaining" can't be measured for a folder open (fetch + paint).
const START = 0.08;
const TRICKLE_TARGET = 0.9;

interface CardNavProgressProps {
  active: boolean;
  /** Card title, shown difference-blended over the sweeping fill. */
  title: string;
  /** Where the sweep starts (0–1) — a resume card starts at its watched fraction. */
  startFraction?: number;
}

/**
 * "Navigation in progress" feedback for the pressed grid card: the same
 * title-bar-as-progress mechanism the Continue Watching cards use. While the
 * next screen loads, an opaque dark bar overlays the card's title sliver and a
 * gold fill sweeps across it, with the gold title difference-blending to black
 * wherever the fill passes under it. Metrics mirror the infoOverlay bar in
 * video-grid-item/folder-grid-item exactly, so it covers either seamlessly.
 *
 * Resume cards hand in their watched fraction as the sweep's starting point,
 * so the fill visually continues from the progress already on screen.
 *
 * Honors Reduce Motion (static fill, no trickle). Purely presentational: the
 * owning card drives `active` via useCardNavProgress (start on press, clear on
 * blur), and already announces its own state to assistive tech — this overlay
 * is hidden from it.
 */
export function CardNavProgress({ active, title, startFraction }: CardNavProgressProps) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (active) {
      const from = Math.max(START, Math.min(startFraction ?? 0, 1));
      opacity.value = 1;
      if (reducedMotion) {
        progress.value = TRICKLE_TARGET;
      } else {
        progress.value = from;
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
  }, [active, reducedMotion, startFraction, progress, opacity]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const barStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View pointerEvents="none" style={[styles.bar, barStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.fill, fillStyle]} />
      <View style={styles.titleBlend}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Mirrors the cards' infoOverlay title sliver exactly (position, padding,
  // radii, type metrics), opaque so it cleanly covers the bar beneath while
  // active. Opaque background also keeps the difference blend's inputs fixed.
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: IS_TV ? 10 : 6,
    paddingHorizontal: IS_TV ? 16 : 12,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  // Same minWidth rule as the resume fill: clear the rounded bottom-left
  // corner so the sweep's opening frames aren't clipped invisible.
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    minWidth: DESIGN.BORDER_RADIUS_CARD + (IS_TV ? 20 : 12),
    backgroundColor: COLORS.ACCENT,
  },
  titleBlend: {
    width: "100%",
    mixBlendMode: "difference",
  },
  // Gold through the difference blend: black over the fill, gold over the dark
  // remainder — identical treatment to the Continue Watching title bar.
  title: {
    color: COLORS.ACCENT,
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
});
