import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideChannelRow } from "@/components/live-tv/guide-channel-row";
import { COLORS } from "@/constants/colors";
import type { JellyfinItem } from "@/types/jellyfin";
import type { GuideMetrics } from "@/utils/guide";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { type AnimatedRef, type ScrollHandlerProcessed, type SharedValue, useAnimatedStyle } from "react-native-reanimated";

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
  /** The column's live width, driven by the resize handle; fixed at the metric on TV. */
  columnWidth: SharedValue<number>;
  /** Bottom padding under the last channel so the tab bar never covers it. */
  contentBottomPad: number;
  /** Collapsed to logos alone once the column is dragged to the left magnet. */
  compact: boolean;
  onChannelPress: (channel: JellyfinItem) => void;
  onChannelFocus?: () => void;
  onEndReached?: () => void;
}

/**
 * Channel numbers, logos and names beside the canvas, each one tuning its channel on select.
 * A sibling to the LEFT of the scroll view, never above it: nothing here may cover a cell.
 */
export function GuideChannelColumn({
  channels,
  metrics,
  listRef,
  onScroll,
  dayLabel,
  listHeight,
  columnWidth,
  contentBottomPad,
  compact,
  onChannelPress,
  onChannelFocus,
  onEndReached,
}: GuideChannelColumnProps) {
  const renderItem = useCallback(
    ({ item }: { item: JellyfinItem }) => <GuideChannelRow channel={item} height={metrics.rowHeight} compact={compact} onPress={onChannelPress} onFocus={onChannelFocus} />,
    [metrics.rowHeight, compact, onChannelPress, onChannelFocus],
  );
  const getItemLayout = useCallback(
    (_data: ArrayLike<JellyfinItem> | null | undefined, index: number) => ({ length: metrics.rowHeight, offset: metrics.rowHeight * index, index }),
    [metrics.rowHeight],
  );
  const widthStyle = useAnimatedStyle(() => ({ width: columnWidth.get() }));

  return (
    <Animated.View style={[styles.column, widthStyle]}>
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
        removeClippedSubviews={!IS_TV}
        windowSize={5}
        style={{ height: listHeight }}
        contentContainerStyle={{ paddingBottom: contentBottomPad }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Phone draws the seam in the resize divider so the grip sits on it; TV keeps its own border.
  column: {
    borderRightWidth: IS_TV ? 1 : 0,
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
