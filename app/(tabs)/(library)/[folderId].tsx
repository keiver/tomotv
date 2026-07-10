import { LibraryGrid } from "@/components/library-grid";
import { useLoading } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { PosterBackdropProvider } from "@/contexts/PosterBackdropContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { isFolder, isPhoto } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";

/**
 * A single folder level — a real pushed route. The Apple TV Menu button pops it natively (no custom
 * menu handling anywhere). `crumbs` carries the full path for the header; we append to it on push.
 */
function FolderScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const { buildQueue } = usePlayQueue();
  const params = useLocalSearchParams<{ folderId: string; name?: string; type?: string; crumbs?: string }>();

  const folderId = params.folderId;
  const folderName = params.name ?? "";
  const folderType: "folder" | "playlist" = params.type === "playlist" ? "playlist" : "folder";

  const crumbs = useMemo<FolderStackEntry[]>(() => {
    try {
      return params.crumbs ? (JSON.parse(params.crumbs) as FolderStackEntry[]) : [{ id: folderId, name: folderName, type: folderType }];
    } catch {
      return [{ id: folderId, name: folderName, type: folderType }];
    }
  }, [params.crumbs, folderId, folderName, folderType]);

  const { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore } = useFolderContents(folderId, folderType);

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
      } else {
        // Inside a folder — build a queue of all videos under this folder.
        buildQueue(folderId, folderName, item.Id, folderType);
        showGlobalLoader();
        router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name, queueMode: "true" } });
      }
    },
    [router, crumbs, buildQueue, folderId, folderName, folderType, showGlobalLoader],
  );

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
      />
    </PosterBackdropProvider>
  );
}

export default FolderScreen;
