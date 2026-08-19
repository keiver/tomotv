import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

type GhostVariant = "panel" | "header" | "brand";

// Small on both: it labels the app, it doesn't head the screen. TV is bigger only because a
// couch is further away than a hand.
const BRAND_FONT_SIZE = IS_TV ? 22 : 13;

// Gap from each edge. A floor, not an addition to the safe-area inset — the same rule
// gridEdgePadding states for the grid, so tvOS overscan wins where it is larger and every other
// screen gets exactly 40.
const BRAND_EDGE_GAP = 40;

/**
 * Oversized, faint rendering of a name. Editorial watermark, purely ambient: never
 * intercepts focus or touch.
 *
 * - "panel" (default): huge, top-right, clipped by the screen corner so the last letters bleed
 *   off. The Filters panel's dead space.
 * - "header": smaller, right-aligned and top-anchored so it runs DOWN out of the folder header
 *   (never up into the tvOS tab bar). Meant to sit inside the LibraryHeader as its faint title.
 * - "brand": the app's mark, horizontal in the BOTTOM-RIGHT corner, 40pt off each edge. One
 *   placement for every platform and orientation, so the name is always in the same spot. Out of
 *   flow, so the content scrolls under it.
 *
 * CALLER CONSTRAINT: render this BEFORE any focusable sibling. Siblings paint in order, and on
 * tvOS a view drawn above a focusable occludes it — the focus engine refuses to enter and
 * pointerEvents cannot opt out.
 */
export function FiltersGhostTitle({ name, variant = "panel" }: { name: string; variant?: GhostVariant }) {
  // Unconditional: hooks cannot be called behind a variant check. Only "brand" reads it.
  const insets = useSafeAreaInsets();
  const label = name.trim();
  if (!label) return null;

  const wrapStyle =
    variant === "header" ? styles.wrapHeader : variant === "brand" ? [{ bottom: Math.max(insets.bottom, BRAND_EDGE_GAP), right: Math.max(insets.right, BRAND_EDGE_GAP) }] : styles.wrapPanel;
  const textStyle = variant === "header" ? styles.textHeader : variant === "brand" ? styles.textBrand : styles.textPanel;

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
});
