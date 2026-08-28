import { COLORS } from "@/constants/colors";
import { ActivityIndicator, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

/**
 * A spinner and the words it belongs to, on one line.
 *
 * Every in-progress state in the app reads the same way: the indicator sits beside its label,
 * never stacked above it. A screen with a secondary line (a description under a title) puts that
 * line under this row rather than inside it.
 *
 * The row owns geometry only. Call sites pass `labelStyle` to keep their own type scale, so
 * adopting this changes layout without touching a screen's typography.
 */
export function LoadingRow({
  label,
  size = "small",
  color = COLORS.ACCENT,
  style,
  labelStyle,
}: {
  label: string;
  size?: "small" | "large";
  color?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      <ActivityIndicator size={size} color={color} />
      <Text style={[styles.label, labelStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  label: {
    fontSize: Platform.isTV ? 20 : 16,
    color: COLORS.TEXT_SECONDARY,
    fontWeight: "500",
  },
});
