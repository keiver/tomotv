import { DESIGN } from "@/constants/app";
import React from "react";
import { StyleSheet, View } from "react-native";

/** The artwork at its full slot size, cut off above the card's rounded foot so none of it sits under the title bar's curved edge. */
export function CardArtClip({ ratio, children }: { ratio: number; children: React.ReactNode }) {
  return (
    <View style={styles.clip} pointerEvents="none">
      <View style={[styles.slot, { aspectRatio: ratio }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: DESIGN.BORDER_RADIUS_CARD,
    overflow: "hidden",
  },
  slot: {
    width: "100%",
  },
});
