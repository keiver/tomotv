import { MediaShelf, ShelfHeading } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { shelfSpacing, slotCardPadding, slotRowHeights, type ArtworkSlotShape } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { useActiveTimers } from "@/hooks/useRecordingStatus";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { programRecording } from "@/utils/guide";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// One pinned shape: the row keeps one height in every state (pending, empty, cards), so cards
// landing late never move the grid below. TV's row heights are converged anyway; this pins the
// phone's too.
const SLOT_SHAPE: ArtworkSlotShape = "landscape";
const slotShapeFor = () => SLOT_SHAPE;
const keyFor = (item: JellyfinVideoItem) => item.Id;

/**
 * Live TV matches above the search grid: channels, then programmes on now, then later ones.
 * On a server with Live TV the row is reserved from the first paint: a heading with a spinner
 * while tiers are due, the cards, or a quiet no-matches line, all at the same fixed height.
 */
export function LiveTvSearchShelf({ items, pending = false }: { items: readonly JellyfinVideoItem[]; pending?: boolean }) {
  const openItem = useOpenShelfItem();
  const open = useCallback((item: JellyfinVideoItem) => openItem(item as JellyfinItem), [openItem]);
  const openInfoPanel = useItemLongPress();
  const longPress = useCallback((item: JellyfinVideoItem) => openInfoPanel(item as JellyfinItem), [openInfoPanel]);
  const timers = useActiveTimers();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const renderItem = useCallback(
    (item: JellyfinVideoItem, index: number, cardHeight: number) => (
      <VideoGridItem
        video={item}
        onPress={open}
        onLongPress={longPress}
        index={index}
        cardHeight={cardHeight}
        fitArtwork
        slotOrientation="landscape"
        recording={programRecording(timers, item, Date.now())}
      />
    ),
    [open, longPress, timers],
  );
  if (items.length === 0) {
    // Same numbers MediaShelf renders with, so the two states occupy identical space.
    const rowHeight = slotRowHeights(windowWidth, windowHeight, insets.left, insets.right, Platform.isTV)[SLOT_SHAPE];
    const spacing = shelfSpacing(Platform.isTV, windowWidth, windowHeight);
    return (
      <View style={{ marginBottom: spacing.rowGap }}>
        <ShelfHeading title={t("liveTv.title")} pending={pending} />
        <View style={[styles.emptyRow, { height: rowHeight }]}>{!pending && <Text style={styles.emptyText}>{t("search.noLiveTvMatches")}</Text>}</View>
      </View>
    );
  }
  return <MediaShelf title={t("liveTv.title")} pending={pending} data={items} slotShapeFor={slotShapeFor} renderItem={renderItem} keyExtractor={keyFor} />;
}

const styles = StyleSheet.create({
  emptyRow: {
    justifyContent: "center",
    paddingLeft: slotCardPadding(Platform.isTV),
  },
  emptyText: {
    fontSize: Platform.isTV ? 24 : 15,
    color: COLORS.TEXT_SECONDARY,
  },
});
