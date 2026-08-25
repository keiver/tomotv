import { VideoGridItem } from "@/components/video-grid-item";
import { gridEdgePadding, itemSlotRatio, itemSlotShape, slotCardPadding, slotRowHeights } from "@/constants/app";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { isStrandedAboveLastRow, packArtworkRows, PackedRow } from "@/utils/artworkRows";
import { cardResumeProgress } from "@/utils/resumeProgress";
import React, { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { findNodeHandle, FlatList, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The card components' own outer padding, which the packer needs to size rows.
const CARD_PADDING = slotCardPadding(Platform.isTV);

/**
 * findNodeHandle is deprecated under Fabric, but react-native-tvos still has no replacement for
 * nextFocusUp/nextFocusDown.
 */
function getNativeHandle<T>(node: T | null): number | undefined {
  if (!node || !Platform.isTV) return undefined;
  return findNodeHandle(node as unknown as React.Component) ?? undefined;
}

export interface SearchResultsGridHandle {
  focusFirstCard: () => void;
}

interface SearchResultsGridProps {
  items: JellyfinVideoItem[];
  onItemPress: (item: JellyfinVideoItem) => void;
  onItemLongPress: (item: JellyfinVideoItem) => void;
  /** Up target for the top row, e.g. the search field. */
  nextFocusUpHandle?: number;
  /** Mount-time focus claim on the first card. Off where a native search field owns focus. */
  claimInitialFocus?: boolean;
  /** Reports the first card's native handle so a search field can name it as its Down target. */
  onFirstCardHandleChange?: (handle: number | undefined) => void;
  onEndReached?: () => void;
  ListFooterComponent?: React.ComponentType<unknown> | React.ReactElement | null;
  /**
   * Width the rows are packed against. Defaults to the window minus its edge padding; the native
   * search view passes the results region it measured, which is already inset.
   */
  availableWidth?: number;
  /** Horizontal padding inside the list. Zero where the host is already inset. */
  edgePadding?: number;
}

/**
 * The results grid shared by both search paths: the JS screen and the tvOS native search view,
 * which renders this as its child. One grid means the two can't drift apart.
 *
 * Mixed-shape JUSTIFIED rows: each card sized by its own artwork shape, each row scaled to
 * exactly fill the width. The list virtualizes ROWS, so its index space is rows.
 */
export const SearchResultsGrid = React.forwardRef<SearchResultsGridHandle, SearchResultsGridProps>(function SearchResultsGrid(
  { items, onItemPress, onItemLongPress, nextFocusUpHandle, claimInitialFocus = false, onFirstCardHandleChange, onEndReached, ListFooterComponent, availableWidth, edgePadding },
  ref,
) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const firstCardNodeRef = React.useRef<View | null>(null);
  const firstCardRef = useCallback(
    (node: View | null) => {
      firstCardNodeRef.current = node;
      onFirstCardHandleChange?.(getNativeHandle(node));
    },
    [onFirstCardHandleChange],
  );
  // Last card's native node: the Down target for cards stranded above a partial last row.
  const [lastCardHandle, setLastCardHandle] = useState<number | undefined>(undefined);
  const lastCardRef = useCallback((node: View | null) => setLastCardHandle(getNativeHandle(node)), []);
  // A single result is both the first and the last card; each role needs its own node.
  const firstAndLastCardRef = useCallback(
    (node: View | null) => {
      firstCardRef(node);
      lastCardRef(node);
    },
    [firstCardRef, lastCardRef],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusFirstCard: () => {
        if (!Platform.isTV) return;
        const tvNode = firstCardNodeRef.current as unknown as { requestTVFocus?: () => void } | null;
        tvNode?.requestTVFocus?.();
      },
    }),
    [],
  );

  // Edge padding subsumes the safe-area inset, so the packer's available width is exactly
  // what the list renders into (same derivation as the library grid). A host that is already
  // inset passes its own measured width and zero padding instead.
  const edgeLeft = edgePadding ?? gridEdgePadding(insets.left, Platform.isTV);
  const edgeRight = edgePadding ?? gridEdgePadding(insets.right, Platform.isTV);
  const contentWidth = availableWidth ?? windowWidth - edgeLeft - edgeRight;

  const rowHeights = useMemo(() => slotRowHeights(windowWidth, windowHeight, insets.left, insets.right, Platform.isTV, "grid"), [windowWidth, windowHeight, insets.left, insets.right]);
  const packedRows = useMemo(
    () => packArtworkRows(items, contentWidth, (item) => ({ ratio: itemSlotRatio(item.PrimaryImageAspectRatio), height: rowHeights[itemSlotShape(item.PrimaryImageAspectRatio)] }), CARD_PADDING),
    [items, contentWidth, rowHeights],
  );
  const lastRowWidth = packedRows.length > 0 ? packedRows[packedRows.length - 1].width : 0;
  // Global item index of each row's first card (drives image priority for the first cards).
  const rowStartIndices = useMemo(() => {
    const starts: number[] = [];
    let acc = 0;
    for (const row of packedRows) {
      starts.push(acc);
      acc += row.cards.length;
    }
    return starts;
  }, [packedRows]);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: PackedRow<JellyfinVideoItem>; index: number }) => {
      const isSecondToLastRow = rowIndex === packedRows.length - 2;
      const isLastRow = rowIndex === packedRows.length - 1;
      const rowStart = rowStartIndices[rowIndex] ?? 0;
      return (
        <View style={styles.rowWrapper}>
          {row.cards.map((card, cardIndex) => {
            const index = rowStart + cardIndex;
            const isLastCard = isLastRow && cardIndex === row.cards.length - 1;
            // A card above a ragged last row has no frame beneath it, so UIKit gives it no Down
            // candidate; it names the final card instead.
            const nextFocusDown = isSecondToLastRow && isStrandedAboveLastRow(card, lastRowWidth) ? lastCardHandle : undefined;
            const cardRef = index === 0 && isLastCard ? firstAndLastCardRef : index === 0 ? firstCardRef : isLastCard ? lastCardRef : undefined;
            return (
              <VideoGridItem
                key={card.item.Id}
                ref={cardRef}
                video={card.item}
                onPress={onItemPress}
                onLongPress={onItemLongPress}
                index={index}
                hasTVPreferredFocus={index === 0 && claimInitialFocus}
                nextFocusUp={rowIndex === 0 ? nextFocusUpHandle : undefined}
                nextFocusDown={nextFocusDown}
                cardHeight={card.cardHeight}
                fitArtwork
                progressPercent={cardResumeProgress(card.item)}
              />
            );
          })}
        </View>
      );
    },
    [onItemPress, onItemLongPress, claimInitialFocus, nextFocusUpHandle, firstCardRef, firstAndLastCardRef, lastCardRef, lastCardHandle, packedRows.length, rowStartIndices, lastRowWidth],
  );

  return (
    <FlatList
      data={packedRows}
      renderItem={renderRow}
      keyExtractor={(row) => row.cards[0].item.Id}
      contentContainerStyle={[styles.gridContent, { paddingLeft: edgeLeft, paddingRight: edgeRight }]}
      showsVerticalScrollIndicator={false}
      // List items are packed ROWS of ~3-4 cards, so the render counts are rows.
      initialNumToRender={Platform.isTV ? 8 : 6}
      maxToRenderPerBatch={Platform.isTV ? 8 : 6}
      windowSize={5}
      removeClippedSubviews={!Platform.isTV}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ListFooterComponent={ListFooterComponent}
    />
  );
});

const styles = StyleSheet.create({
  gridContent: {
    paddingBottom: Platform.isTV ? 120 : 100,
  },
  rowWrapper: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingVertical: Platform.isTV ? 24 : 6,
  },
});
