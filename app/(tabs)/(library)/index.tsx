import { LibraryGrid } from "@/components/library-grid";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { useAuth } from "@/contexts/AuthContext";
import { useLoading } from "@/contexts/LoadingContext";
import { PosterBackdropProvider } from "@/contexts/PosterBackdropContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { isFolder } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";

/**
 * Libraries root — the default screen of the Home tab's nested Stack. Tapping a library pushes a
 * real `[folderId]` route. This root screen itself has no menu handlers (Menu goes to the tab bar);
 * the pushed folder screens intercept Menu in LibraryGrid (rewind-to-top before pop).
 */
function LibrariesRootScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
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

/**
 * Auth gate, mirroring the Search tab's: while no server is connected the grid never mounts (so
 * no fetch fires with an empty server URL) and the connect widget renders in its place. Login and
 * logout flip `isConnected`, which mounts/unmounts the grid with fresh state — the grid's own
 * error CTA now only appears for genuine errors while connected.
 */
export default function LibraryIndexScreen() {
  const { isConnected, isReady } = useAuth();

  if (!isReady) return null;
  if (!isConnected) {
    return <ServerConnectScreen title="Home" />;
  }
  return <LibrariesRootScreen />;
}
