import { useShowInFolder } from "@/hooks/useShowInFolder";
import { setVideoFavorite, setVideoPlayed } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

/**
 * One long-press menu for every playable card (home shelves, folder grid).
 * Native alert (focusable on tvOS); toggle direction comes from the item's
 * server-side state.
 */
export function useItemLongPress() {
  const router = useRouter();
  const showInFolder = useShowInFolder();

  return useCallback(
    (item: JellyfinItem) => {
      const isFavorite = !!item.UserData?.IsFavorite;
      const isPlayed = !!item.UserData?.Played;
      Alert.alert(item.Name || "Video", undefined, [
        {
          text: "View Info",
          onPress: () => router.push({ pathname: "/video-info", params: { videoId: item.Id, name: item.Name } }),
        },
        { text: "Show In Folder", onPress: () => showInFolder(item) },
        {
          text: isFavorite ? "Remove from Favorites" : "Mark as Favorite",
          onPress: async () => {
            try {
              await setVideoFavorite(item.Id, !isFavorite);
            } catch (err) {
              logger.warn("Failed to toggle favorite", err, { service: "ItemLongPress", videoId: item.Id });
            }
          },
        },
        {
          text: isPlayed ? "Mark as Unwatched" : "Mark as Watched",
          onPress: async () => {
            try {
              await setVideoPlayed(item.Id, !isPlayed);
            } catch (err) {
              logger.warn("Failed to toggle played", err, { service: "ItemLongPress", videoId: item.Id });
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [router, showInFolder],
  );
}
