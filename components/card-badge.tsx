import { CARD_FOCUS } from "@/constants/app";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface CardBadgeProps {
  /** Short text or count — circle at 1-2 characters, pill beyond. */
  label: string | number;
}

/** Top-left gold card pill: folder item counts, season/episode tags. */
export function CardBadge({ label }: CardBadgeProps) {
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: IS_TV ? 16 : 10,
    left: IS_TV ? 16 : 10,
    minWidth: IS_TV ? 40 : 26,
    height: IS_TV ? 40 : 26,
    paddingHorizontal: IS_TV ? 8 : 6,
    borderRadius: IS_TV ? 20 : 13, // half of height → circle at 1-2 digits, pill beyond
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "700",
  },
});
