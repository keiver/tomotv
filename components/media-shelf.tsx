import { gridEdgePadding, slotRatio, SlotOrientation } from "@/constants/app";
import React, { ReactElement, useCallback, useMemo } from "react";
import { FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 6;
// Extra room around the list so the focused card's glow isn't clipped at the
// FlatList bounds; negative margins cancel it out so the layout doesn't move.
const GLOW_PAD = IS_TV ? 24 : 12;

/**
 * Cards per screen width, owned by the shelf rather than borrowed from the grid: the grid's
 * phone-portrait count (2) sizes cards for a two-column wall, which in a carousel reads as
 * half-screen posters. 3 keeps the phone carousel dense enough to promise more content.
 */
const SHELF_COLUMNS: Record<SlotOrientation, number> = {
  landscape: IS_TV ? 4 : 2,
  portrait: IS_TV ? 6 : 3,
};

/**
 * Card size derived like a grid column so shelves land on the grid's column boundaries.
 * The shelf lives inside the screen's horizontal padding, so it divides the same
 * window-minus-edge-padding. Height is deterministic so the row's space is reserved up
 * front and no layout jump happens when async items land.
 */
function cardMetrics(windowWidth: number, insetLeft: number, insetRight: number, orientation: SlotOrientation) {
  const width = (windowWidth - gridEdgePadding(insetLeft, IS_TV) - gridEdgePadding(insetRight, IS_TV)) / SHELF_COLUMNS[orientation];
  return { width, height: Math.round((width - 2 * CARD_PADDING) / slotRatio(orientation) + 2 * CARD_PADDING) };
}

/** Per-row card dimensions: the uniform column width, and the row height mixed-shape cards share. */
export interface ShelfCardMetrics {
  cardWidth: number;
  cardHeight: number;
}

interface MediaShelfProps<T> {
  title: string;
  orientation: SlotOrientation;
  data: readonly T[];
  renderItem: (item: T, index: number, metrics: ShelfCardMetrics) => ReactElement;
  keyExtractor: (item: T) => string;
}

/**
 * One horizontal shelf of the home screen: heading plus a fixed-height card carousel.
 * Purely presentational — data loading, press routing and focus side effects belong to
 * the wrapper that instantiates it. Renders null with no items so empty shelves collapse.
 */
export function MediaShelf<T>({ title, orientation, data, renderItem, keyExtractor }: MediaShelfProps<T>) {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const { width: cardWidth, height: cardHeight } = useMemo(() => cardMetrics(windowWidth, insets.left, insets.right, orientation), [windowWidth, insets.left, insets.right, orientation]);

  const renderListItem = useCallback(({ item, index }: { item: T; index: number }) => renderItem(item, index, { cardWidth, cardHeight }), [renderItem, cardWidth, cardHeight]);

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
