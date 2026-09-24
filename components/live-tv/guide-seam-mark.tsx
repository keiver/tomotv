import { HOUR_MARK_HEIGHT, MAJOR_MARK_HEIGHT, MAJOR_MARK_WIDTH, RULER_RED } from "@/components/live-tv/guide-time-ruler";
import React from "react";
import { Platform, StyleSheet } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";

/** The seam's centre from the column's width: TV draws it as the column's 1px border, phone as the divider's centred line. */
const SEAM_CENTRE = Platform.isTV ? -0.5 : 0;

interface GuideSeamMarkProps {
  columnW: SharedValue<number>;
  scrollX: SharedValue<number>;
  isHour: boolean;
  /** The ruler's content height, above its 1px bottom line. */
  height: number;
}

/**
 * The ruler's first mark, painted over the column/grid seam: the grid's scroll view clips at the
 * seam, so a mark inside it can never reach the line. Slides out with the grid, clipped at its own left edge.
 */
export function GuideSeamMark({ columnW, scrollX, isHour, height }: GuideSeamMarkProps) {
  const clipStyle = useAnimatedStyle(() => ({ left: columnW.get() + SEAM_CENTRE - MAJOR_MARK_WIDTH / 2 }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.get() }] }));
  return (
    <Animated.View style={[styles.clip, { height }, clipStyle]} pointerEvents="none">
      <Animated.View style={[styles.mark, { height: isHour ? HOUR_MARK_HEIGHT : MAJOR_MARK_HEIGHT }, markStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: "absolute",
    top: 0,
    right: 0,
    overflow: "hidden",
  },
  mark: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: MAJOR_MARK_WIDTH,
    backgroundColor: RULER_RED,
  },
});
