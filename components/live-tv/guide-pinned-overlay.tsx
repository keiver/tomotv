import { PinnedCornerButtons, type PinnedRecordButton } from "@/components/live-tv/pinned-corner-buttons";
import { PinnedRecordingMark } from "@/components/live-tv/pinned-recording-mark";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";

/** The channel's name beside the picture starts this far in; the band's pull tab lines up with it. */
export const PINNED_TEXT_INSET = 12;

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
      {mark ? <PinnedRecordingMark text={mark} style={styles.mark} /> : null}
      {bar ? (
        <PinnedCornerButtons
          accent={accent}
          muted={muted}
          onToggleMute={onToggleMute}
          record={record}
          size={{ extended, onToggle: onToggleSize }}
          onClose={onClose}
          inset={{ top: 8, right: PINNED_TEXT_INSET }}
          glow
        />
      ) : null}
    </View>
  );
  return swipe ? <GestureDetector gesture={swipe}>{body}</GestureDetector> : body;
}

const styles = StyleSheet.create({
  mark: {
    top: 6,
    left: 6,
  },
});
