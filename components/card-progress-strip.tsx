import { useCardPalette } from "@/hooks/useCardPalette";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
const HEIGHT = IS_TV ? 6 : 4;

/** The fill's share in percent, floored at 5 so a just-started item still shows one. */
export function progressStripPercent(fraction: number): number {
  return Math.max(Math.round(Math.min(Math.max(fraction, 0), 1) * 100), 5);
}

/** A watched fraction as a pill inside the art, lifted off its bottom edge and clear of the rounded corners. */
export function CardProgressStrip({ fraction }: { fraction: number }) {
  const { accent } = useCardPalette();
  return (
    <View style={styles.track} pointerEvents="none" testID="card-progress-strip">
      <View style={[styles.fill, { width: `${progressStripPercent(fraction)}%`, backgroundColor: accent }]} testID="card-progress-fill" />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    left: IS_TV ? 20 : 10,
    right: IS_TV ? 20 : 10,
    bottom: IS_TV ? 16 : 8,
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: HEIGHT / 2,
  },
});
