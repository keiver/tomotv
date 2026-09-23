import { CARD_FOCUS, DESIGN, slotCardPadding } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { serverPoster } from "@/services/itemArtwork";
import { hasPoster } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import type { GuideMetrics } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/** The ambient canvas in miniature: a dark neutral field lit from above. */
const TILE = "linear-gradient(to bottom, #3A3A3E 0%, #232326 55%, #1C1C1E 100%)";
const PADDING = slotCardPadding(false);

interface GuideChannelTileProps {
  channel: JellyfinItem;
  metrics: GuideMetrics;
  onPress: (channel: JellyfinItem) => void;
}

/**
 * The channel as a portrait card the row's own height, what the landscape card becomes once the
 * column is dragged to the left magnet. Square on the right, where it plugs into the row. Phone only.
 */
export function GuideChannelTile({ channel, metrics, onPress }: GuideChannelTileProps) {
  const press = useCallback(() => onPress(channel), [onPress, channel]);
  const width = metrics.compactColumnWidth - PADDING;
  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={channel.Name} style={[styles.card, { width }]}>
      {hasPoster(channel) ? (
        <View style={styles.logoHalo} pointerEvents="none">
          <Image source={serverPoster(channel.Id, channel.ImageTags?.Primary, metrics.rowHeight * 2)} style={styles.logo} contentFit="contain" transition={150} />
        </View>
      ) : (
        <Ionicons name="tv-outline" size={28} color="rgba(255, 255, 255, 0.45)" />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Stretches to the row it sits in: the grid's rows are contiguous, so the caps are too.
  card: {
    flex: 1,
    borderTopLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: CARD_FOCUS.BORDER_COLOR,
    backgroundColor: COLORS.SURFACE,
    experimental_backgroundImage: TILE,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  // No background, so the layer shadow traces the logo's own alpha: a white halo round a dark mark.
  logoHalo: {
    position: "absolute",
    top: "12%",
    left: "12%",
    right: "12%",
    bottom: "12%",
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.9,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 0 },
  },
  logo: {
    width: "100%",
    height: "100%",
  },
});
