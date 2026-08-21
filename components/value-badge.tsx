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
  // A wash, not a fill: a solid gold pill is the app's "this acts" mark (see
  // ListRow), and this states a number. 18% keeps the brand hue at 1.5:1 off
  // the page while the ink still reads at 7.7:1.
  badge: {
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: "rgba(255, 195, 18, 0.18)",
    paddingVertical: IS_TV ? 5 : 3,
    paddingHorizontal: IS_TV ? 16 : 10,
    alignSelf: "flex-end",
  },
  label: {
    color: COLORS.ACCENT,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
  },
});
