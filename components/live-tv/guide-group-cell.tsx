import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The HUD band's height: the group tiles and the corner tiles share it. */
export const GROUP_CELL_HEIGHT = IS_TV ? 56 : 40;
/** The band's frosted-black floor, shared by the group and corner tiles. */
export const HUD_CELL_BACKGROUND = "rgba(0, 0, 0, 0.4)";
/** The pick's green wash over the black floor; focus flips the cell white, the platform's focus tone. */
const WASH_SELECTED = "rgba(52, 199, 89, 0.2)";
const FILL_SELECTED_FOCUSED = "#FFFFFF";

interface GuideGroupCellProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * One channel group on the guide's HUD band: a frosted-black cell filling the band, square-cornered
 * so the row reads as one surface split by the grid's lines. The picked group wears a green wash and a checkmark;
 * focus draws the program cells' gold ring.
 */
export const GuideGroupCell = forwardRef<View, GuideGroupCellProps>(function GuideGroupCell({ label, selected, onPress }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.tile, selected && (focused ? styles.tileSelectedFocused : styles.tileSelected)]}>
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
        <View style={styles.content}>
          <Text style={[styles.label, selected && focused && styles.labelSelected]} numberOfLines={1}>
            {label}
          </Text>
          {selected ? <Ionicons name="checkmark" size={IS_TV ? 24 : 15} color={focused ? COLORS.ON_ACCENT : COLORS.TEXT_PRIMARY} /> : null}
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  // Borderless, natural width; the band's floor fills the space beyond the last tile.
  tile: {
    height: GROUP_CELL_HEIGHT,
    justifyContent: "center",
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  tileSelected: {
    backgroundColor: WASH_SELECTED,
  },
  tileSelectedFocused: {
    backgroundColor: FILL_SELECTED_FOCUSED,
  },
  hit: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: IS_TV ? 26 : 14,
  },
  // The program cells' focus mark.
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.ACCENT,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 10 : 6,
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
