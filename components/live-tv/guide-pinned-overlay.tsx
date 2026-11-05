import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GlassIconButton } from "@/components/glass-icon-button";
import { RecordingPulse } from "@/components/live-tv/recording-pulse";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";

/** The channel's name beside the picture starts this far in; the band's pull tab lines up with it. */
export const PINNED_TEXT_INSET = 12;
const CORNER_BUTTON = 38;
const CORNER_ICON = 19;

export interface PinnedRecordButton {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  /** Shown beside the glyph while a recording runs: Stop Recording. */
  text?: string;
  onPress: () => void;
}

interface GuidePinnedOverlayProps {
  name: string;
  /** What the picture is while a recording runs: the channel being recorded, or the recording itself. */
  mark?: string | null;
  /** Record or stop, when the account may record this channel. */
  record?: PinnedRecordButton | null;
  extended: boolean;
  /** The buttons sit on the picture: iPhone's larger picture. */
  bar: boolean;
  /** The buttons' glyphs, in the theme's accent. */
  accent: string;
  /** The band's swipe between sizes, for the copy over the player, which takes the picture's touches. */
  swipe?: GestureType;
  muted: boolean;
  onToggleMute: () => void;
  onToggleSize: () => void;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Over the pinned channel's picture: the tap to full screen and the band's swipe, and on iPhone's larger picture the
 * buttons in its top corner. Drawn by the player host over the inline video, and by the band over the clip.
 */
export function GuidePinnedOverlay({ name, mark, record, extended, bar, accent, swipe, muted, onToggleMute, onToggleSize, onOpen, onClose }: GuidePinnedOverlayProps) {
  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="guide-pinned-overlay">
      <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={mark ? `${name}, ${mark}` : name} />
      {mark ? (
        <View style={styles.mark} pointerEvents="none" testID="guide-pinned-mark">
          <RecordingPulse active>
            <View style={styles.markDot} />
          </RecordingPulse>
          <Text style={styles.markText} numberOfLines={1}>
            {mark}
          </Text>
        </View>
      ) : null}
      {bar ? (
        <View style={styles.corner} pointerEvents="box-none">
          <GlassIconButton
            icon={muted ? "volume-mute-outline" : "volume-high-outline"}
            iconSize={CORNER_ICON}
            size={CORNER_BUTTON}
            color={accent}
            onPress={onToggleMute}
            accessibilityLabel={t(muted ? "liveTv.unmute" : "liveTv.mute")}
          />
          {record ? (
            <View testID="guide-pinned-record">
              <GlassIconButton icon={record.icon} iconSize={CORNER_ICON} size={CORNER_BUTTON} color={COLORS.DESTRUCTIVE} onPress={record.onPress} accessibilityLabel={record.label} />
            </View>
          ) : null}
          <GlassIconButton
            icon={extended ? "contract-outline" : "expand-outline"}
            iconSize={CORNER_ICON}
            size={CORNER_BUTTON}
            color={accent}
            onPress={onToggleSize}
            accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
          />
          <View testID="guide-pinned-close">
            <CloseOverlayButton onPress={onClose} color={accent} size={CORNER_BUTTON} />
          </View>
        </View>
      ) : null}
    </View>
  );
  return swipe ? <GestureDetector gesture={swipe}>{body}</GestureDetector> : body;
}

const styles = StyleSheet.create({
  // Every button in the picture's top corner, as beside the picture.
  corner: {
    position: "absolute",
    top: 8,
    right: PINNED_TEXT_INSET,
    flexDirection: "row",
    gap: 12,
  },
  mark: {
    position: "absolute",
    top: 6,
    left: 6,
    maxWidth: "90%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
  },
  markDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: COLORS.DESTRUCTIVE,
  },
  markText: {
    flexShrink: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 11,
    fontWeight: "600",
  },
});
