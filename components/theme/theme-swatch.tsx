import { GLYPH_INK } from "@/components/settings/LeadingTile";
import React from "react";
import { StyleSheet, View } from "react-native";

/** A theme's colour as a ListRow's leading mark, ringed in the row's ink so a matching focus fill cannot swallow it. */
export function ThemeSwatch({ color, ring }: { color: string; ring: string }) {
  return <View style={[styles.swatch, { backgroundColor: color, borderColor: ring }]} accessibilityElementsHidden />;
}

const styles = StyleSheet.create({
  swatch: {
    width: GLYPH_INK,
    height: GLYPH_INK,
    borderRadius: GLYPH_INK / 2,
    borderWidth: 2,
  },
});
