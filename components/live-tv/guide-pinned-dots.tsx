import { COLORS } from "@/constants/colors";
import React from "react";
import { StyleSheet, View } from "react-native";

const DOT = 8;
/** A ring in the background colour, so accent dots read on the accent edge they sit on. */
const RING = 2;
const GAP = 4;
/** One dot's outer diameter, ring included. */
export const PINNED_DOT_SIZE = DOT + 2 * RING;
const ROW_WIDTH = 3 * PINNED_DOT_SIZE + 2 * GAP;

interface GuidePinnedDotsProps {
  color: string;
  /** The dots' centre, from the left of the view they sit in. */
  centerX: number;
  /** The dots' bottom, from the bottom of the view they sit in; negative reaches below it. */
  bottom: number;
}

/** Three accent dots on the pinned band's bottom edge: the mark for its swipe between sizes. */
export function GuidePinnedDots({ color, centerX, bottom }: GuidePinnedDotsProps) {
  return (
    <View style={[styles.row, { left: centerX - ROW_WIDTH / 2, bottom }]} pointerEvents="none" testID="guide-pinned-dots">
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    flexDirection: "row",
    gap: GAP,
  },
  dot: {
    width: PINNED_DOT_SIZE,
    height: PINNED_DOT_SIZE,
    borderRadius: PINNED_DOT_SIZE / 2,
    borderWidth: RING,
    borderColor: COLORS.BACKGROUND,
  },
});
