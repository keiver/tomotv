import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideChannelTile } from "@/components/live-tv/guide-channel-tile";
import { COLORS } from "@/constants/colors";
import { setLiveFrameViewable } from "@/services/liveFrames";
import type { JellyfinItem } from "@/types/jellyfin";
import type { GuideMetrics } from "@/utils/guide";
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View, type ViewToken } from "react-native";
import Animated, { type AnimatedRef, Extrapolation, interpolate, type ScrollHandlerProcessed, type SharedValue, useAnimatedStyle } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** Any visible pixel counts, held a beat so a fling past a row never asks for its frame. */
const VIEWABILITY = { viewAreaCoveragePercentThreshold: 0, minimumViewTime: 300 };

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
  /** The column's live width, driven by the resize handle; fixed at the metric on TV. */
  columnWidth: SharedValue<number>;
  /** Phone: the left magnet holds the column, and the tile takes the card's presses. */
  compact: boolean;
  onChannelPress: (channel: JellyfinItem) => void;
  onChannelFocus?: () => void;
  onEndReached?: () => void;
}

/**
 * One video card per channel beside the canvas, each one tuning its channel on select. The card
 * is the row's height (guideMetrics). A sibling to the LEFT of the scroll view, never above it.
 */
export function GuideChannelColumn({
  channels,
  metrics,
  listRef,
  onScroll,
  dayLabel,
  listHeight,
  contentBottomPad,
  columnWidth,
  compact,
  onChannelPress,
  onChannelFocus,
  onEndReached,
}: GuideChannelColumnProps) {
  // The wrapper is the row: exactly rowHeight, so the column never drifts off the grid's rows,
  // and the TV snap target, so a focused card lands its row on the list's top edge.
  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinItem; index: number }) => (
      <View style={{ height: metrics.rowHeight, justifyContent: "center" }} scrollSnapAlign={IS_TV ? "start" : undefined}>
        {IS_TV ? (
          <GuideChannelCard channel={item} index={index} width={metrics.channelColumnWidth} onPress={onChannelPress} onFocus={onChannelFocus} />
        ) : (
          <ChannelMorph channel={item} index={index} metrics={metrics} columnWidth={columnWidth} compact={compact} onPress={onChannelPress} />
        )}
      </View>
    ),
    [metrics, columnWidth, compact, onChannelPress, onChannelFocus],
  );
  // The rows in view plus the one below feed the live frame sampler. The list keeps the first
  // viewability callback it is given, so the channels reach it through a ref.
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<JellyfinItem>[] }) => {
    const ids = viewableItems.filter((token) => token.isViewable && token.index !== null).map((token) => token.item.Id);
    const last = viewableItems.reduce((max, token) => Math.max(max, token.index ?? -1), -1);
    const lookahead = channelsRef.current[last + 1];
    if (lookahead) ids.push(lookahead.Id);
    setLiveFrameViewable(ids);
  }, []);
  useEffect(() => () => setLiveFrameViewable([]), []);
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
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        showsVerticalScrollIndicator={false}
        snapToAlignment={IS_TV ? "item" : undefined}
        removeClippedSubviews={!IS_TV}
        windowSize={5}
        style={{ height: listHeight }}
        contentContainerStyle={{ paddingBottom: contentBottomPad }}
      />
    </Animated.View>
  );
}

/**
 * Phone: the card and the logo tile share the row, and the column's live width picks between
 * them on the UI thread. Dragging in shrinks and fades the card out from its left edge while
 * the tile grows in; the magnet's `compact` decides which of the two takes the press.
 */
function ChannelMorph({
  channel,
  index,
  metrics,
  columnWidth,
  compact,
  onPress,
}: {
  channel: JellyfinItem;
  index: number;
  metrics: GuideMetrics;
  columnWidth: SharedValue<number>;
  compact: boolean;
  onPress: (channel: JellyfinItem) => void;
}) {
  const range = [metrics.compactColumnWidth, metrics.channelColumnWidth];
  const cardStyle = useAnimatedStyle(() => {
    const t = interpolate(columnWidth.get(), range, [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ scale: 0.8 + 0.2 * t }] };
  });
  const tileStyle = useAnimatedStyle(() => {
    const t = interpolate(columnWidth.get(), range, [0, 1], Extrapolation.CLAMP);
    return { opacity: 1 - t, transform: [{ scale: 1 + 0.4 * t }] };
  });
  return (
    <>
      <Animated.View style={[styles.cardLayer, cardStyle]} pointerEvents={compact ? "none" : "auto"}>
        <GuideChannelCard channel={channel} index={index} width={metrics.channelColumnWidth} onPress={onPress} />
      </Animated.View>
      <Animated.View style={[styles.tileLayer, { width: metrics.compactColumnWidth }, tileStyle]} pointerEvents={compact ? "auto" : "none"}>
        <GuideChannelTile channel={channel} metrics={metrics} onPress={onPress} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  // Phone draws the seam in the resize divider so the grip sits on it; TV keeps its own border.
  column: {
    borderRightWidth: IS_TV ? 1 : 0,
    borderRightColor: GRID_LINE,
    overflow: "hidden",
  },
  // The card keeps its full width and is clipped by the column as it narrows; it shrinks from its left edge.
  cardLayer: {
    transformOrigin: "left center",
  },
  // Flush with the column's right edge, where the card meets its row.
  tileLayer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
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
