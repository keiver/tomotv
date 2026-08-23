import { downloadManager } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { fetchAllPlaylistItems, fetchRecursiveDownloadables, isPhoto } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { formatFileSize } from "@/utils/mediaInfo";
import { logger } from "@/utils/logger";
import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

/** Free space to leave behind, matching the per-item check in the download manager. */
const DISK_HEADROOM_BYTES = 500 * 1024 * 1024;

/** Bytes an item will take, or 0 when the server declared no size. */
function sizeOf(item: JellyfinVideoItem): number {
  return item.MediaSources?.[0]?.Size ?? 0;
}

/**
 * Download everything playable under a folder, series, album, playlist or mixed container.
 *
 * The whole point of the confirmation is the arithmetic: a folder is the one place a user can
 * commit to tens of gigabytes with a single press, so the total and the space left are stated
 * before anything is written, and a set that does not fit is refused rather than started and
 * failed halfway through.
 *
 * Photos are excluded: they are not playable media and the downloads surface plays what it
 * holds. Items already downloaded or in flight are excluded too, so pressing this again after
 * adding a few episodes offers only the difference.
 *
 * Accepting the confirmation leaves for the Downloads tab. Queuing is otherwise invisible —
 * the panel stays up, nothing on it changes, and the transfers only exist on a screen the
 * user has not been shown.
 */
export function useFolderDownload() {
  const router = useRouter();

  return useCallback(
    async (folder: JellyfinItem) => {
      if (!downloadsSupported()) {
        Alert.alert("Not available here", "Downloads need an iPhone or iPad. Apple TV keeps no files of its own.");
        return;
      }

      let items: JellyfinVideoItem[];
      try {
        // A playlist holds references rather than children, so it answers on its own endpoint.
        items = folder.Type === "Playlist" ? ((await fetchAllPlaylistItems(folder.Id)) as JellyfinVideoItem[]) : await fetchRecursiveDownloadables(folder.Id);
      } catch (error) {
        logger.warn("Could not list a folder to download", error, { service: "Downloads", folderId: folder.Id });
        Alert.alert("Couldn't load folder", "The server didn't answer. Check your connection and try again.");
        return;
      }

      await downloadManager.hydrate();
      const pending = items.filter((item) => !isPhoto(item) && !downloadManager.has(item.Id));

      if (pending.length === 0) {
        const known = items.some((item) => !isPhoto(item));
        Alert.alert(known ? "Already downloaded" : "Nothing to download", known ? "Everything here is already on this device." : "This folder holds no audio or video.");
        return;
      }

      const total = pending.reduce((sum, item) => sum + sizeOf(item), 0);
      const free = Paths.availableDiskSpace;
      // Sizes come from MediaSources; a server that declared none leaves this at 0, and claiming
      // "0 bytes" would be worse than admitting the total is unknown.
      const measured = pending.every((item) => sizeOf(item) > 0);
      const sizeLine = measured ? formatFileSize(total) : "an unknown size";

      if (measured && free - total < DISK_HEADROOM_BYTES) {
        Alert.alert("Not enough space", `${pending.length} items need ${formatFileSize(total)}, and only ${formatFileSize(free)} is free.`);
        return;
      }

      Alert.alert(folder.Name, `Download ${pending.length} ${pending.length === 1 ? "item" : "items"}, ${sizeLine}?\n${formatFileSize(free)} free on this device.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Download",
          onPress: () => {
            // Leave first, queue after. Enqueuing a long folder takes a while per item, and
            // waiting for it would leave the panel sitting there looking like nothing
            // happened. The Downloads tab subscribes to the manager, so the rows arrive on a
            // screen the user is already watching. `back` dismisses the info panel, which is
            // a presented modal on phone (see useItemDownload for the same pair).
            router.back();
            router.push("/downloads");

            // Queued in order; the manager runs two at a time and holds the rest.
            void (async () => {
              for (const item of pending) {
                try {
                  // Tagged with the container, so the Downloads screen shows one row for the
                  // whole set rather than one per track.
                  await downloadManager.enqueue(item, { group: { id: folder.Id, name: folder.Name } });
                } catch (error) {
                  logger.warn("Could not queue a folder item", error, { service: "Downloads", itemId: item.Id });
                }
              }
            })();
          },
        },
      ]);
    },
    [router],
  );
}
