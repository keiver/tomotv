import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface FilterChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
  hasTVPreferredFocus?: boolean;
}

/**
 * A focusable on/off pill for the library Filters panel and the Live TV group strip.
 * Sized to its label so sections can wrap several per row. Focus feedback is color/border
 * only — no scale animation (grid performance rule).
 */
const FilterChipComponent = forwardRef<View, FilterChipProps>(function FilterChipComponent({ label, selected, onToggle, hasTVPreferredFocus = false }, ref) {
  const palette = useCardPalette();
  const themed = useThemedStyles();
  return (
    <Pressable
      ref={ref}
      onPress={onToggle}
      isTVSelectable
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      tvParallaxProperties={{ magnification: 1.01 }}
      style={({ focused, pressed }) => [styles.chip, selected && themed.chipSelected, focused && themed.chipFocused, pressed && styles.chipPressed]}>
      {({ focused }) => (
        // Kept in the native tree: flattened, the optional checkmark renumbers the focusable's children.
        <View style={styles.content} collapsable={false}>
          {selected && <Ionicons name="checkmark" size={IS_TV ? 22 : 16} color={focused ? palette.ink : palette.accent} />}
          <Text style={[styles.label, selected && themed.labelSelected, focused && themed.labelFocused]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

export const FilterChip = React.memo(FilterChipComponent);

const styles = StyleSheet.create({
  chip: {
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: COLORS.SURFACE,
    paddingVertical: IS_TV ? 10 : 8,
    paddingHorizontal: IS_TV ? 26 : 16,
    borderWidth: 2,
    borderColor: "transparent",
    alignSelf: "flex-start",
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
    color: COLORS.TEXT_PRIMARY,
  },
});

const useThemedStyles = themedStyles((palette) => ({
  chipSelected: {
    borderColor: palette.accent,
  },
  chipFocused: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  labelSelected: {
    color: palette.accent,
  },
  labelFocused: {
    color: palette.ink,
  },
}));
