import { COLORS } from "@/constants/colors";
import { DESIGN } from "@/constants/app";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

export interface PillSwitchOption<K extends string> {
  key: K;
  label: string;
}

interface PillSwitchProps<K extends string> {
  options: PillSwitchOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
}

/** A row of tight pills, one selected: which of two things a screen is showing. */
export function PillSwitch<K extends string>({ options, value, onChange, accessibilityLabel }: PillSwitchProps<K>) {
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={({ pressed, focused }) => [styles.pill, selected && styles.pillSelected, (pressed || focused) && !selected && styles.pillFocused]}>
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: IS_TV ? 12 : 8, marginBottom: IS_TV ? 20 : 12, marginLeft: IS_TV ? 16 : 8 },
  pill: {
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    paddingVertical: IS_TV ? 6 : 5,
    paddingHorizontal: IS_TV ? 18 : 12,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  pillSelected: { backgroundColor: COLORS.ACCENT, borderColor: COLORS.ACCENT },
  pillFocused: { borderColor: COLORS.ACCENT },
  label: { fontSize: IS_TV ? 22 : 13, fontWeight: "600", color: COLORS.TEXT_SECONDARY },
  labelSelected: { color: COLORS.ON_ACCENT_WARM },
});
