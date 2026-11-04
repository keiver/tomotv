import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GlassIconButton } from "@/components/glass-icon-button";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const SCRIM = "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.55) 45%, rgba(0, 0, 0, 0.85) 100%)";

interface GuidePinnedOverlayProps {
  name: string;
  extended: boolean;
  onToggleSize: () => void;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * The pinned channel's name and buttons over the bottom of its larger picture, on a black scrim. Drawn by the player
 * host over the inline video, and by the band over the channel's clip while it opens.
 */
export function GuidePinnedOverlay({ name, extended, onToggleSize, onOpen, onClose }: GuidePinnedOverlayProps) {
  return (
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
          onPress={onToggleSize}
          accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
        />
        <View testID="guide-pinned-close">
          <CloseOverlayButton onPress={onClose} compact />
        </View>
      </View>
    </View>
  );
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
