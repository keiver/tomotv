import { LibraryGrid } from "@/components/library-grid";
import { useLoading } from "@/contexts/LoadingContext";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { PosterBackdropProvider } from "@/contexts/PosterBackdropContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { isFolder, isPhoto, setVideoFavorite, subscribeFavoriteChange } from "@/services/jellyfinApi";
import { countActiveFilters, FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo } from "react";
import { Alert } from "react-native";

/**
 * A single folder level — a real pushed route. The Apple TV Menu button pops it natively (no custom
 * menu handling anywhere). `crumbs` carries the full path for the header; we append to it on push.
 */
function FolderScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const { buildQueue, buildQueueFromItems } = usePlayQueue();
  const params = useLocalSearchParams<{ folderId: string; name?: string; type?: string; crumbs?: string }>();

  const folderId = params.folderId;
  const folderName = params.name ?? "";
  const folderType: "folder" | "playlist" = params.type === "playlist" ? "playlist" : "folder";

  const { getFilters } = useLibraryFilters();
  const filters = getFilters(folderId);
  const activeFilterCount = countActiveFilters(filters);

  const crumbs = useMemo<FolderStackEntry[]>(() => {
    try {
      return params.crumbs ? (JSON.parse(params.crumbs) as FolderStackEntry[]) : [{ id: folderId, name: folderName, type: folderType }];
    } catch {
      return [{ id: folderId, name: folderName, type: folderType }];
    }
  }, [params.crumbs, folderId, folderName, folderType]);

  const { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh } = useFolderContents(folderId, folderType, filters);

  // A favorite toggle anywhere (long-press here, player heart) refetches so the visible list and
  // the UserData-driven long-press labels stay accurate — essential while the Favorite filter is on.
  useEffect(() => subscribeFavoriteChange(refresh), [refresh]);

  const handleItemPress = useCallback(
    (item: JellyfinItem) => {
      if (isFolder(item)) {
        const type = item.Type === "Playlist" ? "playlist" : "folder";
        const childCrumb: FolderStackEntry = { id: item.Id, name: item.Name, type, parentId: item.ParentId };
        router.push({
          pathname: "/[folderId]",
          params: { folderId: item.Id, name: item.Name, type, crumbs: JSON.stringify([...crumbs, childCrumb]) },
        });
      } else if (isPhoto(item)) {
        router.push({ pathname: "/photo-viewer", params: { folderId, photoId: item.Id } });
      } else if (activeFilterCount > 0) {
        // Filtered/shuffled view — queue exactly what the user sees, in the order they see it.
        buildQueueFromItems(
          items.filter((i) => !isFolder(i) && !isPhoto(i)),
          folderId,
          folderName,
          item.Id,
        );
        showGlobalLoader();
        router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name, queueMode: "true" } });
      } else {
        // Inside a folder — build a queue of all videos under this folder.
        buildQueue(folderId, folderName, item.Id, folderType);
        showGlobalLoader();
        router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name, queueMode: "true" } });
      }
    },
    [router, crumbs, buildQueue, buildQueueFromItems, items, activeFilterCount, folderId, folderName, folderType, showGlobalLoader],
  );

  const handleOpenFilters = useCallback(() => {
    // Source genre/artist options from the top-level library so the same list shows anywhere in it.
    // crumbs[0] is always the entered library; equals folderId at the library root.
    const libraryId = crumbs[0]?.id ?? folderId;
    router.push({ pathname: "/filters", params: { folderId, name: folderName, libraryId } });
  }, [router, crumbs, folderId, folderName]);

  // Native alert (focusable on tvOS) — toggle direction comes from the item's server-side state.
  const handleItemLongPress = useCallback((item: JellyfinItem) => {
    const isFavorite = !!item.UserData?.IsFavorite;
    Alert.alert(item.Name || "Video", undefined, [
      {
        text: isFavorite ? "Remove from Favorites" : "Mark as Favorite",
        onPress: async () => {
          try {
            await setVideoFavorite(item.Id, !isFavorite);
          } catch (err) {
            logger.warn("Failed to toggle favorite", err, { service: "FolderScreen", videoId: item.Id });
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  return (
    <PosterBackdropProvider>
      <LibraryGrid
        items={items}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMoreResults={hasMoreResults}
        error={error}
        onItemPress={handleItemPress}
        onLoadMore={loadMore}
        variant="folder"
        crumbs={crumbs}
        onBack={() => router.back()}
        onOpenFilters={handleOpenFilters}
        activeFilterCount={activeFilterCount}
        onItemLongPress={handleItemLongPress}
      />
    </PosterBackdropProvider>
  );
}

export default FolderScreen;
