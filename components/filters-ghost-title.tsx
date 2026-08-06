import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/**
 * Oversized, faint rendering of the library name clipped by a screen corner so the last
 * letters bleed off. Editorial watermark, purely ambient: changes per library and never
 * intercepts focus or touch.
 *
 * - "panel" (default): huge, top-right — the Filters panel's dead space.
 * - "header": smaller, right-aligned and top-anchored so it runs DOWN out of the folder header
 *   (never up into the tvOS tab bar). Meant to sit inside the LibraryHeader as its faint title.
 */
export function FiltersGhostTitle({ name, variant = "panel" }: { name: string; variant?: "panel" | "header" }) {
  const label = name.trim();
  if (!label) return null;

  const isHeader = variant === "header";

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.wrap, isHeader ? styles.wrapHeader : styles.wrapPanel]}>
      <Text style={[styles.text, isHeader ? styles.textHeader : styles.textPanel]} numberOfLines={1} allowFontScaling={false}>
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
});
