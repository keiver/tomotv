import { fetchChannelRing, fetchFolderContents, fetchRecursiveVideos, fetchUserViews, isAudioItem, isBook, isFolder, isLiveChannel, isPhoto } from "@/services/jellyfinApi";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import { containerKey } from "@/services/nextUp";
import { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { ringWithCenter } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { orderSortNameTies } from "@/utils/seasonEpisode";
import { useEffect, useState } from "react";

const LISTING_PAGE = 500;

/**
 * Where an item's neighbours come from: Play's queue for a video, the library list for a library,
 * the parent's listing for a folder, the player's channel ring for a channel.
 */
export type SiblingSource = { kind: "queue"; key: string } | { kind: "libraries" } | { kind: "folder"; parentId: string } | { kind: "channels" };

export function siblingSource(item: JellyfinItem, inFolderId?: string): SiblingSource | null {
  if (item.Type === "CollectionFolder" || item.Type === "UserView") return { kind: "libraries" };
  if (isLiveChannel(item)) return { kind: "channels" };
  if (isFolder(item)) {
    const parentId = inFolderId ?? item.ParentId;
    return parentId ? { kind: "folder", parentId } : null;
  }
  if (isPhoto(item) || isBook(item) || isAudioItem(item as JellyfinVideoItem) || item.Type === "Program") return null;
  const key = containerKey(item as JellyfinVideoItem);
  return key ? { kind: "queue", key } : null;
}

/** The listed entries of the item's own kind (videos beside a video, folders beside a folder), or null when it has none. */
export function siblingsAround(item: JellyfinItem, source: SiblingSource, listed: readonly JellyfinItem[]): JellyfinItem[] | null {
  const kin = listed.filter((entry) => (source.kind === "queue" ? !isAudioItem(entry as JellyfinVideoItem) : source.kind === "folder" ? isFolder(entry) : true));
  return kin.length > 1 && kin.some((entry) => entry.Id === item.Id) ? kin : null;
}

/** The whole listing in the order its screen shows it. A channel from outside the shown list joins at the end, as a flip from it does. */
async function fetchListing(item: JellyfinItem, source: SiblingSource): Promise<JellyfinItem[]> {
  if (source.kind === "queue") return fetchRecursiveVideos(source.key);
  if (source.kind === "channels") return ringWithCenter(await fetchChannelRing(getLiveTvPreferences()), item);
  if (source.kind === "libraries") return (await fetchUserViews()).items;
  const items: JellyfinItem[] = [];
  for (;;) {
    const page = await fetchFolderContents(source.parentId, { limit: LISTING_PAGE, startIndex: items.length });
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= (page.total ?? items.length)) break;
  }
  return orderSortNameTies(items);
}

/**
 * What the info panel swipes through: a video walks Play's queue (a series across its seasons),
 * a folder its parent's folders, a library the libraries, a channel the guide's channels. Null
 * until loaded, and when there is none.
 */
export function useItemSiblings(item: JellyfinItem | null, inFolderId?: string): JellyfinItem[] | null {
  const [loaded, setLoaded] = useState<{ itemId: string; items: JellyfinItem[] | null } | null>(null);

  useEffect(() => {
    const source = item ? siblingSource(item, inFolderId) : null;
    if (!item || !source) return;
    let cancelled = false;
    fetchListing(item, source).then(
      (listed) => {
        if (!cancelled) setLoaded({ itemId: item.Id, items: siblingsAround(item, source, listed) });
      },
      (error) => logger.warn("Item siblings failed to load", error, { service: "VideoInfo", videoId: item.Id }),
    );
    return () => {
      cancelled = true;
    };
  }, [item, inFolderId]);

  return item && loaded?.itemId === item.Id ? loaded.items : null;
}
