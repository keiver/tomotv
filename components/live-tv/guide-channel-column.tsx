import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { VideoGridItem } from "@/components/video-grid-item";
import { COLORS } from "@/constants/colors";
import type { JellyfinItem } from "@/types/jellyfin";
import type { GuideMetrics } from "@/utils/guide";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { type AnimatedRef, type ScrollHandlerProcessed } from "react-native-reanimated";

const IS_TV = Platform.isTV;

interface GuideChannelColumnProps {
  channels: JellyfinItem[];
  metrics: GuideMetrics;
  /** The grid scrolls this list while the grid is the one moving, and this handler scrolls the grid back. */
  listRef: AnimatedRef<Animated.FlatList<JellyfinItem>>;
  onScroll: ScrollHandlerProcessed;
  /** The corner above the column, level with the ruler. */
  dayLabel: string;
  /** The grid list's measured height, so both lists scroll the same span. */
  listHeight: number;
  /** Bottom padding under the last channel so the tab bar never covers it. */
  contentBottomPad: number;
  onChannelPress: (channel: JellyfinItem) => void;
  onChannelFocus?: () => void;
  onEndReached?: () => void;
}

/**
 * One video card per channel beside the canvas, each one tuning its channel on select. The card
 * is the row's height (guideMetrics). A sibling to the LEFT of the scroll view, never above it.
 */
export function GuideChannelColumn({ channels, metrics, listRef, onScroll, dayLabel, listHeight, contentBottomPad, onChannelPress, onChannelFocus, onEndReached }: GuideChannelColumnProps) {
  // The wrapper is the row: exactly rowHeight, so the column never drifts off the grid's rows,
  // and the TV snap target, so a focused card lands its row on the list's top edge.
  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinItem; index: number }) => (
      <View style={{ height: metrics.rowHeight, justifyContent: "center" }} scrollSnapAlign={IS_TV ? "start" : undefined}>
        <VideoGridItem video={item} index={index} cardWidth={metrics.channelColumnWidth} slotOrientation="landscape" hideAiring onPress={onChannelPress} onItemFocus={onChannelFocus} />
      </View>
    ),
    [metrics.rowHeight, metrics.channelColumnWidth, onChannelPress, onChannelFocus],
  );
  const getItemLayout = useCallback(
    (_data: ArrayLike<JellyfinItem> | null | undefined, index: number) => ({ length: metrics.rowHeight, offset: metrics.rowHeight * index, index }),
    [metrics.rowHeight],
  );

  return (
    <View style={[styles.column, { width: metrics.channelColumnWidth }]}>
      <View style={[styles.corner, { height: metrics.rulerHeight }]}>
        <Text style={styles.cornerLabel} numberOfLines={1}>
          {dayLabel}
        </Text>
      </View>
      <Animated.FlatList
        ref={listRef}
        data={channels}
        renderItem={renderItem}
        keyExtractor={(item) => item.Id}
        getItemLayout={getItemLayout}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={onEndReached}
        onEndReachedThreshold={1}
        showsVerticalScrollIndicator={false}
        snapToAlignment={IS_TV ? "item" : undefined}
        removeClippedSubviews={!IS_TV}
        windowSize={5}
        style={{ height: listHeight }}
        contentContainerStyle={{ paddingBottom: contentBottomPad }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    borderRightWidth: 1,
    borderRightColor: GRID_LINE,
  },
  corner: {
    justifyContent: "flex-end",
    paddingBottom: IS_TV ? 10 : 6,
    paddingLeft: IS_TV ? 8 : 6,
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
  },
  cornerLabel: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
  },
});
