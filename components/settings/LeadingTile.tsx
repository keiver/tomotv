import { POSTER_MARK_SIDE } from "@/components/settings/styles";
import { Ionicons } from "@expo/vector-icons";
import { ReactNode, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, View } from "react-native";

/**
 * The column a row's leading mark sits in: one width on every row, and as tall as the text
 * column beside it so the mark centres on both lines. Measure the column with useTileHeight.
 */
export function LeadingTile({ height, children }: { height: number; children: ReactNode }) {
  return (
    <View style={[styles.tile, { height }]} collapsable={false}>
      {children}
    </View>
  );
}

/** The square every row glyph's ink fills. TV carries a larger share: it is read from across a room. */
export const GLYPH_INK = Math.round(POSTER_MARK_SIDE * (Platform.isTV ? 0.6 : 0.57));

// Each glyph's ink as a share of its em, the larger of width and height, read off Ionicons.ttf.
// Unlisted glyphs count as full-em.
const INK_SHARE: Partial<Record<keyof typeof Ionicons.glyphMap, number>> = {
  wifi: 1,
  desktop: 0.938,
  people: 0.936,
  "people-outline": 0.936,
  pulse: 0.877,
  "document-text": 0.875,
  "add-circle": 0.812,
  "add-circle-outline": 0.812,
  "close-circle": 0.812,
  "log-out": 0.812,
};

/** Font size that draws this glyph's ink at GLYPH_INK, so a wide wifi and a small circle read as one size. */
export function glyphSize(name: keyof typeof Ionicons.glyphMap): number {
  return Math.round(GLYPH_INK / (INK_SHARE[name] ?? 1));
}

/** The tile's height and the onLayout that measures it off the text column, once. */
export function useTileHeight(): [number, (event: LayoutChangeEvent) => void] {
  const [height, setHeight] = useState(POSTER_MARK_SIDE);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.max(POSTER_MARK_SIDE, Math.round(event.nativeEvent.layout.height));
    if (next !== height) setHeight(next);
  };
  return [height, onLayout];
}

const styles = StyleSheet.create({
  // Descenders hang the text column's visual mass a few points under its box centre; the mark follows it.
  tile: {
    width: POSTER_MARK_SIDE,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: 3 }],
  },
});
