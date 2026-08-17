import { FolderGridItem } from "@/components/folder-grid-item";
import { MediaShelf, ShelfCardMetrics } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { isFolder, subscribeFavoriteChange } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";

interface ItemShelfProps {
  title: string;
  /** Item source; null signals a transient failure and keeps the previous items on screen. */
  fetch: (limit?: number) => Promise<JellyfinItem[] | null>;
  /** Refetch when a heart is toggled anywhere in the app (the Favorites shelf). */
  refreshOnFavoriteChange?: boolean;
  /** Focus handler from the host screen — drives the poster backdrop. */
  onItemFocus?: (item: JellyfinItem, index: number) => void;
}

/**
 * Self-loading home shelf (New, Favorites): fetches on screen focus and renders nothing when
 * empty. Mixed-shape cards on one row height — each card snaps to its artwork's shape
 * (poster / square / wide) so nothing letterboxes. Container cards (Series, MusicAlbum...)
 * navigate into their browse screen, playable leaves play — the library grid's dispatch.
 */
export function ItemShelf({ title, fetch, refreshOnFavoriteChange = false, onItemFocus }: ItemShelfProps) {
  const openItem = useOpenShelfItem();
  const [items, setItems] = useState<JellyfinItem[]>([]);

  // Reload on every screen focus, like the Continue shelf. Only the newest load may write,
  // so a slow earlier response can't land its stale list on top of a fresh one.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let latestLoad = 0;

      const load = async () => {
        const loadId = ++latestLoad;
        const result = await fetch();
        // null = transient failure, which must not collapse a shelf that was showing items.
        if (cancelled || loadId !== latestLoad || result === null) return;
        setItems(result);
      };

      // Focus regain happens mid pop-transition; defer a tick to keep setState out of that commit.
      const interaction = setImmediate(() => {
        if (!cancelled) load();
      });
      const unsubscribe = refreshOnFavoriteChange ? subscribeFavoriteChange(() => load()) : undefined;

      return () => {
        cancelled = true;
        clearImmediate(interaction);
        unsubscribe?.();
      };
    }, [fetch, refreshOnFavoriteChange]),
  );

  const renderItem = useCallback(
    (item: JellyfinItem, index: number, metrics: ShelfCardMetrics) =>
      isFolder(item) ? (
        <FolderGridItem folder={item} onPress={openItem} index={index} onItemFocus={onItemFocus} cardHeight={metrics.cardHeight} fitArtwork slotOrientation="landscape" />
      ) : (
        <VideoGridItem video={item} onPress={openItem} index={index} onItemFocus={onItemFocus} cardHeight={metrics.cardHeight} fitArtwork slotOrientation="landscape" />
      ),
    [openItem, onItemFocus],
  );

  const keyExtractor = useCallback((item: JellyfinItem) => item.Id, []);

  return <MediaShelf title={title} orientation="landscape" data={items} renderItem={renderItem} keyExtractor={keyExtractor} />;
}
