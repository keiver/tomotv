import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import React, { forwardRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The HUD band's height: the group cells and the corner circles share it. */
export const GROUP_CELL_HEIGHT = IS_TV ? 56 : 40;

interface GuideGroupCellProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * One channel group on the guide's HUD band, drawn as a grid cell: the canvas surface, the grid's
 * lines, the cells' gold focus ring, and the accent fill while its group holds the channels.
 */
export const GuideGroupCell = forwardRef<View, GuideGroupCellProps>(function GuideGroupCell({ label, selected, onPress }, ref) {
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      isTVSelectable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      tvParallaxProperties={{ enabled: false }}
      style={[styles.cell, selected && styles.cellSelected]}>
      {({ focused }) => (
        <>
          {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
          <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // The guide cell's language: the canvas surface, its own right line, the band's bottom line.
  cell: {
    height: GROUP_CELL_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: IS_TV ? 28 : 16,
    backgroundColor: COLORS.SURFACE,
    borderRightWidth: 1,
    borderColor: GRID_LINE,
  },
  cellSelected: {
    backgroundColor: COLORS.ACCENT,
  },
  // The cells' ring: spanning the neighbour's line too, so it meets the band's edges.
  focusRing: {
    position: "absolute",
    top: 0,
    left: -1,
    right: -1,
    bottom: 0,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.ACCENT,
  },
  label: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 24 : 14,
    fontWeight: "600",
  },
  labelSelected: {
    color: COLORS.ON_ACCENT,
  },
});
