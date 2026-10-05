import type { DownloadCircleState } from "@/components/info-action-row";
import { preferredAudioIndexIn, readAudioPreference } from "@/services/audioPreference";
import { downloadRungs, estimatedConvertedBytes, type ConversionRung } from "@/services/downloads/convert";
import { downloadManager } from "@/services/downloads/manager";
import { DISK_HEADROOM_BYTES, downloadsSupported, sizeOf } from "@/services/downloads/paths";
import { blockedSizesNote, showSizeSheet, sizeChoice } from "@/services/downloads/sizeSheet";
import { fetchVideoDetails, isBook, isFolder, isPhoto } from "@/services/jellyfinApi";
import { predictPlaybackLane } from "@/services/localRemux";
import { serverTranscodeBlock } from "@/services/transcodePolicy";
import type { JellyfinItem } from "@/types/jellyfin";
import { formatFileSize } from "@/utils/mediaInfo";
import { logger } from "@/utils/logger";
import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { t } from "@/services/i18n";

interface ItemDownload {
  /** undefined where a download cannot exist, which is what hides the circle. */
  state: DownloadCircleState | undefined;
  toggle: (() => Promise<boolean>) | undefined;
}

/** One size button: the original or a server rung, with the bytes it would take. */
interface SizeChoice {
  text: string;
  bytes: number;
  convert?: ConversionRung;
  disabled?: boolean;
}

/** What the manager holds for one item right now; the manifest is the source of truth. */
function read(itemId: string | undefined): DownloadCircleState {
  const entry = itemId ? downloadManager.getState().entries.find((candidate) => candidate.itemId === itemId) : undefined;
  if (!entry) return "none";
  // The circle has no rewrap state and does not need one: the file is still on its way.
  return entry.state === "repackaging" ? "queued" : entry.state;
}

/**
 * The info panel's download circle: what state the item is in, and the one press that moves it
 * on. Folders and photos are excluded because neither has a file to fetch: a container's
 * children are separate items, and a photo is the image already on screen.
 */
export function useItemDownload(item: JellyfinItem | null): ItemDownload {
  const router = useRouter();
  const itemId = item?.Id;
  // Seeded from the manager rather than from "none": the panel remounts on every open, and a
  // first paint at "none" would offer a download already on the device.
  const [state, setState] = useState<DownloadCircleState>(() => read(itemId));

  const eligible = !!item && downloadsSupported() && !isFolder(item) && !isPhoto(item) && !isBook(item);

  useEffect(() => {
    if (!eligible || !itemId) return;
    return downloadManager.subscribe(() => setState(read(itemId)));
  }, [eligible, itemId]);

  /**
   * A press on anything in flight ends on the Downloads tab, which is where a transfer is
   * watched, paused and deleted. Queuing is otherwise invisible: the panel stays up, nothing on
   * it changes, and the transfer only exists on a screen the user has not been shown.
   */
  const toggle = useCallback(async (): Promise<boolean> => {
    if (!itemId) return false;
    // Dismiss first: this panel is a presented modal on phone, and navigating out of one is
    // the same trap Show in Folder documents. The item rides along so the tab can mark its row.
    const leave = () => {
      router.back();
      router.push({ pathname: "/downloads", params: { highlight: itemId } });
    };
    // Anything already known, held or in flight, leads to the tab rather than acting here.
    // Making the same circle also cancel is how a second press, on a panel that was not yet
    // showing progress, threw the file away.
    if (state !== "none" && state !== "failed") {
      leave();
      return true;
    }
    // A failed row is still in the manifest, and enqueue ignores a known item; resume is the
    // press that re-queues it, conversion and all.
    if (state === "failed") {
      downloadManager.resume(itemId);
      leave();
      return true;
    }
    try {
      // The panel's own fetch answers for every item kind and therefore leads with
      // /Items/{id}, which carries no MediaSources. The download needs the size and the
      // container, so the playback fetch runs here. Awaited rather than left running behind
      // the push, so a server that refuses still reports on the panel.
      const details = await fetchVideoDetails(itemId);
      if (!details) return false;
      const name = details.Name ?? t("downloads.title");

      const queue = (convert?: ConversionRung) => {
        void (async () => {
          try {
            // A conversion records one audio track: the one in the viewer's audio language.
            const audioIndex = convert ? preferredAudioIndexIn(details.MediaStreams ?? [], await readAudioPreference()) : undefined;
            await downloadManager.enqueue(details, convert ? { convert, ...(audioIndex !== undefined ? { audioIndex } : {}) } : {});
            leave();
          } catch (error) {
            logger.warn("Download action failed", error, { service: "Downloads", itemId });
          }
        })();
      };

      // A file only the server can play is dead weight on the device: the download would
      // finish and then need the very server it exists to do without, so the original is not
      // offered and the server re-encodes it on the way down instead.
      const { lane } = await predictPlaybackLane(details);
      const free = Paths.availableDiskSpace;
      // Neither the device nor, by this device's setting, the server plays it: nothing to queue.
      if (lane === "unplayable") {
        Alert.alert(name, t("downloads.unplayableOffline"), [{ text: t("common.ok") }]);
        return true;
      }
      // The server lane is only reached when the server may transcode, so a block greys the
      // smaller sizes of a playable file and the sheet says why.
      const block = lane === "server" ? null : serverTranscodeBlock(details);
      const choices: SizeChoice[] = [];
      if (lane !== "server") choices.push({ text: sizeChoice(t("downloads.original"), sizeOf(details)), bytes: sizeOf(details) });
      for (const rung of downloadRungs(details, lane !== "server")) {
        const bytes = estimatedConvertedBytes(details, rung);
        choices.push({ text: sizeChoice(rung.label, bytes), bytes, convert: rung, disabled: block !== null });
      }

      // The one place a single press commits real storage, so every button carries its size.
      // An undeclared size admits itself rather than claiming zero.
      const offered = choices.filter((choice) => choice.bytes <= 0 || free - choice.bytes >= DISK_HEADROOM_BYTES);
      if (!offered.some((choice) => !choice.disabled)) {
        const smallest = Math.min(...choices.filter((choice) => !choice.disabled).map((choice) => choice.bytes));
        Alert.alert(t("downloads.notEnoughSpace"), t("downloads.needsSpace").replace("{size}", formatFileSize(smallest)).replace("{free}", formatFileSize(free)));
        return true;
      }
      const body = lane === "server" ? t("downloads.convertOnly") : t("downloads.chooseSize").replace("{free}", formatFileSize(free));
      const note = offered.some((choice) => choice.disabled) ? blockedSizesNote(block) : null;
      showSizeSheet(
        name,
        note ? `${body}\n\n${note}` : body,
        offered.map((choice) => ({ text: choice.text, disabled: choice.disabled, onPress: () => queue(choice.convert) })),
      );
      return true;
    } catch (error) {
      logger.warn("Download action failed", error, { service: "Downloads", itemId });
      return false;
    }
  }, [itemId, router, state]);

  return eligible ? { state, toggle } : { state: undefined, toggle: undefined };
}
