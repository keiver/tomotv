import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { ActivityIndicator, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

// The app's one wait mark: a small accent spinner with its label centred beneath it, read as one element.
// `hideLabel` keeps the label for VoiceOver and draws the spinner alone.
export function LoadingRow({ label, style, hideLabel }: { label: string; style?: StyleProp<ViewStyle>; hideLabel?: boolean }) {
  const { accent } = useCardPalette();
  return (
    <View style={[styles.group, style]} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="small" color={accent} />
      {hideLabel ? null : <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: "center",
    justifyContent: "center",
    gap: Platform.isTV ? 14 : 10,
  },
  label: {
    fontSize: Platform.isTV ? 20 : 16,
    color: COLORS.TEXT_SECONDARY,
    fontWeight: "500",
    textAlign: "center",
  },
});
