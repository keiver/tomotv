import { MARK_HEIGHT, MARK_WIDTH } from "@/components/settings/styles";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

const BORDER = IS_TV ? 1.5 : 1;
const PAD = IS_TV ? 2.5 : 1.5;
const FRAME_RADIUS = IS_TV ? 4 : 3;
const PICTURE_RADIUS = IS_TV ? 2 : 1.5;

// The frame is the panel and the picture is the figure: dropping the frame's
// ink keeps the size step the thing the eye lands on.
const FRAME_OPACITY = 0.45;

const INNER_WIDTH = MARK_WIDTH - 2 * (BORDER + PAD);
const INNER_HEIGHT = MARK_HEIGHT - 2 * (BORDER + PAD);

// Ordinal, not proportional: 480p is 22% of 2160 and would all but vanish
// inside a 28pt phone mark. Even steps across the widest range the frame
// affords are what a picker needs — 4K and 1080p have to differ at a glance.
const PICTURE_SCALE = [0.35, 0.51, 0.67, 0.83, 1];

interface QualityMarkProps {
  /** Index into QUALITY_PRESETS. Auto is not a rung: it wears the LinkLadder. */
  value: number;
  /** The row's ink — gold at rest, the fill's ink once the row goes gold. */
  color: string;
}

/**
 * The picture a preset carries, centred inside a 16:9 panel every row shares.
 * Centred, not anchored: a fill that grows from one edge of a fixed casing is
 * a battery gauge, which is what the corner-anchored draw read as on device.
 */
export function QualityMark({ value, color }: QualityMarkProps) {
  const scale = PICTURE_SCALE[value] ?? 1;

  return (
    <View style={styles.frame} accessibilityElementsHidden>
      <View style={[styles.ring, { borderColor: color }]} />
      <View style={[styles.picture, { width: INNER_WIDTH * scale, height: INNER_HEIGHT * scale, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: MARK_WIDTH,
    height: MARK_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  // A sibling, not a border on the frame itself: opacity on a parent takes its
  // children with it, and the picture inside is meant to stay at full ink.
  ring: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: BORDER,
    borderRadius: FRAME_RADIUS,
    opacity: FRAME_OPACITY,
  },
  picture: {
    borderRadius: PICTURE_RADIUS,
  },
});
