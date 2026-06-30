import { LibraryGrid } from "@/components/library-grid";
import { useLoading } from "@/contexts/LoadingContext";
import { PosterBackdropProvider } from "@/contexts/PosterBackdropContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { isAuthenticated, isFolder, subscribeAuthChange } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect } from "react";

/**
 * Libraries root — the default screen of the Library tab's nested Stack. Tapping a library pushes a
 * real `[folderId]` route, so the Apple TV Menu button pops back to here natively. No menu handlers.
 */
function LibrariesRootScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh } = useFolderContents(null);

  // Refetch the libraries the moment the user logs in / connects a server (the screen is already
  // mounted as the tab root, so it won't remount on its own).
  useEffect(() => {
    return subscribeAuthChange(() => {
      if (isAuthenticated()) refresh();
    });
  }, [refresh]);

  const handleItemPress = useCallback(
    (item: JellyfinItem) => {
      if (isFolder(item)) {
        const type = item.Type === "Playlist" ? "playlist" : "folder";
        const crumb: FolderStackEntry = { id: item.Id, name: item.Name, type, parentId: item.ParentId };
        router.push({
          pathname: "/[folderId]",
          params: { folderId: item.Id, name: item.Name, type, crumbs: JSON.stringify([crumb]) },
        });
      } else {
        // At the libraries root — play standalone (no queue).
        showGlobalLoader();
        router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name } });
      }
    },
    [router, showGlobalLoader],
  );

  return (
    <PosterBackdropProvider>
      <LibraryGrid items={items} isLoading={isLoading} isLoadingMore={isLoadingMore} hasMoreResults={hasMoreResults} error={error} onItemPress={handleItemPress} onLoadMore={loadMore} variant="root" />
    </PosterBackdropProvider>
  );
}

export default LibrariesRootScreen;
