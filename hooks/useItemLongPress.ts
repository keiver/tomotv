import { JellyfinItem } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import { programInfoParams } from "@/utils/programInfo";
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
      // Keep the external listing: its synthetic id cannot be fetched from the server.
      if (item.Id.startsWith(EXTERNAL_GUIDE_PREFIX) && item.ChannelId) {
        router.push({ pathname: "/video-info", params: programInfoParams(item, { Id: item.ChannelId, Name: item.ChannelName ?? item.Name }) });
        return;
      }
      router.push({ pathname: "/video-info", params: { videoId: item.Id, name: item.Name, ...(inFolderId ? { inFolderId } : {}) } });
    },
    [router, inFolderId],
  );
}
