import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

const BADGE_SIZE = 24;

/** The pinned channel's own card in the list: a speaker in the card's corner, over its live picture. */
export function GuideLiveMark() {
  const { accent, onAccent } = useCardPalette();
  return (
    <View style={[styles.badge, { backgroundColor: accent }]} pointerEvents="none" accessible accessibilityLabel={t("liveTv.playingPinned")} testID="guide-live-mark">
      <Ionicons name="volume-high" size={14} color={onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
