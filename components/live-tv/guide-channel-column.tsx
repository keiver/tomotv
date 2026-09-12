import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import type { GuideMetrics } from "@/utils/guide";
import { Image } from "expo-image";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { type AnimatedRef } from "react-native-reanimated";

const IS_TV = Platform.isTV;

interface GuideChannelColumnProps {
  channels: JellyfinItem[];
  metrics: GuideMetrics;
  /** Driven from the grid's scroll handler on the UI thread; never scrolled by hand. */
  listRef: AnimatedRef<Animated.FlatList<JellyfinItem>>;
  /** The corner above the column, level with the ruler. */
  dayLabel: string;
  /** The grid list's measured height, so both lists scroll the same span. */
  listHeight: number;
}

/**
 * Channel numbers, logos and names beside the canvas. A sibling to the LEFT of the scroll view,
 * never above it: nothing here is focusable and nothing here may cover a cell.
 */
export function GuideChannelColumn({ channels, metrics, listRef, dayLabel, listHeight }: GuideChannelColumnProps) {
  const renderItem = useCallback(
    ({ item }: { item: JellyfinItem }) => (
      <View style={[styles.channel, { height: metrics.rowHeight }]}>
        {item.ChannelNumber ? (
          <Text style={styles.number} numberOfLines={1}>
            {item.ChannelNumber}
          </Text>
        ) : null}
        {hasPoster(item) ? <Image source={{ uri: getPosterUrl(item.Id, IS_TV ? 120 : 60) }} style={styles.logo} contentFit="contain" transition={150} /> : null}
        <Text style={styles.name} numberOfLines={2}>
          {item.Name}
        </Text>
      </View>
    ),
    [metrics.rowHeight],
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
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={!IS_TV}
        windowSize={5}
        style={{ height: listHeight }}
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
    color: COLORS.ACCENT,
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
  },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 14 : 8,
    paddingLeft: IS_TV ? 8 : 6,
    paddingRight: IS_TV ? 14 : 8,
  },
  number: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
    minWidth: IS_TV ? 44 : 26,
  },
  logo: {
    width: IS_TV ? 64 : 36,
    height: IS_TV ? 44 : 26,
  },
  name: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 21 : 13,
    fontWeight: "600",
    flexShrink: 1,
  },
});
