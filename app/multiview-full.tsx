import { t } from "@/services/i18n";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";

/**
 * Multiview's spot with the sound, full screen: Multiview draws that spot over its whole screen under this transparent
 * screen, its own player playing on. This screen only holds focus, so Menu, a select, a tap or Escape returns to the layout.
 */
export default function MultiviewFullScreen() {
  const router = useRouter();
  const back = useCallback(() => router.back(), [router]);
  return <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} hasTVPreferredFocus onPress={back} accessibilityRole="button" accessibilityLabel={t("liveTv.multiview")} />;
}
