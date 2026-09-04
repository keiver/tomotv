import { COLORS } from "@/constants/colors";
import { ActivityIndicator, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

// The app's one wait mark: a small gold spinner with its label beside it, read as one element.
export function LoadingRow({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="small" color={COLORS.ACCENT} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  label: {
    fontSize: Platform.isTV ? 20 : 16,
    color: COLORS.TEXT_SECONDARY,
    fontWeight: "500",
  },
});
