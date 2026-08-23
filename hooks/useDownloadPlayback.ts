import { usePlayQueue } from "@/contexts/PlayQueueContext";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { isAudioItem } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { shuffled } from "@/utils/shuffle";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";

/**
 * The items a queue can hold alongside `like`: complete, and the same kind.
 *
 * One kind per queue is not a preference. Audio plays through the native queue player and
 * video through the engine, so a mixed queue would advance into a player that cannot take it.
 */
function queueableWith(entries: DownloadEntry[], like: DownloadEntry): JellyfinVideoItem[] {
  const wantAudio = isAudioItem(like.item);
  return entries.filter((entry) => entry.state === "ready" && isAudioItem(entry.item) === wantAudio).map((entry) => entry.item);
}

/** Ready items of one kind, audio preferred: a mixed set shuffles as its music. */
function shuffleSet(entries: DownloadEntry[]): JellyfinVideoItem[] {
  const ready = entries.filter((entry) => entry.state === "ready");
  const audio = ready.filter((entry) => isAudioItem(entry.item));
  const chosen = audio.length > 0 ? audio : ready.filter((entry) => !isAudioItem(entry.item));
  return shuffled(chosen.map((entry) => entry.item));
}

/**
 * Starting playback from the Downloads screen, with a queue.
 *
 * Everything is built from the manifest's stored items rather than fetched: this is the one
 * screen that has to work with no server at all, so buildQueueFromItems is the only queue
 * builder it can use — buildQueue would go to the network for the folder's children.
 *
 * Shuffle is the queue's `loop` mode, which is what that flag has always meant here: a
 * shuffled set that wraps rather than stopping at the end.
 */
export function useDownloadPlayback() {
  const router = useRouter();
  const { buildQueueFromItems } = usePlayQueue();

  const start = useCallback(
    (items: JellyfinVideoItem[], startId: string, sourceId: string, sourceName: string, loop: boolean) => {
      if (items.length === 0) return;
      const first = items.find((item) => item.Id === startId) ?? items[0];
      buildQueueFromItems(items, sourceId, sourceName, first.Id, loop);
      router.push({
        pathname: isAudioItem(first) ? "/audio-player" : "/player",
        params: { videoId: first.Id, videoName: first.Name, queueMode: "true" },
      });
    },
    [buildQueueFromItems, router],
  );

  return useMemo(
    () => ({
      /**
       * Play one download, with the rest of its row behind it. `scope` is the folder it came
       * from, or the loose downloads it sits among: opening a track used to queue nothing, so
       * playback stopped dead at the end of it.
       */
      play(entry: DownloadEntry, scope: DownloadEntry[], sourceId: string, sourceName: string) {
        start(queueableWith(scope, entry), entry.itemId, sourceId, sourceName, false);
      },
      /** Shuffle a set, endlessly. Returns false when it holds nothing playable yet. */
      shuffle(scope: DownloadEntry[], sourceId: string, sourceName: string): boolean {
        const order = shuffleSet(scope);
        if (order.length === 0) return false;
        start(order, order[0].Id, sourceId, sourceName, true);
        return true;
      },
      /** Whether a shuffle would have anything to play. */
      canShuffle(scope: DownloadEntry[]): boolean {
        return scope.some((entry) => entry.state === "ready");
      },
    }),
    [start],
  );
}
