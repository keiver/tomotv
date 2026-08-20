import { ArtworkSlotShape, gridEdgePadding, slotCardPadding, slotRowHeights } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import React, { ReactElement, useCallback, useMemo } from "react";
import { FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const CARD_PADDING = slotCardPadding(IS_TV);
// Extra room around the list so the focused card's glow isn't clipped at the
// FlatList bounds; negative margins cancel it out so the layout doesn't move.
const GLOW_PAD = IS_TV ? 24 : 12;

interface MediaShelfProps<T> {
  title: string;
  data: readonly T[];
  /** The item's snapped card shape — decides its height in the row (see slotRowHeights). */
  slotShapeFor: (item: T) => ArtworkSlotShape;
  /** cardHeight is the item's own shape height; the card derives its width from it. */
  renderItem: (item: T, index: number, cardHeight: number) => ReactElement;
  keyExtractor: (item: T) => string;
}

/**
 * One horizontal shelf of the home screen: heading plus a card carousel of mixed-shape
 * cards (see fitArtwork on the card components). ONE height per row, never uneven: the row
 * takes the tallest shape present in its data and EVERY card renders at that height — wide
 * cards in a poster row grow to match. An all-wide row stays at the wide height. Purely
 * presentational — data loading, press routing and focus side effects belong to the wrapper
 * that instantiates it. Renders null with no items so empty shelves collapse.
 */
export function MediaShelf<T>({ title, data, slotShapeFor, renderItem, keyExtractor }: MediaShelfProps<T>) {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const heights = useMemo(() => slotRowHeights(windowWidth, insets.left, insets.right, IS_TV), [windowWidth, insets.left, insets.right]);

  // The tallest shape actually present rules the row; every card matches it.
  const rowHeight = useMemo(() => data.reduce((max, item) => Math.max(max, heights[slotShapeFor(item)]), 0), [data, heights, slotShapeFor]);

  const renderListItem = useCallback(({ item, index }: { item: T; index: number }) => renderItem(item, index, rowHeight), [renderItem, rowHeight]);

  // Edge bleed: the host screen wraps shelves in its content padding, which would clip
  // scrolling cards at the padded boundary. Negative margins push the list out to the
  // physical screen edges; the same padding moves inside the list's content so resting
  // cards still align to the screen's grid margin.
  const edgeLeft = gridEdgePadding(insets.left, IS_TV);
  const edgeRight = gridEdgePadding(insets.right, IS_TV);
  const rowAreaStyle = useMemo(() => ({ height: rowHeight + 2 * GLOW_PAD, marginVertical: -GLOW_PAD, marginLeft: -edgeLeft, marginRight: -edgeRight }), [rowHeight, edgeLeft, edgeRight]);
  const rowContentStyle = useMemo(() => ({ paddingVertical: GLOW_PAD, paddingLeft: edgeLeft, paddingRight: edgeRight }), [edgeLeft, edgeRight]);

  if (data.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{title}</Text>
      </View>
      {/* Fixed height keeps the layout stable while a focus-triggered reload swaps items. */}
      <View style={rowAreaStyle}>
        <FlatList
          data={data as T[]}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews={false}
          contentContainerStyle={rowContentStyle}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The bottom margin is the gap to the next shelf's heading.
  container: {
    marginBottom: IS_TV ? 30 : 10,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: CARD_PADDING,
    marginBottom: 0,
  },
  // One rank of type for every shelf heading on the screen: uppercase mono, an editorial
  // section marker rather than a display title. Menlo ships on iOS/tvOS.
  heading: {
    fontSize: IS_TV ? 45 : 22,
    lineHeight: IS_TV ? 48 : 25,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 1,
    width: "auto",
    overflow: "visible",
    // 80% via the color's alpha, not `opacity`, so the shadow keeps its own strength.
    color: "white",
    opacity: 0.96,
    textShadowColor: COLORS.TEXT_SHADOW,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: IS_TV ? 1 : 1,
  },
});
