import { ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

const FRAME_RATIO = 9 / 16;
const BORDER = IS_TV ? 1.5 : 1;
const FRAME_RADIUS = IS_TV ? 3.5 : 2.5;
const PICTURE_RADIUS = IS_TV ? 1.5 : 1;
const PAD = IS_TV ? 2.5 : 1.5;
const STEP_GAP = IS_TV ? 2 : 1.2;

// The frame is the panel and the picture is the figure: dropping the frame's
// ink keeps the size step the thing the eye lands on.
const FRAME_OPACITY = 0.45;

// Ordinal, not proportional: 480p is 22% of 2160 and would all but vanish
// inside a 22pt phone mark. Even steps across the widest range the frame
// affords are what a picker needs — 4K and 1080p have to differ at a glance.
const PICTURE_SCALE = [0.35, 0.51, 0.67, 0.83, 1];

// Auto's picture climbs rather than standing at one size. Three steps, not
// five: the message is that it moves, not how far.
const STEP_SCALE = [0.4, 0.7, 1];

interface QualityMarkProps {
  /** Index into QUALITY_PRESETS; ORIGINAL_INDEX draws the adaptive mark. */
  value: number;
  /** The row's ink — gold at rest, the fill's ink once the row goes gold. */
  color: string;
  /** Outer width; the panel's height follows from 16:9. */
  size: number;
}

/**
 * The Streaming Quality row mark: one 16:9 panel per row holding a picture
 * sized to the preset the row states, Auto's climbing instead of standing.
 * Inert decoration, inked by the row so it follows the focus fill.
 */
export function QualityMark({ value, color, size }: QualityMarkProps) {
  const frameHeight = Math.round(size * FRAME_RATIO);
  const innerWidth = size - 2 * (BORDER + PAD);
  const innerHeight = frameHeight - 2 * (BORDER + PAD);
  const scale = PICTURE_SCALE[value] ?? 1;

  return (
    <View style={[styles.frame, { width: size, height: frameHeight }]} accessibilityElementsHidden>
      <View style={[styles.ring, { borderColor: color }]} />
      {value === ORIGINAL_INDEX ? (
        <View style={[styles.steps, { width: innerWidth, height: innerHeight }]}>
          {STEP_SCALE.map((step, i) => (
            <View
              key={i}
              style={[
                styles.picture,
                {
                  width: (innerWidth - STEP_GAP * (STEP_SCALE.length - 1)) / STEP_SCALE.length,
                  height: innerHeight * step,
                  backgroundColor: color,
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.picture, { width: innerWidth * scale, height: innerHeight * scale, backgroundColor: color }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Corner-anchored, not centred: nesting from one corner is the resolution
  // diagram everyone already reads, and a centred fill reads as a battery.
  frame: {
    alignItems: "flex-start",
    justifyContent: "flex-end",
    paddingLeft: BORDER + PAD,
    paddingBottom: BORDER + PAD,
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
  steps: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: STEP_GAP,
  },
  picture: {
    borderRadius: PICTURE_RADIUS,
  },
});
