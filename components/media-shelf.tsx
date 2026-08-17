import { GRID, gridEdgePadding } from "@/constants/app";
import React, { ReactElement, useCallback, useMemo } from "react";
import { FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 6;
// Extra room around the list so the focused card's glow isn't clipped at the
// FlatList bounds; negative margins cancel it out so the layout doesn't move.
const GLOW_PAD = IS_TV ? 24 : 12;

/**
 * Posters per screen width — the anchor the whole row height derives from. Shelves hold
 * mixed-shape cards on one height, and the poster is the narrowest shape, so it is the one
 * that vanishes when the height is derived from the wide cards instead (a landscape-derived
 * row left posters at ~185pt on TV). 8 posters per TV screen puts a poster at the tvOS TV
 * app's own poster-row scale; wide cards inherit the height at ~3.3 per screen.
 */
function posterColumns(windowWidth: number): number {
  if (IS_TV) return 8;
  return windowWidth >= GRID.PHONE_WIDE_MIN_WIDTH ? 6 : 4;
}

/**
 * The shared row height: the height of a poster card at the anchor column width. The shelf
 * lives inside the screen's horizontal padding, so it divides the same window-minus-edge-
 * padding as the grids. Deterministic, so the row's space is reserved up front and no layout
 * jump happens when async items land.
 */
function rowCardHeight(windowWidth: number, insetLeft: number, insetRight: number): number {
  const posterWidth = (windowWidth - gridEdgePadding(insetLeft, IS_TV) - gridEdgePadding(insetRight, IS_TV)) / posterColumns(windowWidth);
  return Math.round((posterWidth - 2 * CARD_PADDING) / GRID.PORTRAIT_RATIO + 2 * CARD_PADDING);
}

interface MediaShelfProps<T> {
  title: string;
  data: readonly T[];
  /** cardHeight is the row's shared card height; each card derives its own width from it. */
  renderItem: (item: T, index: number, cardHeight: number) => ReactElement;
  keyExtractor: (item: T) => string;
}

/**
 * One horizontal shelf of the home screen: heading plus a fixed-height card carousel of
 * mixed-shape cards (see fitArtwork on the card components). Purely presentational — data
 * loading, press routing and focus side effects belong to the wrapper that instantiates it.
 * Renders null with no items so empty shelves collapse.
 */
export function MediaShelf<T>({ title, data, renderItem, keyExtractor }: MediaShelfProps<T>) {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const cardHeight = useMemo(() => rowCardHeight(windowWidth, insets.left, insets.right), [windowWidth, insets.left, insets.right]);

  const renderListItem = useCallback(({ item, index }: { item: T; index: number }) => renderItem(item, index, cardHeight), [renderItem, cardHeight]);

  if (data.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{title}</Text>
      </View>
      {/* Fixed height keeps the layout stable while a focus-triggered reload swaps items. */}
      <View style={[styles.rowArea, { height: cardHeight + 2 * GLOW_PAD }]}>
        <FlatList
          data={data as T[]}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews={false}
          contentContainerStyle={styles.rowContent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The bottom margin is the gap to the next shelf's heading.
  container: {
    marginBottom: IS_TV ? 32 : 24,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: CARD_PADDING,
    marginBottom: IS_TV ? 12 : 8,
  },
  // One rank of type for every shelf heading on the screen.
  heading: {
    fontSize: IS_TV ? 56 : 28,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  rowArea: {
    // height is set inline (card height + glow padding, derived from the live window width)
    margin: -GLOW_PAD,
  },
  rowContent: {
    padding: GLOW_PAD,
  },
});
