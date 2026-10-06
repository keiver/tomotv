import { fetchRecursiveVideos, isAudioItem, isBook, isFolder, isLiveChannel, isPhoto } from "@/services/jellyfinApi";
import { containerKey } from "@/services/nextUp";
import { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

/** The videos of Play's queue, in its order, or null when the item is not among two or more of them. */
export function videoSiblings(item: JellyfinItem, queue: readonly JellyfinVideoItem[]): JellyfinVideoItem[] | null {
  const videos = queue.filter((entry) => !isAudioItem(entry));
  return videos.length > 1 && videos.some((entry) => entry.Id === item.Id) ? videos : null;
}

/** A video leaf: what Play would queue from its SeriesId ?? ParentId. */
export function isSwipeableVideo(item: JellyfinItem): boolean {
  return !isFolder(item) && !isPhoto(item) && !isBook(item) && !isLiveChannel(item) && !isAudioItem(item as JellyfinVideoItem) && item.Type !== "Program";
}

/**
 * What the info panel swipes through for a video: the same cached list Play builds its queue
 * from, so a series runs across its seasons. Null until loaded, and for anything that is not a video.
 */
export function useVideoSiblings(item: JellyfinItem | null): JellyfinVideoItem[] | null {
  const [loaded, setLoaded] = useState<{ itemId: string; videos: JellyfinVideoItem[] | null } | null>(null);
  const key = item && isSwipeableVideo(item) ? containerKey(item as JellyfinVideoItem) : undefined;

  useEffect(() => {
    if (!item || !key) return;
    let cancelled = false;
    fetchRecursiveVideos(key).then(
      (queue) => {
        if (!cancelled) setLoaded({ itemId: item.Id, videos: videoSiblings(item, queue) });
      },
      (error) => logger.warn("Video siblings failed to load", error, { service: "VideoInfo", videoId: item.Id }),
    );
    return () => {
      cancelled = true;
    };
  }, [item, key]);

  return item && loaded?.itemId === item.Id ? loaded.videos : null;
}
