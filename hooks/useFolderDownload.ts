import { downloadRungs, estimatedConvertedBytes, sizeChoice, type ConversionRung } from "@/services/downloads/convert";
import { downloadManager } from "@/services/downloads/manager";
import { DISK_HEADROOM_BYTES, downloadsSupported, sizeOf } from "@/services/downloads/paths";
import { fetchAllPlaylistItems, fetchRecursiveDownloadables, isPhoto } from "@/services/jellyfinApi";
import { serverTranscodeAllowed } from "@/services/transcodePolicy";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { formatFileSize } from "@/utils/mediaInfo";
import { logger } from "@/utils/logger";
import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";
import { t } from "@/services/i18n";

/** One size button for the whole set: the rung the videos convert to, with the set's total. */
interface SizeChoice {
  text: string;
  /** 0 when any item's size is unknown: the total admits itself rather than claiming a number. */
  bytes: number;
  convert?: ConversionRung;
}

/** The rung an item of the set converts to under a choice: videos that the rung shrinks, nothing else. */
function rungFor(item: JellyfinVideoItem, rung: ConversionRung | undefined): ConversionRung | undefined {
  if (!rung || !serverTranscodeAllowed(item)) return undefined;
  return downloadRungs(item).some((candidate) => candidate.label === rung.label) ? rung : undefined;
}

/**
 * Download everything playable under a folder, series, album, playlist or mixed container.
 *
 * The whole point of the confirmation is the arithmetic: a folder is the one place a user can
 * commit to tens of gigabytes with a single press, so each size and the space left are stated
 * before anything is written, and a set that does not fit is refused rather than started and
 * failed halfway through.
 *
 * Photos are excluded: they are not playable media and the downloads surface plays what it
 * holds. Items already downloaded or in flight are excluded too, so pressing this again after
 * adding a few episodes offers only the difference.
 *
 * Accepting the confirmation leaves for the Downloads tab. Queuing is otherwise invisible,
 * the panel stays up, nothing on it changes, and the transfers only exist on a screen the
 * user has not been shown.
 */
export function useFolderDownload() {
  const router = useRouter();

  return useCallback(
    async (folder: JellyfinItem) => {
      if (!downloadsSupported()) {
        Alert.alert(t("downloads.notAvailableTitle"), t("downloads.tvNotice"));
        return;
      }

      let items: JellyfinVideoItem[];
      try {
        // A playlist holds references rather than children, so it answers on its own endpoint.
        items = folder.Type === "Playlist" ? ((await fetchAllPlaylistItems(folder.Id)) as JellyfinVideoItem[]) : await fetchRecursiveDownloadables(folder.Id);
      } catch (error) {
        logger.warn("Could not list a folder to download", error, { service: "Downloads", folderId: folder.Id });
        Alert.alert(t("downloads.folderLoadFailedTitle"), t("downloads.folderLoadFailed"));
        return;
      }

      await downloadManager.hydrate();
      const pending = items.filter((item) => !isPhoto(item) && !downloadManager.has(item.Id));

      if (pending.length === 0) {
        const known = items.some((item) => !isPhoto(item));
        Alert.alert(known ? t("downloads.alreadyTitle") : t("downloads.nothingTitle"), known ? t("downloads.alreadyBody") : t("downloads.nothingBody"));
        return;
      }

      const free = Paths.availableDiskSpace;
      // A rung is offered when it shrinks at least one video of the set; the rest keep their
      // originals under it. Sizes come from MediaSources, and a server that declared none
      // leaves the total unknown rather than at "0 bytes".
      const total = (rung: ConversionRung | undefined) => {
        let sum = 0;
        for (const item of pending) {
          const converted = rungFor(item, rung);
          const bytes = converted ? estimatedConvertedBytes(item, converted) : sizeOf(item);
          if (bytes <= 0) return 0;
          sum += bytes;
        }
        return sum;
      };
      const rungs = pending.flatMap((item) => (serverTranscodeAllowed(item) ? downloadRungs(item) : [])).filter((rung, index, all) => all.findIndex((other) => other.label === rung.label) === index);
      const choices: SizeChoice[] = [
        { text: sizeChoice(t("downloads.original"), total(undefined)), bytes: total(undefined) },
        ...rungs.sort((a, b) => b.bitrate - a.bitrate).map((rung) => ({ text: sizeChoice(rung.label, total(rung)), bytes: total(rung), convert: rung })),
      ];

      const offered = choices.filter((choice) => choice.bytes <= 0 || free - choice.bytes >= DISK_HEADROOM_BYTES);
      if (offered.length === 0) {
        const smallest = Math.min(...choices.map((choice) => choice.bytes));
        Alert.alert(
          t("downloads.notEnoughSpace"),
          t("downloads.needsSpaceItems").replace("{count}", String(pending.length)).replace("{size}", formatFileSize(smallest)).replace("{free}", formatFileSize(free)),
        );
        return;
      }

      const queue = (rung: ConversionRung | undefined) => {
        // Leave first, queue after. Enqueuing a long folder takes a while per item, and
        // waiting for it would leave the panel sitting there looking like nothing
        // happened. The Downloads tab subscribes to the manager, so the rows arrive on a
        // screen the user is already watching. `back` dismisses the info panel, which is
        // a presented modal on phone (see useItemDownload for the same pair).
        router.back();
        // The folder's own id is the group id every item below is tagged with, so the tab
        // opens the set rather than leaving it collapsed among the rest.
        router.push({ pathname: "/downloads", params: { highlight: folder.Id } });

        // Queued in order; the manager runs two at a time and holds the rest.
        void (async () => {
          for (const item of pending) {
            try {
              // Tagged with the container, so the Downloads screen shows one row for the
              // whole set rather than one per track.
              const convert = rungFor(item, rung);
              await downloadManager.enqueue(item, { group: { id: folder.Id, name: folder.Name }, ...(convert ? { convert } : {}) });
            } catch (error) {
              logger.warn("Could not queue a folder item", error, { service: "Downloads", itemId: item.Id });
            }
          }
        })();
      };

      Alert.alert(
        folder.Name,
        t(pending.length === 1 ? "downloads.chooseSizeItem" : "downloads.chooseSizeItems")
          .replace("{count}", String(pending.length))
          .replace("{free}", formatFileSize(free)),
        [...offered.map((choice) => ({ text: choice.text, onPress: () => queue(choice.convert) })), { text: t("common.cancel"), style: "cancel" as const }],
      );
    },
    [router],
  );
}
