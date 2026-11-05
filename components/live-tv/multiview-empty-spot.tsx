import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import type { MultiviewRect } from "@keiver/tomo-live";
import React, { memo, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity } from "react-native";

const IS_TV = Platform.isTV;

/** A multiview spot with no channel: a press opens the channel picker for it. */
function MultiviewEmptySpotComponent({ rect, hasTVPreferredFocus, onPress }: { rect: MultiviewRect; hasTVPreferredFocus?: boolean; onPress: () => void }) {
  const { accent } = useCardPalette();
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={0.9}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={t("liveTv.multiviewAdd")}
      style={[styles.spot, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }, focused && { borderColor: accent }]}>
      <Ionicons name="add" size={IS_TV ? 64 : 36} color={focused ? accent : COLORS.TEXT_SECONDARY} />
    </TouchableOpacity>
  );
}

export const MultiviewEmptySpot = memo(MultiviewEmptySpotComponent);

const styles = StyleSheet.create({
  spot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.SURFACE_SUNKEN,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    borderColor: "transparent",
  },
});
