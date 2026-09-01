import { POSTER_MARK_SIDE } from "@/components/settings/styles";
import { ReactNode, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";

/**
 * The square a row's leading mark sits in, sized to the text column beside it so it
 * spans both lines. Floored at the Downloads poster's side, which is what makes a
 * one-line row stand as tall as a two-line one. Measure the column with useTileSide.
 */
export function LeadingTile({ side, children }: { side: number; children: ReactNode }) {
  return <View style={[styles.tile, { width: side, height: side }]}>{children}</View>;
}

/** A glyph drawn in the tile: four fifths of the side, so its strokes sit inside the text's cap and baseline. */
export function glyphSize(side: number): number {
  return Math.round(side * 0.8);
}

/** The tile's side and the onLayout that measures it off the text column, once. */
export function useTileSide(): [number, (event: LayoutChangeEvent) => void] {
  const [side, setSide] = useState(POSTER_MARK_SIDE);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.max(POSTER_MARK_SIDE, Math.round(event.nativeEvent.layout.height));
    if (next !== side) setSide(next);
  };
  return [side, onLayout];
}

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    justifyContent: "center",
  },
});
