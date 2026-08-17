import { slotCardPadding, slotRowCardHeight } from "@/constants/app";
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

  const cardHeight = useMemo(() => slotRowCardHeight(windowWidth, insets.left, insets.right, IS_TV), [windowWidth, insets.left, insets.right]);

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
