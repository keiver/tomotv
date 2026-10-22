import { GROUP_CELL_HEIGHT, HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import React from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

/** Fills the band past the last group with a group cell's floor, so short lists read as one surface. */
export function GuideGroupPlaceholder({ onLayout }: { onLayout?: (event: LayoutChangeEvent) => void }) {
  return <View style={styles.tile} pointerEvents="none" onLayout={onLayout} />;
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    height: GROUP_CELL_HEIGHT,
    backgroundColor: HUD_CELL_BACKGROUND,
  },
});
