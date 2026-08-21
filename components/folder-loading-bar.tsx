import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MarqueeText } from "./MarqueeText";

const IS_TV = Platform.isTV;

// Simulated trickle: an instant ack, easing toward ~90% while the folder loads, then snapping to
// 100% and fading out when the content lands. Real "percent remaining" can't be measured for a
// folder open (fetch + paint) — same mechanism as CardNavProgress.
const START = 0.08;
const TRICKLE_TARGET = 0.9;

interface FolderLoadingBarProps {
  active: boolean;
  /** Folder name, shown difference-blended over the sweeping fill. */
  title: string;
}

/**
 * Screen-level loading indicator for a folder that is fetching its first page: a full-bleed bar
 * pinned to the bottom of the screen in the signature card-title treatment — opaque dark bar, gold
 * fill sweeping across it. On TV the gold folder name difference-blends to black wherever the fill
 * passes under it; phone shows the same bar without the title. Continues the gesture of the
 * pressed card's CardNavProgress sweep on the next screen, replacing the generic centered spinner.
 *
 * Stays mounted across the loading → loaded branch switch (the host renders it unconditionally for
 * the folder variant) so the complete-then-fade handoff plays over the arriving grid. Purely
 * presentational and never focusable; the host's invisible focus holder owns tvOS focus while the
 * bar is up. Honors Reduce Motion (static fill, no trickle, no marquee — MarqueeText gates itself).
 */
export function FolderLoadingBar({ active, title }: FolderLoadingBarProps) {
  const insets = useSafeAreaInsets();
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
      // Handoff: complete then fade while the grid mounts over the same frames.
      progress.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [active, reducedMotion, progress, opacity]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const barStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bar, { paddingBottom: (IS_TV ? 8 : 0) + (IS_TV ? 0 : insets.bottom / 4.8) }, barStyle]}
      accessible={active}
      accessibilityLabel={`Loading ${title}`}>
      <Animated.View style={[styles.fill, fillStyle]} />
      {IS_TV ? (
        <View style={styles.titleBlend}>
          <MarqueeText active={active} style={styles.title}>
            {title}
          </MarqueeText>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The cards' title-sliver treatment at full screen width: screen-scale title, symmetric padding
  // so the text centers vertically. TV skips the overscan inset entirely (decorative strip, hugs
  // the true bottom edge); phone hides the title and keeps half the home-indicator inset BELOW the
  // padding, leaving a slim sweeping band. Pinned, no radii, opaque so the difference blend's
  // inputs stay fixed regardless of what scrolls beneath while it fades out.
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingTop: IS_TV ? 8 : 3,
    paddingHorizontal: IS_TV ? 16 : 12,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: COLORS.ACCENT,
  },
  titleBlend: {
    width: "100%",
    mixBlendMode: "difference",
  },
  // Gold through the difference blend: black over the fill, gold over the dark remainder —
  // identical treatment to the card title bars.
  title: {
    color: COLORS.ACCENT,
    fontSize: IS_TV ? 32 : 17,
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
});
