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
  /** 0 to 1 while bytes are landing, null when nothing is in flight or the size is unknown. */
  progress: number | null;
  toggle: (() => Promise<boolean>) | undefined;
}

interface Snapshot {
  state: DownloadCircleState;
  progress: number | null;
}

/** What the manager holds for one item right now. The manifest is the source of truth, so a */
/** panel closed and reopened mid-transfer reads the same numbers back. */
function read(itemId: string | undefined): Snapshot {
  const entry = itemId ? downloadManager.getState().entries.find((candidate) => candidate.itemId === itemId) : undefined;
  if (!entry) return { state: "none", progress: null };
  const known = entry.totalBytes > 0;
  return {
    state: entry.state,
    progress: entry.state === "ready" ? 1 : known ? Math.min(1, entry.bytesWritten / entry.totalBytes) : null,
  };
}

/**
 * The info panel's download circle: what state the item is in, how far along it is, and the
 * one press that moves it on. Folders and photos are excluded because neither has a file to
 * fetch: a container's children are separate items, and a photo is the image already on screen.
 */
export function useItemDownload(item: JellyfinItem | null): ItemDownload {
  const router = useRouter();
  const itemId = item?.Id;
  // Seeded from the manager rather than from "none": the panel remounts on every open, and a
  // first paint at zero would flash an empty ring over a transfer already half done.
  const [snapshot, setSnapshot] = useState<Snapshot>(() => read(itemId));
  const { state, progress } = snapshot;

  const eligible = !!item && downloadsSupported() && !isFolder(item) && !isPhoto(item);

  useEffect(() => {
    if (!eligible || !itemId) return;
    return downloadManager.subscribe(() => setSnapshot(read(itemId)));
  }, [eligible, itemId]);

  /**
   * One press starts the download, and that is the only thing this circle ever starts.
   *
   * Once an item is queued the circle becomes a way into the Downloads tab, where pausing and
   * deleting live. Making the same circle also cancel is how a second press, on a panel that
   * was not yet showing progress, threw the file away.
   */
  const toggle = useCallback(async (): Promise<boolean> => {
    if (!itemId) return false;
    if (state !== "none" && state !== "failed") {
      // Dismiss first: this panel is a presented modal on phone, and navigating out of one
      // is the same trap Show in Folder documents.
      router.back();
      router.push("/downloads");
      return true;
    }
    try {
      // The panel's own fetch answers for every item kind and therefore leads with
      // /Items/{id}, which carries no MediaSources. The download needs the size and the
      // container, so the playback fetch runs here.
      const details = await fetchVideoDetails(itemId);
      if (!details) return false;
      await downloadManager.enqueue(details);
      return true;
    } catch (error) {
      logger.warn("Download action failed", error, { service: "Downloads", itemId });
      return false;
    }
  }, [itemId, router, state]);

  return eligible ? { state, progress, toggle } : { state: undefined, progress: null, toggle: undefined };
}
