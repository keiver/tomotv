import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import React, { forwardRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The HUD band's height: the group tiles and the corner tiles share it. */
export const GROUP_CELL_HEIGHT = IS_TV ? 56 : 40;
/** The band's frosted-black floor, shared by the group and corner tiles. */
export const HUD_CELL_BACKGROUND = "rgba(0, 0, 0, 0.4)";
/** The pick's yellow wash over the black floor. */
const WASH_SELECTED = "rgba(255, 195, 18, 0.85)";

interface GuideGroupCellProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * One channel group on the guide's HUD band: a frosted-black cell filling the band, square-cornered
 * so the row reads as one surface split by the grid's lines. The picked group wears the accent;
 * focus draws the program cells' gold ring.
 */
export const GuideGroupCell = forwardRef<View, GuideGroupCellProps>(function GuideGroupCell({ label, selected, onPress }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.tile, selected && styles.tileSelected]}>
      <Pressable
        ref={ref}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        isTVSelectable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        tvParallaxProperties={{ enabled: false }}
        style={styles.hit}>
        {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
        <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  // Fills the band; its right line is the row's divider, as a cell's is the grid's.
  tile: {
    height: GROUP_CELL_HEIGHT,
    justifyContent: "center",
    borderRightWidth: 1,
    borderColor: GRID_LINE,
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  tileSelected: {
    backgroundColor: WASH_SELECTED,
  },
  hit: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: IS_TV ? 26 : 14,
  },
  // The program cells' focus mark, spanning the shared lines so it meets the band's edges.
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
