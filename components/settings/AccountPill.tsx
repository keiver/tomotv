import { IS_PAD, settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { DESIGN } from "@/constants/app";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface AccountPillProps {
  label: string;
  /** A glyph before the label: the platform a Diagnostics row speaks for. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** The row is on its gold fill: the pill takes the fill's own ink. */
  onGold: boolean;
}

/** A tight pill: a saved sign-in on a server card, the build on the Open Source page. */
export function AccountPill({ label, icon, onGold }: AccountPillProps) {
  return (
    <View style={[styles.pill, onGold && styles.pillOnGold]}>
      {icon ? <Ionicons name={icon} size={IS_TV ? 18 : IS_PAD ? 13 : 12} color={onGold ? COLORS.ON_ACCENT_WARM : COLORS.TEXT_SECONDARY} /> : null}
      <Text style={[styles.label, onGold && settingsStyles.listItemSubtitleFocused]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 6 : 4,
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    paddingVertical: IS_TV ? 3 : 2,
    paddingHorizontal: IS_TV ? 12 : 8,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    flexShrink: 1,
  },
  pillOnGold: {
    backgroundColor: "rgba(43, 31, 5, 0.1)",
    borderColor: "rgba(43, 31, 5, 0.22)",
  },
  label: {
    fontSize: IS_TV ? 20 : IS_PAD ? 14 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
  },
});
