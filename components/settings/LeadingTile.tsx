import { POSTER_MARK_SIDE } from "@/components/settings/styles";
import { ReactNode, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, View } from "react-native";

/**
 * The column a row's leading mark sits in: one width on every row, and as tall as the text
 * column beside it so the mark centres on both lines. Measure the column with useTileHeight.
 */
export function LeadingTile({ height, children }: { height: number; children: ReactNode }) {
  return <View style={[styles.tile, { height }]}>{children}</View>;
}

/** One glyph size on every row, well inside the text's cap and baseline. TV carries a larger share: it is read from across a room. */
export const GLYPH_SIZE = Math.round(POSTER_MARK_SIDE * (Platform.isTV ? 0.7 : 0.6));

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
  tile: {
    width: POSTER_MARK_SIDE,
    alignItems: "center",
    justifyContent: "center",
  },
});
