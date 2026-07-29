import { LibraryGrid } from "@/components/library-grid";
import { useLoading } from "@/contexts/LoadingContext";
import { PosterBackdropProvider } from "@/contexts/PosterBackdropContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { isFolder } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";

/**
 * Libraries root — the default screen of the Library tab's nested Stack. Tapping a library pushes a
 * real `[folderId]` route, so the Apple TV Menu button pops back to here natively. No menu handlers.
 */
function LibrariesRootScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  // Auth changes (login AND logout) refetch inside useFolderContents — the screen never remounts
  // on its own, and a logout must replace the stale logged-in content with the error state.
  const { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore } = useFolderContents(null);

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
