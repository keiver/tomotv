import { VideoGridItem } from "@/components/video-grid-item";
import { CardPaletteOverride } from "@/hooks/useCardPalette";
import { cardPalette } from "@/services/cardTheme";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import React from "react";
import { StyleSheet, View } from "react-native";

// 1200 x 514: the widest the card draws it is about 1100px (TV at 2x); expo-image downscales to the card.
const POSTER = require("@/assets/images/theme-default-poster.png");
const noop = () => {};

// A kind the engine never grabs a keyframe for, so the made-up id fetches nothing. The poster's own
// shape picks the landscape slot; Played wears the eye badge, so the badge shows the theme too.
const CARD: JellyfinVideoItem = { Id: "theme-preview", Name: "Tomo TV", Type: "Series", Path: "", PrimaryImageAspectRatio: 1200 / 514, UserData: { Played: true } } as JellyfinVideoItem;

/** One real card in the draft colour, wearing focus, with the Tomo TV poster. Never focusable or pressable. */
export function ThemePreview({ accent, cardHeight }: { accent: string; cardHeight: number }) {
  return (
    <CardPaletteOverride.Provider value={cardPalette(accent)}>
      <View style={styles.center} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <VideoGridItem video={CARD} onPress={noop} index={0} cardHeight={cardHeight} fitArtwork poster={POSTER} highlighted inert />
      </View>
    </CardPaletteOverride.Provider>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
  },
});
