import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from "react-native";

interface CloseOverlayButtonProps {
  onPress: () => void;
  /** Placement (position/top/left/right) — the base style only shapes the circle. */
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/**
 * Floating circular ✕ for touch screens, overlaid on full-screen media (player, photo viewer).
 * TV never renders it — the remote's Menu/back pops the screen natively.
 */
export function CloseOverlayButton({ onPress, style, accessibilityHint }: CloseOverlayButtonProps) {
  return (
    <TouchableOpacity style={[styles.button, style]} onPress={onPress} accessibilityLabel="Close" accessibilityRole="button" accessibilityHint={accessibilityHint}>
      <Ionicons name="close" size={30} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
});
