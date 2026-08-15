import { Dimensions, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

type GhostVariant = "panel" | "header" | "vertical" | "brand" | "brandSpine";

// The spine's own band. Wide enough to hold the rotated line, no wider.
const SPINE_FONT_SIZE = 90;

// The phone brand mark, small either way it is placed: it labels the app, it doesn't head the
// screen, and a phone reads it from a foot away.
const BRAND_FONT_SIZE = 13;

// The turned run's length. Fixed, not the window height: the spine hangs from the top of the
// screen rather than filling it, and a rotated line needs a stated length or it wraps. Holds
// "TOMO TV 10.10.10" at this size with room to spare, and the text is set flush to its start.
const BRAND_RUN = 170;

// How far below the safe-area top the spine begins.
const BRAND_SPINE_TOP = 0;

/**
 * Oversized, faint rendering of a name. Editorial watermark, purely ambient: never
 * intercepts focus or touch.
 *
 * - "panel" (default): huge, top-right, clipped by the screen corner so the last letters bleed
 *   off. The Filters panel's dead space.
 * - "header": smaller, right-aligned and top-anchored so it runs DOWN out of the folder header
 *   (never up into the tvOS tab bar). Meant to sit inside the LibraryHeader as its faint title.
 * - "vertical": a spine down the left edge, rotated so it reads bottom-to-top. Unlike the other
 *   two this one carries information (the caller appends the version), so it is set legibly
 *   rather than at watermark opacity, and it drops the white text-shadow the big crops use.
 * - "brand": the phone's mark, IN FLOW at the far end of a screen title's row and sitting on its
 *   baseline. Small: it labels the app, it doesn't head the screen. The row's height comes from
 *   the title, so this adds nothing to it and pushes nothing down. For LANDSCAPE, where the row
 *   has width to spare.
 * - "brandSpine": the same mark for PORTRAIT, turned down the left edge of the screen, where a
 *   portrait phone has a free margin and the title row does not have the width. Reads
 *   bottom-to-top, the small counterpart to the tvOS "vertical" spine.
 *
 * CALLER CONSTRAINT: render this BEFORE any focusable sibling. Siblings paint in order, and on
 * tvOS a view drawn above a focusable occludes it — the focus engine refuses to enter and
 * pointerEvents cannot opt out.
 */
export function FiltersGhostTitle({ name, variant = "panel" }: { name: string; variant?: GhostVariant }) {
  // Unconditional: hooks cannot be called behind a variant check. Only "vertical" reads them.
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const label = name.trim();
  if (!label) return null;

  const isVertical = variant === "vertical";
  const wrapStyle =
    variant === "header"
      ? styles.wrapHeader
      : variant === "brand"
        ? styles.wrapBrand
        : variant === "brandSpine"
          ? // Hangs from the top of the content area, clear of the notch in either orientation,
            // then BRAND_SPINE_TOP further down so the run starts below the screen title rather
            // than beside it.
            [styles.wrapBrandSpine, { top: insets.top + BRAND_SPINE_TOP, left: insets.left }]
          : isVertical
            ? [styles.wrapVertical, { left: insets.left }]
            : styles.wrapPanel;
  // A rotated run needs an explicit length or it wraps: give it the screen height, which is
  // exactly how far it can travel once turned, and centre the text along it.
  const textStyle =
    variant === "header"
      ? styles.textHeader
      : variant === "brand"
        ? styles.textBrand
        : variant === "brandSpine"
          ? [styles.textBrand, styles.textBrandSpine]
          : isVertical
            ? [styles.textVertical, { width: height }]
            : styles.textPanel;

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.wrap, wrapStyle]}>
      <Text style={[styles.text, textStyle]} numberOfLines={1} allowFontScaling={false}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Right edge pushed off-screen so the word runs leftward and its tail clips against the edge.
  // No `left`, so it sizes to the text.
  wrap: {
    position: "absolute",
  },
  wrapPanel: {
    top: IS_TV ? -3 : 92,
    right: IS_TV ? 15 : 16,
  },
  // Top-anchored: the oversized name spills DOWNWARD from the header row, away from the tab bar.
  wrapHeader: {
    top: IS_TV ? -20 : -12,
    right: IS_TV ? 94 : -24,
  },
  // Full-height band at the left edge. The rotated line is far wider than the band before it
  // turns, so it overflows evenly on both sides and stays centred on the band's mid-line —
  // which is what puts the spine where the band is without measuring the text.
  wrapVertical: {
    top: 0,
    bottom: 0,
    width: SPINE_FONT_SIZE * 1.15,
    justifyContent: "center",
    alignItems: "center",
  },
  // The only variant that takes part in layout, so it undoes the shared absolute positioning.
  // The row bottom-aligns margin boxes and the title carries a 4pt bottom margin of its own, so
  // this keeps 1 back: a 13pt run has ~3pt less descender than a 28pt one, and that difference is
  // what would otherwise leave it floating above the title's baseline.
  // flexShrink lets the mark ellipsize on a narrow screen instead of shouldering the title aside.
  wrapBrand: {
    position: "relative",
    marginBottom: 1,
    flexShrink: 1,
  },
  // A band at the LEFT edge, one run tall rather than the full screen. The box is centred inside
  // it, which is what makes the rotation land square: a turn happens about the element's centre,
  // so a box whose centre is the band's centre sweeps out exactly the band.
  wrapBrandSpine: {
    width: BRAND_FONT_SIZE * 1.6,
    height: BRAND_RUN,
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    fontWeight: "900",
    color: "rgba(255, 195, 18, 0.01)",
    textShadowColor: "rgba(255, 255, 255, 0.08)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  textPanel: {
    fontSize: IS_TV ? 300 : 132,
    lineHeight: IS_TV ? 300 : 132,
    letterSpacing: IS_TV ? -8 : -3,
  },
  textHeader: {
    fontSize: IS_TV ? 120 : 60,
    lineHeight: IS_TV ? 120 : 60,
    letterSpacing: IS_TV ? -4 : -2,
    transform: [{ translateY: -14 }],
    textShadowColor: "rgba(255, 255, 255, 0.01)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  // No lineHeight: the natural leading is what keeps this on the title's baseline, since the
  // title doesn't pin one either. Positive tracking, unlike the big crops — those are display
  // sizes where tightening stops them sprawling; this run is short and wants air between caps.
  //
  // The white shadow is the engraved effect: a light edge falling down-right off dark type is
  // what the eye reads as cut into the surface. Text has no real inset shadow to draw, so this
  // is the same trick the crops use, held tighter (their 2/4 spreads past a letter this size).
  textBrand: {
    fontSize: BRAND_FONT_SIZE,
    letterSpacing: 0.3,
    color: "rgba(255, 196, 18, 0.57)",
    textShadowColor: "rgba(36, 217, 57, 0.16)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1.5,
  },
  // -90deg reads bottom-to-top with the letter tops facing the screen edge, the hand a left-edge
  // spine takes and the same one the tvOS spine below uses. Flush right, which under that turn is
  // flush TOP: the run ends at the band's top edge, so the version finishes beside the screen
  // title rather than trailing off mid-band.
  textBrandSpine: {
    width: BRAND_RUN,
    textAlign: "right",
    transform: [{ rotate: "-90deg" }],
  },
  // -90deg reads bottom-to-top, the usual direction for a left-edge spine. Set at a real opacity
  // and with the shadow removed: this one has to be read, not just felt, because the version
  // rides in it. The shadow is what makes the big crops look grubby at close range anyway.
  textVertical: {
    fontSize: SPINE_FONT_SIZE,
    lineHeight: SPINE_FONT_SIZE,
    letterSpacing: -2,
    textAlign: "center",
    color: "rgba(255, 195, 18, 0.1)",
    textShadowColor: "transparent",
    transform: [{ rotate: "-90deg" }],
  },
});
