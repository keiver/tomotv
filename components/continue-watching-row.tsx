import { VideoGridItem } from "@/components/video-grid-item";
import { GRID, slotColumns, slotRatio } from "@/constants/app";
import { useLoading } from "@/contexts/LoadingContext";
import { clearResumePosition, fetchResumeItems } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const GRID_PADDING_H = (IS_TV ? GRID.SIDE_PADDING.tv : GRID.SIDE_PADDING.phone) + (IS_TV ? 40 : 20);
const CARD_PADDING = IS_TV ? 16 : 6;
// Extra room around the list so the focused card's glow isn't clipped at the
// FlatList bounds; negative margins cancel it out so the layout doesn't move.
const GLOW_PAD = IS_TV ? 24 : 12;

interface ResumeItem {
  video: JellyfinVideoItem;
  progressPercent: number; // 0–1
}

/**
 * Horizontal "Continue Watching" shelf shown at the top of the Library root.
 * Self-contained: loads the server's resume list on focus and renders nothing when
 * empty. Resume positions are server-side UserData (synced by playback reporting),
 * so the row matches every other Jellyfin client.
 */
export function ContinueWatchingRow() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [hasItems, setHasItems] = useState(false);
  const [items, setItems] = useState<ResumeItem[]>([]);

  // Mirror the Library grid sizing so shelf cards match a landscape grid column —
  // computed from the live window so the shelf reflows on rotation and per device,
  // exactly like the grid columns. Deterministic height so the row's space is
  // reserved up front and doesn't jump when the async metadata finishes loading.
  const numColumns = slotColumns("landscape", IS_TV, windowWidth);
  const cardWidth = (windowWidth - insets.left - insets.right - GRID_PADDING_H) / numColumns;
  const cardHeight = Math.round((cardWidth - 2 * CARD_PADDING) / slotRatio("landscape") + 2 * CARD_PADDING);

  // Reload each time the Library tab regains focus (e.g. after returning from the player).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        // null = transient failure, which must not hide a row that was showing items;
        // only a genuinely empty resume list collapses it.
        const resumeItems = await fetchResumeItems(20);
        if (cancelled || resumeItems === null) return;

        const merged: ResumeItem[] = resumeItems.map((video) => ({
          video,
          progressPercent: video.RunTimeTicks && video.RunTimeTicks > 0 ? (video.UserData?.PlaybackPositionTicks ?? 0) / video.RunTimeTicks : (video.UserData?.PlayedPercentage ?? 0) / 100,
        }));

        setItems(merged);
        setHasItems(merged.length > 0);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handlePress = useCallback(
    (video: JellyfinVideoItem) => {
      // Player resumes from saved progress (StartTimeTicks). Play standalone.
      showGlobalLoader();
      router.push({
        pathname: "/player" as const,
        params: { videoId: video.Id, videoName: video.Name },
      });
    },
    [showGlobalLoader, router],
  );

  const removeItem = useCallback(async (video: JellyfinVideoItem) => {
    // Optimistic removal; if the server call fails the item reappears on next focus
    setItems((prev) => {
      const next = prev.filter((entry) => entry.video.Id !== video.Id);
      setHasItems(next.length > 0);
      return next;
    });
    try {
      await clearResumePosition(video.Id);
    } catch (err) {
      logger.warn("Failed to remove continue watching item", err, { service: "ContinueWatching" });
    }
  }, []);

  const handleLongPress = useCallback(
    (video: JellyfinVideoItem) => {
      Alert.alert("Remove from Continue Watching?", video.Name || undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeItem(video) },
      ]);
    },
    [removeItem],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ResumeItem; index: number }) => (
      <VideoGridItem video={item.video} onPress={handlePress} onLongPress={handleLongPress} index={index} cardWidth={cardWidth} progressPercent={item.progressPercent} slotOrientation="landscape" />
    ),
    [handlePress, handleLongPress, cardWidth],
  );

  if (!hasItems) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Continue Watching</Text>
      </View>
      {/* Fixed height keeps the layout stable while a focus-triggered reload swaps items. */}
      <View style={[styles.rowArea, { height: cardHeight + 2 * GLOW_PAD }]}>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.video.Id}
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
  container: {
    marginTop: IS_TV ? 0 : 24,
    marginBottom: IS_TV ? 24 : 24,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: CARD_PADDING,
    marginBottom: IS_TV ? 12 : 8,
  },
  heading: {
    fontSize: IS_TV ? 28 : 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  // height applied inline (derived from the live card width).
  rowArea: {
    margin: -GLOW_PAD,
  },
  rowContent: {
    padding: GLOW_PAD,
  },
});
