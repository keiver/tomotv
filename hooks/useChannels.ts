import { GUIDE_CHANNEL_PAGE } from "@/hooks/useGuide";
import { fetchChannels } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ChannelsState {
  items: JellyfinItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

/** The channel list a page at a time, the guide's page size, without the programmes the guide loads beside it. */
export function useChannels(): ChannelsState {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const itemsRef = useRef<JellyfinItem[]>([]);
  const busyRef = useRef(false);

  const loadPage = useCallback(async (startIndex: number) => {
    const { items: page, total } = await fetchChannels({ startIndex, limit: GUIDE_CHANNEL_PAGE });
    const loaded = startIndex + page.length;
    return { page, hasMore: total !== undefined ? loaded < total : page.length >= GUIDE_CHANNEL_PAGE };
  }, []);

  useEffect(() => {
    let cancelled = false;
    busyRef.current = true;
    loadPage(0)
      .then(({ page, hasMore: more }) => {
        if (cancelled) return;
        itemsRef.current = page;
        setItems(page);
        setHasMore(more);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error("Channels load failed", err, { hook: "useChannels" });
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        busyRef.current = false;
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, loadPage]);

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore || busyRef.current) return;
    busyRef.current = true;
    setIsLoadingMore(true);
    loadPage(itemsRef.current.length)
      .then(({ page, hasMore: more }) => {
        setHasMore(more);
        if (page.length === 0) return;
        itemsRef.current = itemsRef.current.concat(page);
        setItems(itemsRef.current);
      })
      .catch((err) => logger.warn("Channels page load failed", err, { hook: "useChannels" }))
      .finally(() => {
        busyRef.current = false;
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
