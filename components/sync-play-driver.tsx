import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { fetchItemsByIds } from "@/services/jellyfinApi";
import { playQueueManager } from "@/services/playQueueManager";
import { subscribeDriver, SyncPlayQueueTarget } from "@/services/syncPlayManager";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";

/**
 * Turns the server's SyncPlay queue push into a real playback route. Renders nothing.
 * Lives at the root so it holds the router and the player session the manager cannot.
 */
export function SyncPlayDriver() {
  const router = useRouter();
  const pathname = usePathname();
  const { stopSession } = usePlayerSession();

  useEffect(() => {
    return subscribeDriver((event) => {
      if (event.kind === "stop") {
        stopSession();
        return;
      }
      void openGroupItem(event.target, pathname === "/player", router);
    });
  }, [pathname, router, stopSession]);

  return null;
}

async function openGroupItem(target: SyncPlayQueueTarget, onPlayer: boolean, router: ReturnType<typeof useRouter>): Promise<void> {
  const orderedIds = target.playlist.map((entry) => entry.ItemId);
  const current = orderedIds[target.playingItemIndex];
  if (!current) return;
  try {
    const fetched = await fetchItemsByIds(orderedIds);
    const byId = new Map(fetched.map((item) => [item.Id, item]));
    const items = orderedIds.map((id) => byId.get(id)).filter((item): item is JellyfinVideoItem => item !== undefined);
    const playing = byId.get(current);
    if (!playing) return;
    playQueueManager.buildQueueFromItems(items, "syncplay", "SyncPlay", playing.Id);
    const params = {
      videoId: playing.Id,
      videoName: playing.Name,
      queueMode: "true",
      ...(target.startPositionTicks ? { startTicks: String(target.startPositionTicks) } : {}),
    };
    if (onPlayer) {
      router.replace({ pathname: "/player" as const, params });
    } else {
      router.push({ pathname: "/player" as const, params });
    }
  } catch (error) {
    logger.warn("SyncPlay could not open the group's item", error, { service: "SyncPlay" });
  }
}
