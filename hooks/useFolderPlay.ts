import { useLoadingActions } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { fetchPlaylistContents, fetchRecursiveVideos, isAudioItem, isPhoto } from "@/services/jellyfinApi";
import { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

/** The three sets a container can be played as, one CTA each in the info panel. */
export type FolderPlayKind = "video" | "audio" | "photo";

const EMPTY_MESSAGE: Record<FolderPlayKind, string> = {
  video: "No videos to play in this folder.",
  audio: "No audio to play in this folder.",
  photo: "No photos to show in this folder.",
};

/**
 * Play everything of one kind under a folder, series, album or playlist.
 *
 * Videos and audio become a queue from the whole subtree (a Playlist holds references, so it
 * comes from the playlist endpoint the queue builder uses); photos hand the folder to the
 * viewer, which sweeps them itself. `replace` mirrors hooks/useOpenShelfItem.ts: a caller
 * that is a presented modal must leave the sheet before a player is presented.
 */
export function useFolderPlay() {
  const router = useRouter();
  const { showGlobalLoader, hideGlobalLoader } = useLoadingActions();
  const { buildQueueFromItems } = usePlayQueue();

  return useCallback(
    async (folder: JellyfinItem, kind: FolderPlayKind, options?: { replace?: boolean }) => {
      if (kind === "photo") {
        // The viewer is a plain push on both platforms; the phone sheet steps out of the way
        // first (see the photo branch of VideoInfoScreen's handlePlay).
        if (options?.replace) router.back();
        router.push({ pathname: "/photo-viewer", params: { folderId: folder.Id, recursive: "true", slideshow: "true" } });
        return;
      }

      showGlobalLoader();
      let items: JellyfinVideoItem[] = [];
      try {
        items = folder.Type === "Playlist" ? ((await fetchPlaylistContents(folder.Id, { limit: 500 })).items as JellyfinVideoItem[]) : await fetchRecursiveVideos(folder.Id);
      } catch (error) {
        logger.warn("Failed to load folder items to play", error, { service: "FolderPlay", folderId: folder.Id, kind });
      }

      const queue = items.filter((item) => (kind === "audio" ? isAudioItem(item) : !isAudioItem(item) && !isPhoto(item)));
      if (queue.length === 0) {
        hideGlobalLoader();
        Alert.alert("Nothing to play", EMPTY_MESSAGE[kind]);
        return;
      }

      const first = queue[0];
      buildQueueFromItems(queue, folder.Id, folder.Name, first.Id);
      const destination = {
        pathname: kind === "audio" ? ("/audio-player" as const) : ("/player" as const),
        params: { videoId: first.Id, videoName: first.Name, queueMode: "true" },
      };
      if (options?.replace) {
        router.replace(destination);
      } else {
        router.push(destination);
      }
    },
    [router, showGlobalLoader, hideGlobalLoader, buildQueueFromItems],
  );
}
