import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideChannelTile } from "@/components/live-tv/guide-channel-tile";
import { COLORS } from "@/constants/colors";
import { useLiveFrameViewport } from "@/hooks/useLiveFrameViewport";
import { clearFocusedGuideChannel, setFocusedGuideChannel } from "@/services/guideChannelFocus";
import { clearLiveFrameFocus, setLiveFrameFocus } from "@/services/liveFrames";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { isFavoriteChannel, type LiveTvPreferences } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import type { GuideMetrics } from "@/utils/guide";
import React, { useCallback } from "react";
import { findNodeHandle, Platform, StyleSheet, View } from "react-native";
import Animated, { type AnimatedRef, Extrapolation, interpolate, type ScrollHandlerProcessed, type SharedValue, useAnimatedStyle } from "react-native-reanimated";

const IS_TV = Platform.isTV;
const channelIds = (channel: JellyfinItem) => [channel.Id];
const favoriteMark = (preferences: LiveTvPreferences, channel: JellyfinItem) => (isFavoriteChannel(preferences, channel) ? ("heart" as const) : undefined);

interface GuideChannelColumnProps {
  channels: JellyfinItem[];
  recordingChannelIds: Set<string>;
  metrics: GuideMetrics;
  /** The grid scrolls this list while the grid is the one moving, and this handler scrolls the grid back. */
  listRef: AnimatedRef<Animated.FlatList<JellyfinItem>>;
  onScroll: ScrollHandlerProcessed;
  /** The grid list's measured height, so both lists scroll the same span. */
  listHeight: number;
  /** TV: where a focus scroll lands the focused channel's top, the same as the grid's rows. */
  rowSnapOffset?: number;
  /** Bottom padding under the last channel so the tab bar never covers it. */
  contentBottomPad: number;
  /** The column's live width, driven by the resize handle; fixed at the metric on TV. */
  columnWidth: SharedValue<number>;
  /** Phone: the left magnet holds the column, and the tile takes the card's presses. */
  compact: boolean;
  onChannelPress: (channel: JellyfinItem) => void;
  /** A held card marks the channel a favorite, or unmarks it. */
  onChannelLongPress: (channel: JellyfinItem) => void;
  onChannelFocus?: () => void;
  /** TV: the first card's native node, the strip's way down into the guide (the canvas cells sit
      in a scrolled expanse the focus engine cannot enter geometrically). */
  onFirstHandle?: (handle: number | undefined) => void;
  onEndReached?: () => void;
}

/**
 * One video card per channel beside the canvas, each one tuning its channel on select. The card
 * is the row's height (guideMetrics). A sibling to the LEFT of the scroll view, never above it.
 */
export function GuideChannelColumn({
  channels,
  recordingChannelIds,
  metrics,
  listRef,
  onScroll,
  listHeight,
  rowSnapOffset,
  contentBottomPad,
  columnWidth,
  compact,
  onChannelPress,
  onChannelLongPress,
  onChannelFocus,
  onFirstHandle,
  onEndReached,
}: GuideChannelColumnProps) {
  const preferences = useLiveTvPreferences();
  const firstCardRef = useCallback(
    (node: React.ElementRef<typeof GuideChannelCard> | null) => {
      onFirstHandle?.(node ? (findNodeHandle(node) ?? undefined) : undefined);
    },
    [onFirstHandle],
  );
  // The row's cell wears the reel while its card holds focus; the canvas hears the focus too.
  const cardFocus = useCallback(
    (video: JellyfinItem) => {
      setFocusedGuideChannel(video.Id);
      setLiveFrameFocus(video.Id);
      onChannelFocus?.();
    },
    [onChannelFocus],
  );
  const cardBlur = useCallback((video: JellyfinItem) => {
    clearFocusedGuideChannel(video.Id);
    clearLiveFrameFocus(video.Id);
  }, []);
  // The wrapper is the row: exactly rowHeight, so the column never drifts off the grid's rows.
  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinItem; index: number }) => (
      <View style={{ height: metrics.rowHeight, justifyContent: "center" }} scrollSnapOffset={rowSnapOffset}>
        {IS_TV ? (
          <GuideChannelCard
            ref={index === 0 ? firstCardRef : undefined}
            channel={item}
            index={index}
            cardWidth={metrics.channelColumnWidth}
            hideAiring
            flat
            inset={metrics.cardInset}
            titleIcon={favoriteMark(preferences, item)}
            recording={recordingChannelIds.has(item.Id)}
            onPress={onChannelPress}
            onLongPress={onChannelLongPress}
            onItemFocus={cardFocus}
            onItemBlur={cardBlur}
          />
        ) : (
          <ChannelMorph
            channel={item}
            index={index}
            metrics={metrics}
            columnWidth={columnWidth}
            compact={compact}
            titleIcon={favoriteMark(preferences, item)}
            recording={recordingChannelIds.has(item.Id)}
            onPress={onChannelPress}
            onLongPress={onChannelLongPress}
          />
        )}
      </View>
    ),
    [metrics, rowSnapOffset, columnWidth, compact, preferences, recordingChannelIds, onChannelPress, onChannelLongPress, cardFocus, cardBlur, firstCardRef],
  );
  const { viewabilityConfig, onViewableItemsChanged } = useLiveFrameViewport("guide", preferences.autoUpdate, channels, channelIds);
  const getItemLayout = useCallback(
    (_data: ArrayLike<JellyfinItem> | null | undefined, index: number) => ({ length: metrics.rowHeight, offset: metrics.rowHeight * index, index }),
    [metrics.rowHeight],
  );

  const widthStyle = useAnimatedStyle(() => ({ width: columnWidth.get() }));

  return (
    <Animated.View style={[styles.column, widthStyle]}>
      <Animated.FlatList
        ref={listRef}
        data={channels}
        renderItem={renderItem}
        keyExtractor={(item) => item.Id}
        getItemLayout={getItemLayout}
        snapToAlignment={IS_TV ? "item" : undefined}
        snapToInterval={IS_TV ? metrics.rowHeight : undefined}
        // The interval snap rests a list past its content end; the mirror must reach the same offset.
        scrollToOverflowEnabled={IS_TV}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={onEndReached}
        onEndReachedThreshold={1}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={!IS_TV}
        maxToRenderPerBatch={4}
        updateCellsBatchingPeriod={16}
        windowSize={7}
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
  titleIcon,
  recording,
  onPress,
  onLongPress,
}: {
  channel: JellyfinItem;
  index: number;
  metrics: GuideMetrics;
  columnWidth: SharedValue<number>;
  compact: boolean;
  titleIcon?: "heart";
  recording: boolean;
  onPress: (channel: JellyfinItem) => void;
  onLongPress: (channel: JellyfinItem) => void;
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
        <GuideChannelCard
          channel={channel}
          index={index}
          cardWidth={metrics.channelColumnWidth}
          hideAiring
          flat
          inset={metrics.cardInset}
          titleIcon={titleIcon}
          recording={recording}
          onPress={onPress}
          onLongPress={onLongPress}
          playsClipInView={!compact}
        />
      </Animated.View>
      <Animated.View style={[styles.tileLayer, { width: metrics.compactColumnWidth }, tileStyle]} pointerEvents={compact ? "auto" : "none"}>
        <GuideChannelTile channel={channel} metrics={metrics} onPress={onPress} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  // The seam is drawn over the grid by the canvas (TV) or the resize divider (phone), since the grid reaches under it.
  column: {
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
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
  },
  cornerLabel: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  cornerHit: {
    alignSelf: "stretch",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
