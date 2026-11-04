import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GlassIconButton } from "@/components/glass-icon-button";
import { GRIP_SIZE } from "@/components/live-tv/guide-grip";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";

/** The channel's name, here and beside the picture, starts this far in; the band's pull tab lines up with it. */
export const PINNED_TEXT_INSET = 12;
// Eased stops: the fade starts at the scrim's top edge and deepens gradually, with no visible line.
const SCRIM =
  "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.08) 15%, rgba(0, 0, 0, 0.22) 30%, rgba(0, 0, 0, 0.42) 45%, rgba(0, 0, 0, 0.62) 60%, rgba(0, 0, 0, 0.8) 75%, rgba(0, 0, 0, 0.92) 90%, rgba(0, 0, 0, 0.96) 100%)";

export interface PinnedRecordButton {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}

interface GuidePinnedOverlayProps {
  name: string;
  /** Record or stop, when the account may record this channel. */
  record?: PinnedRecordButton | null;
  extended: boolean;
  /** The name and buttons sit on the picture: iPhone's larger picture. */
  bar: boolean;
  /** The buttons' glyphs, in the theme's accent. */
  accent: string;
  /** The band's swipe between sizes, for the copy over the player, which takes the picture's touches. */
  swipe?: GestureType;
  onToggleSize: () => void;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Over the pinned channel's picture: the tap to full screen and the band's swipe, and on iPhone's larger picture the
 * name and buttons on a black scrim. Drawn by the player host over the inline video, and by the band over the clip.
 */
export function GuidePinnedOverlay({ name, record, extended, bar, accent, swipe, onToggleSize, onOpen, onClose }: GuidePinnedOverlayProps) {
  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="guide-pinned-overlay">
      <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={name} />
      {bar ? (
        <View style={styles.scrim} pointerEvents="box-none">
          <Text style={styles.name} numberOfLines={1} pointerEvents="none">
            {name}
          </Text>
          {record ? (
            <View testID="guide-pinned-record">
              <GlassIconButton icon={record.icon} iconSize={20} size={GRIP_SIZE} color={COLORS.DESTRUCTIVE} onPress={record.onPress} accessibilityLabel={record.label} />
            </View>
          ) : null}
          <GlassIconButton
            icon={extended ? "contract-outline" : "expand-outline"}
            iconSize={20}
            size={GRIP_SIZE}
            color={accent}
            onPress={onToggleSize}
            accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
          />
          <View testID="guide-pinned-close">
            <CloseOverlayButton onPress={onClose} color={accent} size={GRIP_SIZE} />
          </View>
        </View>
      ) : null}
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
    // The name's line sits on the buttons' base.
    alignItems: "flex-end",
    gap: 12,
    paddingTop: 96,
    paddingBottom: 12,
    paddingHorizontal: PINNED_TEXT_INSET,
    experimental_backgroundImage: SCRIM,
  },
  name: {
    flex: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "600",
  },
});
