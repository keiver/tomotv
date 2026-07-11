import { VideoGridItem } from "@/components/video-grid-item";
import { slotColumns, slotRatio } from "@/constants/app";
import { useLoading } from "@/contexts/LoadingContext";
import { fetchItemsByIds, markVideoAsFavorite } from "@/services/jellyfinApi";
import { clearProgress, getRecentProgress } from "@/services/watchProgressService";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, Dimensions, FlatList, Platform, StyleSheet, Text, View } from "react-native";

// Mirror the Library grid sizing so shelf cards match a landscape grid column.
const IS_TV = Platform.isTV;
const NUM_COLUMNS = slotColumns("landscape", IS_TV);
const GRID_PADDING_H = (IS_TV ? 80 : 60) + (IS_TV ? 40 : 20);
const CARD_PADDING = IS_TV ? 16 : 8;

const CARD_WIDTH = (Dimensions.get("window").width - GRID_PADDING_H) / NUM_COLUMNS;
// Deterministic card height (landscape slot) so we can reserve the row's space
// up front and avoid a layout jump when the async metadata finishes loading.
const CARD_HEIGHT = Math.round((CARD_WIDTH - 2 * CARD_PADDING) / slotRatio("landscape") + 2 * CARD_PADDING);
// Extra room around the list so the focused card's glow isn't clipped at the
// FlatList bounds; negative margins cancel it out so the layout doesn't move.
const GLOW_PAD = IS_TV ? 24 : 12;

interface ResumeItem {
  video: JellyfinVideoItem;
  progressPercent: number; // 0–1
}

/**
 * Horizontal "Continue Watching" shelf shown at the top of the Library root.
 * Self-contained: loads in-progress items on focus and renders nothing when empty.
 *
 * To avoid a layout jump, the row's space is reserved as soon as the (fast, local)
 * progress lookup confirms there are items — before the slower metadata hydration
 * fills the cards in. It collapses to nothing only when there is genuinely nothing
 * to resume.
 */
export function ContinueWatchingRow() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const [hasItems, setHasItems] = useState(false);
  const [items, setItems] = useState<ResumeItem[]>([]);

  // Reload each time the Library tab regains focus (e.g. after returning from the player).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const progress = await getRecentProgress();
          if (progress.length === 0) {
            if (!cancelled) {
              setHasItems(false);
              setItems([]);
            }
            return;
          }

          // Reserve the row's space now — count is known from the local store before
          // the network hydration below completes.
          if (!cancelled) setHasItems(true);

          const ids = progress.map((entry) => entry.videoId);
          const hydrated = await fetchItemsByIds(ids);
          const percentById = new Map(progress.map((entry) => [entry.videoId, entry.duration > 0 ? entry.position / entry.duration : 0]));

          const merged: ResumeItem[] = hydrated.map((video) => ({
            video,
            progressPercent: percentById.get(video.Id) ?? 0,
          }));

          if (!cancelled) {
            setItems(merged);
            setHasItems(merged.length > 0); // collapse if everything was deleted server-side
          }
        } catch (err) {
          // A transient hydration failure (e.g. a network hiccup on reload) must not
          // hide a row that has saved progress. Keep whatever is already shown and let
          // the next focus retry — only an empty progress store collapses the row.
          logger.warn("Failed to load continue watching row", err, { service: "ContinueWatching" });
        }
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
    try {
      await clearProgress(video.Id);
    } catch (err) {
      logger.warn("Failed to remove continue watching item", err, { service: "ContinueWatching" });
    }
    setItems((prev) => {
      const next = prev.filter((entry) => entry.video.Id !== video.Id);
      setHasItems(next.length > 0);
      return next;
    });
  }, []);

  const handleLongPress = useCallback(
    (video: JellyfinVideoItem) => {
      Alert.alert(video.Name || "Video", undefined, [
        {
          text: "Mark as Favorite",
          onPress: async () => {
            try {
              await markVideoAsFavorite(video.Id);
            } catch (err) {
              logger.warn("Failed to mark continue watching video as favorite", err, { service: "ContinueWatching", videoId: video.Id });
            }
          },
        },
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeItem(video) },
      ]);
    },
    [removeItem],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ResumeItem; index: number }) => (
      <VideoGridItem video={item.video} onPress={handlePress} onLongPress={handleLongPress} index={index} cardWidth={CARD_WIDTH} progressPercent={item.progressPercent} slotOrientation="landscape" />
    ),
    [handlePress, handleLongPress],
  );

  if (!hasItems) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Continue Watching</Text>
        <Text style={styles.localTag}>(local)</Text>
      </View>
      {/* Fixed-height area reserved up front; the cards fill it once hydrated (no jump). */}
      <View style={styles.rowArea}>
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
    marginBottom: IS_TV ? 24 : 16,
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
  localTag: {
    marginLeft: IS_TV ? 10 : 6,
    fontSize: IS_TV ? 18 : 12,
    fontWeight: "600",
    color: "#98989D",
  },
  rowArea: {
    height: CARD_HEIGHT + 2 * GLOW_PAD,
    margin: -GLOW_PAD,
  },
  rowContent: {
    padding: GLOW_PAD,
  },
});
