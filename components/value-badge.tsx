import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface ValueBadgeProps {
  /** The measured value the pill states, already formatted ("4 Mbps"). */
  label: string;
}

/**
 * Tinted pill for a measured value sitting beside a label. Inline and inert,
 * where CardBadge stamps artwork absolutely and FilterChip is a focusable toggle.
 */
export function ValueBadge({ label }: ValueBadgeProps) {
  return (
    <View style={styles.badge}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Solid gold under black ink, which reads at 13:1. A wash cannot carry that
  // ink: 18% gold over the page leaves it at 1.7:1.
  badge: {
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: COLORS.ACCENT,
    paddingVertical: IS_TV ? 5 : 3,
    paddingHorizontal: IS_TV ? 16 : 10,
    alignSelf: "flex-end",
  },
  label: {
    color: COLORS.ON_ACCENT,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
  },
});
