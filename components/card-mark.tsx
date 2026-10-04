import { SLIM_BADGE_HEIGHT } from "@/components/card-badge";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet } from "react-native";

const IS_TV = Platform.isTV;

interface CardMarkProps {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

/** A bare glyph in a card's badge row: no fill, a drop shadow lifts it off the artwork. */
export function CardMark({ icon, color }: CardMarkProps) {
  return <Ionicons name={icon} size={SLIM_BADGE_HEIGHT} color={color} style={styles.shadow} />;
}

const styles = StyleSheet.create({
  shadow: {
    textShadowColor: "rgba(0, 0, 0, 0.85)",
    textShadowOffset: { width: 0, height: IS_TV ? 2 : 1 },
    textShadowRadius: IS_TV ? 6 : 3,
  },
});
