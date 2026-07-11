import { VideoGridItem } from "@/components/video-grid-item";
import { slotColumns, slotRatio } from "@/constants/app";
import { useLoading } from "@/contexts/LoadingContext";
import { fetchFavoriteVideos, markVideoAsFavorite, subscribeFavoriteChange } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Dimensions, FlatList, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const NUM_COLUMNS = slotColumns("landscape", IS_TV);
const GRID_PADDING_H = (IS_TV ? 80 : 60) + (IS_TV ? 40 : 20);
const CARD_PADDING = IS_TV ? 16 : 8;
const CARD_WIDTH = (Dimensions.get("window").width - GRID_PADDING_H) / NUM_COLUMNS;
const CARD_HEIGHT = Math.round((CARD_WIDTH - 2 * CARD_PADDING) / slotRatio("landscape") + 2 * CARD_PADDING);
const GLOW_PAD = IS_TV ? 24 : 12;

export function FavoritesRow() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const [items, setItems] = useState<JellyfinVideoItem[]>([]);

  const loadFavorites = useCallback(async () => {
    try {
      const favorites = await fetchFavoriteVideos({ limit: 30 });
      setItems(favorites);
    } catch (err) {
      logger.warn("Failed to load favorites row", err, { service: "FavoritesRow" });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [loadFavorites]),
  );

  useEffect(() => {
    const unsubscribe = subscribeFavoriteChange(loadFavorites);
    return unsubscribe;
  }, [loadFavorites]);

  const handlePress = useCallback(
    (video: JellyfinVideoItem) => {
      showGlobalLoader();
      router.push({
        pathname: "/player" as const,
        params: { videoId: video.Id, videoName: video.Name },
      });
    },
    [showGlobalLoader, router],
  );

  const handleLongPress = useCallback((video: JellyfinVideoItem) => {
    Alert.alert(video.Name || "Video", "Choose an action", [
      {
        text: "Mark as Favorite",
        onPress: async () => {
          try {
            await markVideoAsFavorite(video.Id);
          } catch (err) {
            logger.warn("Failed to mark favorites row video as favorite", err, { service: "FavoritesRow", videoId: video.Id });
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinVideoItem; index: number }) => (
      <VideoGridItem video={item} onPress={handlePress} onLongPress={handleLongPress} index={index} cardWidth={CARD_WIDTH} slotOrientation="landscape" />
    ),
    [handlePress, handleLongPress],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Favorites</Text>
      </View>
      <View style={styles.rowArea}>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.Id}
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
  rowArea: {
    height: CARD_HEIGHT + 2 * GLOW_PAD,
    margin: -GLOW_PAD,
  },
  rowContent: {
    padding: GLOW_PAD,
  },
});
