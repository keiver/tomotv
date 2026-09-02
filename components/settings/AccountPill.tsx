import { IS_PAD, settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { DESIGN } from "@/constants/app";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface AccountPillProps {
  label: string;
  /** The row is on its gold fill: the pill takes the fill's own ink. */
  onGold: boolean;
}

/** A saved sign-in on a server card: one tight pill per account, in the subtitle's place. */
export function AccountPill({ label, onGold }: AccountPillProps) {
  return (
    <View style={[styles.pill, onGold && styles.pillOnGold]}>
      <Text style={[styles.label, onGold && settingsStyles.listItemSubtitleFocused]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
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
