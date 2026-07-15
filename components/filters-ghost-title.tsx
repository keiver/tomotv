import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/**
 * Oversized, faint rendering of the library name set in the top-right dead space of the
 * Filters panel, clipped by the screen edge so the last letters bleed off. Editorial
 * watermark, purely ambient: sits behind the chips on the wash and changes per library.
 * Never intercepts focus or touch.
 */
export function FiltersGhostTitle({ name }: { name: string }) {
  const label = name.trim();
  if (!label) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Text style={styles.text} numberOfLines={1} allowFontScaling={false}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Anchored to the top-right with the right edge pushed off-screen, so the word runs
  // leftward and its tail clips against the screen edge. No `left`, so it sizes to the text.
  wrap: {
    position: "absolute",
    top: IS_TV ? -34 : -16,
    right: IS_TV ? -90 : -44,
  },
  text: {
    fontSize: IS_TV ? 300 : 132,
    lineHeight: IS_TV ? 300 : 132,
    fontWeight: "900",
    letterSpacing: IS_TV ? -8 : -3,
    color: "rgba(255, 195, 18, 0.06)",
  },
});
