import type { DownloadCircleState } from "@/components/info-action-row";
import { downloadManager } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { fetchVideoDetails, isFolder, isPhoto } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

interface ItemDownload {
  /** undefined where a download cannot exist, which is what hides the circle. */
  state: DownloadCircleState | undefined;
  toggle: (() => Promise<boolean>) | undefined;
}

/** What the manager holds for one item right now; the manifest is the source of truth. */
function read(itemId: string | undefined): DownloadCircleState {
  const entry = itemId ? downloadManager.getState().entries.find((candidate) => candidate.itemId === itemId) : undefined;
  return entry?.state ?? "none";
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

  const eligible = !!item && downloadsSupported() && !isFolder(item) && !isPhoto(item);

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
    try {
      // The panel's own fetch answers for every item kind and therefore leads with
      // /Items/{id}, which carries no MediaSources. The download needs the size and the
      // container, so the playback fetch runs here. Awaited rather than left running behind
      // the push, so a server that refuses still reports on the panel.
      const details = await fetchVideoDetails(itemId);
      if (!details) return false;
      await downloadManager.enqueue(details);
      leave();
      return true;
    } catch (error) {
      logger.warn("Download action failed", error, { service: "Downloads", itemId });
      return false;
    }
  }, [itemId, router, state]);

  return eligible ? { state, toggle } : { state: undefined, toggle: undefined };
}
