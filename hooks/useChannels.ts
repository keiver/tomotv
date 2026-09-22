import { fetchChannels } from "@/services/jellyfinApi";
import { channelSortParam, type ChannelSort } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

/** Channels per page: the wall carries no programmes, so its pages run larger than the guide's. */
export const CHANNEL_WALL_PAGE = 100;

export interface ChannelsState {
  items: JellyfinItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

/** The channel list a page at a time in the server's order for the sort; a new sort starts over. */
export function useChannels(sort: ChannelSort): ChannelsState {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const itemsRef = useRef<JellyfinItem[]>([]);
  const busyRef = useRef(false);
  // Bumped by every fresh load, so a page from the previous sort lands nowhere.
  const generationRef = useRef(0);

  const loadPage = useCallback(
    async (startIndex: number) => {
      const { items: page, total } = await fetchChannels({ startIndex, limit: CHANNEL_WALL_PAGE, sortBy: channelSortParam(sort) });
      const loaded = startIndex + page.length;
      return { page, hasMore: total !== undefined ? loaded < total : page.length >= CHANNEL_WALL_PAGE };
    },
    [sort],
  );

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;
    busyRef.current = true;
    loadPage(0)
      .then(({ page, hasMore: more }) => {
        if (cancelled) return;
        itemsRef.current = page;
        setItems(page);
        setHasMore(more);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error("Channels load failed", err, { hook: "useChannels" });
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (generationRef.current === generation) busyRef.current = false;
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, loadPage]);

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore || busyRef.current) return;
    const generation = generationRef.current;
    busyRef.current = true;
    setIsLoadingMore(true);
    loadPage(itemsRef.current.length)
      .then(({ page, hasMore: more }) => {
        if (generationRef.current !== generation) return;
        setHasMore(more);
        if (page.length === 0) return;
        itemsRef.current = itemsRef.current.concat(page);
        setItems(itemsRef.current);
      })
      .catch((err) => logger.warn("Channels page load failed", err, { hook: "useChannels" }))
      .finally(() => {
        if (generationRef.current === generation) busyRef.current = false;
        setIsLoadingMore(false);
      });
  }, [isLoading, hasMore, loadPage]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { items, isLoading, isLoadingMore, hasMore, error, loadMore, retry };
}
