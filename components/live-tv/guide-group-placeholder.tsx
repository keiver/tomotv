import { GROUP_CELL_HEIGHT, HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import React from "react";
import { StyleSheet, View } from "react-native";

/** Fills the band past the last group with a group cell's floor, so short lists read as one surface. */
export function GuideGroupPlaceholder() {
  return <View style={styles.tile} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    height: GROUP_CELL_HEIGHT,
    backgroundColor: HUD_CELL_BACKGROUND,
  },
});
