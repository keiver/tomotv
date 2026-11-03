import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export type LiveMarkState = "tuning" | "pip";

/** The no-poster card's glyph: same size and tint, so the mark reads as the card's own face. The spinner wears the theme's accent. */
const MARK_SIZE = 56;
const MARK_TINT = "rgba(255, 255, 255, 0.45)";

/** Live TV's channel in a PiP window, marked on its card: opening, or playing in the window, as AVKit marks the player it left. */
export function GuideLiveMark({ state }: { state: LiveMarkState }) {
  const { accent } = useCardPalette();
  return (
    <View style={styles.cover} pointerEvents="none" accessible accessibilityLabel={t(state === "tuning" ? "liveTv.tuningIn" : "liveTv.playingInPip")} testID={`guide-live-mark-${state}`}>
      {state === "tuning" ? <ActivityIndicator size="small" color={accent} /> : <SfSymbolIcon name="pip" size={MARK_SIZE} color={MARK_TINT} />}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.SURFACE,
  },
});
