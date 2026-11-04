import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GlassIconButton } from "@/components/glass-icon-button";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";

const SCRIM = "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.55) 45%, rgba(0, 0, 0, 0.85) 100%)";

interface GuidePinnedOverlayProps {
  name: string;
  extended: boolean;
  /** The buttons' glyphs, in the theme's accent. */
  accent: string;
  /** The band's swipe between sizes, for the copy over the player, which takes the picture's touches. */
  swipe?: GestureType;
  onToggleSize: () => void;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * The pinned channel's name and buttons over the bottom of its larger picture, on a black scrim. Drawn by the player
 * host over the inline video, and by the band over the channel's clip while it opens.
 */
export function GuidePinnedOverlay({ name, extended, accent, swipe, onToggleSize, onOpen, onClose }: GuidePinnedOverlayProps) {
  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="guide-pinned-overlay">
      <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={name} />
      <View style={styles.scrim} pointerEvents="box-none">
        <Text style={styles.name} numberOfLines={1} pointerEvents="none">
          {name}
        </Text>
        <GlassIconButton
          icon={extended ? "contract-outline" : "expand-outline"}
          iconSize={16}
          size={32}
          color={accent}
          onPress={onToggleSize}
          accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
        />
        <View testID="guide-pinned-close">
          <CloseOverlayButton onPress={onClose} compact color={accent} />
        </View>
      </View>
    </View>
  );
  return swipe ? <GestureDetector gesture={swipe}>{body}</GestureDetector> : body;
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 28,
    paddingBottom: 10,
    paddingHorizontal: 12,
    experimental_backgroundImage: SCRIM,
  },
  name: {
    flex: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "600",
  },
});
