import React from "react";
import { StyleSheet, View } from "react-native";

interface GuidePinnedFilletProps {
  /** Which side of the tab it rounds into. */
  side: "left" | "right";
  radius: number;
  color: string;
}

/**
 * The inside curve where the pinned band's edge bends down into its pull tab: a ring clipped to one corner square,
 * so whatever lies under it shows through the curve with no colour to match.
 */
export function GuidePinnedFillet({ side, radius, color }: GuidePinnedFilletProps) {
  return (
    <View style={[styles.square, { width: radius, height: radius }, side === "left" ? { left: -radius } : { right: -radius }]} pointerEvents="none">
      <View
        style={{
          position: "absolute",
          top: -radius,
          left: side === "left" ? -2 * radius : -radius,
          width: 4 * radius,
          height: 4 * radius,
          borderRadius: 2 * radius,
          borderWidth: radius,
          borderColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
});
