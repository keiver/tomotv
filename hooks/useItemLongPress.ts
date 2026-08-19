import { JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * Long press on any playable card opens the info panel, which hosts the item
 * actions. inFolderId marks the folder being viewed so the panel can hide
 * "Show in Folder" for items already there.
 */
export function useItemLongPress(inFolderId?: string) {
  const router = useRouter();

  return useCallback(
    (item: JellyfinItem) => {
      router.push({ pathname: "/video-info", params: { videoId: item.Id, name: item.Name, ...(inFolderId ? { inFolderId } : {}) } });
    },
    [router, inFolderId],
  );
}
