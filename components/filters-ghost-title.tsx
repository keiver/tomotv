import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

type GhostVariant = "panel" | "header" | "vertical" | "brand";

// The spine's own band. Wide enough to hold the rotated line, no wider.
const SPINE_FONT_SIZE = 90;

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
 * - "brand": the phone's stand-in for that spine, which a phone has no room for — one horizontal
 *   line, right-aligned above a screen title. IN FLOW, not absolute like the other three: it is a
 *   masthead the title is laid out under, not a wash behind it. Sized to fit the longest label
 *   ("TOMO TV 10.10.10") on a 320pt screen, and set brighter than the spine because a phone shows
 *   it at a third the size — it is the app's only version display.
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
  const wrapStyle = variant === "header" ? styles.wrapHeader : variant === "brand" ? styles.wrapBrand : isVertical ? [styles.wrapVertical, { left: insets.left }] : styles.wrapPanel;
  // The run needs an explicit length or it wraps: give it the screen height, which is exactly how
  // far it can travel once rotated, and centre the text along it.
  const textStyle = variant === "header" ? styles.textHeader : variant === "brand" ? styles.textBrand : isVertical ? [styles.textVertical, { width: height }] : styles.textPanel;

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
  wrapBrand: {
    position: "relative",
    alignSelf: "flex-end",
  },
  text: {
    fontWeight: "900",
    color: "rgba(255, 195, 18, 0.02)",
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
    textShadowColor: "rgba(255, 255, 255, 0.08)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  // 34pt keeps the longest label inside the narrowest phone (320pt less the grid's 20pt edges,
  // at ~0.62em per character of this face). No shadow, for the reason on textVertical.
  textBrand: {
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
    textAlign: "right",
    color: "rgba(255, 195, 18, 0.35)",
    textShadowColor: "transparent",
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
