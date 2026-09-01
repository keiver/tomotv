import { useLoadingActions } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { isAudioItem, isFolder, isPhoto } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * One press handler for every home shelf card. Folder kinds (Series, MusicAlbum, BoxSet,
 * playlists...) navigate into their browse screen; a photo opens the viewer over the folder
 * it lives in; playable leaves play with a binge queue built from SeriesId ?? ParentId (folder
 * siblings for non-episodes, audio included); audio opens the native queue player. Playback
 * params trust the state the shelf just displayed over the player's own item refetch: the
 * item endpoint can answer with stale UserData (see the Continue Watching row's history).
 */
export function useOpenShelfItem() {
  const router = useRouter();
  const { showGlobalLoader } = useLoadingActions();
  const { buildQueue } = usePlayQueue();

  return useCallback(
    // replace: swap the CURRENT route for the player instead of stacking. Required when the
    // caller is a presented modal (video-info sheet): react-native-screens gives a screen
    // pushed after a modal a zero-frame modal presentation, and AVKit presenting out of that
    // crashes the app.
    (item: JellyfinItem, options?: { replace?: boolean }) => {
      if (isFolder(item)) {
        const type = item.Type === "Playlist" ? "playlist" : "folder";
        const crumb: FolderStackEntry = { id: item.Id, name: item.Name, type, parentId: item.ParentId };
        router.push({
          pathname: "/[folderId]",
          params: { folderId: item.Id, name: item.Name, type, crumbs: JSON.stringify([crumb]) },
        });
        return;
      }

      // A photo has no media source: routed to the player it renders "Failed to load video".
      // Without a ParentId there is no set to step through, so the viewer opens on the photo alone.
      if (isPhoto(item)) {
        router.push({ pathname: "/photo-viewer", params: { photoId: item.Id, ...(item.ParentId ? { folderId: item.ParentId } : {}) } });
        return;
      }

      showGlobalLoader();
      const queueParent = item.SeriesId ?? item.ParentId;
      if (queueParent) {
        buildQueue(queueParent, item.SeriesName ?? item.Name, item.Id);
      }
      const destination = {
        pathname: isAudioItem(item) ? ("/audio-player" as const) : ("/player" as const),
        params: {
          videoId: item.Id,
          videoName: item.Name,
          ...(queueParent ? { queueMode: "true" } : {}),
          ...(item.UserData?.PlaybackPositionTicks ? { startTicks: String(item.UserData.PlaybackPositionTicks) } : {}),
          played: item.UserData?.Played ? "true" : "false",
        },
      };
      if (options?.replace) {
        router.replace(destination);
      } else {
        router.push(destination);
      }
    },
    [router, showGlobalLoader, buildQueue],
  );
}
