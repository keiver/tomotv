import { CARD_FOCUS, DESIGN } from "@/constants/app";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface FilterChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
  hasTVPreferredFocus?: boolean;
}

/**
 * A focusable on/off pill for the library Filters panel (status, genre, artist, shuffle).
 * Sized to its label so sections can wrap several per row. Focus feedback is color/border
 * only — no scale animation (grid performance rule).
 */
function FilterChipComponent({ label, selected, onToggle, hasTVPreferredFocus = false }: FilterChipProps) {
  return (
    <Pressable
      onPress={onToggle}
      isTVSelectable
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      tvParallaxProperties={{ magnification: 1.01 }}
      style={({ focused, pressed }) => [styles.chip, selected && styles.chipSelected, focused && styles.chipFocused, pressed && styles.chipPressed]}>
      {({ focused }) => (
        <View style={styles.content}>
          {selected && <Ionicons name="checkmark" size={IS_TV ? 22 : 16} color={focused ? CARD_FOCUS.TITLE_TEXT_FOCUSED : CARD_FOCUS.GLOW_COLOR} />}
          <Text style={[styles.label, selected && styles.labelSelected, focused && styles.labelFocused]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export const FilterChip = React.memo(FilterChipComponent);

const styles = StyleSheet.create({
  chip: {
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: "#2C2C2E",
    paddingVertical: IS_TV ? 10 : 8,
    paddingHorizontal: IS_TV ? 26 : 16,
    borderWidth: 2,
    borderColor: "transparent",
    alignSelf: "flex-start",
  },
  chipSelected: {
    borderColor: CARD_FOCUS.GLOW_COLOR,
  },
  chipFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    borderColor: CARD_FOCUS.BORDER_COLOR_FOCUSED,
  },
  chipPressed: {
    opacity: 0.85,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 6,
  },
  label: {
    fontSize: IS_TV ? 22 : 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  labelSelected: {
    color: CARD_FOCUS.GLOW_COLOR,
  },
  labelFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
});
