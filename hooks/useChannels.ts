import { fetchChannels, fetchChannelsByIds, fetchListedChannels } from "@/services/jellyfinApi";
import { channelSortParam, type ChannelFavorite, type ChannelSort, type LiveTvCategory } from "@/services/liveTvPreferences";
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

/**
 * The channel list a page at a time in the server's order for the sort, held to a category when given.
 * A list (favorites, a group) comes in one fetch of its entries; playlist ids page in their order,
 * and "loading" waits for them. Any change starts over.
 */
export function useChannels(
  sort: ChannelSort,
  category: LiveTvCategory | null = null,
  list: readonly ChannelFavorite[] | null = null,
  ids: readonly string[] | "loading" | null = null,
): ChannelsState {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const itemsRef = useRef<JellyfinItem[]>([]);
  // Where the next page starts: ids the server does not know leave fewer items than ids consumed.
  const loadedRef = useRef(0);
  const busyRef = useRef(false);
  // Bumped by every fresh load, so a page from the previous sort lands nowhere.
  const generationRef = useRef(0);
  // A failed page holds isLoadingMore for a backoff, or the grid asks for it again at once.
  const pageFailuresRef = useRef(0);
  const pageBackoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPage = useCallback(
    async (startIndex: number) => {
      if (Array.isArray(ids)) {
        // Slices whose ids the server does not know come back empty; keep going until items or the end.
        let consumed = 0;
        let page: JellyfinItem[] = [];
        while (page.length === 0 && startIndex + consumed < ids.length) {
          const slice = ids.slice(startIndex + consumed, startIndex + consumed + CHANNEL_WALL_PAGE);
          page = await fetchChannelsByIds(slice);
          consumed += slice.length;
        }
        return { page, hasMore: startIndex + consumed < ids.length, consumed };
      }
      if (list) {
        const page = startIndex === 0 ? await fetchListedChannels(list) : [];
        return { page, hasMore: false, consumed: page.length };
      }
      const { items: page, total } = await fetchChannels({ startIndex, limit: CHANNEL_WALL_PAGE, sortBy: channelSortParam(sort), ...(category ? { category } : {}) });
      const loaded = startIndex + page.length;
      return { page, hasMore: total !== undefined ? loaded < total : page.length >= CHANNEL_WALL_PAGE, consumed: page.length };
    },
    [sort, category, list, ids],
  );

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;
    busyRef.current = true;
    pageFailuresRef.current = 0;
    if (pageBackoffRef.current) clearTimeout(pageBackoffRef.current);
    pageBackoffRef.current = null;
    // The ids still loading: the returned isLoading covers it without a state write.
    if (ids === "loading") return;
    loadPage(0)
      .then(({ page, hasMore: more, consumed }) => {
        if (cancelled) return;
        itemsRef.current = page;
        loadedRef.current = consumed;
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
        if (cancelled) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      });
    return () => {
      cancelled = true;
      if (pageBackoffRef.current) clearTimeout(pageBackoffRef.current);
      pageBackoffRef.current = null;
    };
  }, [attempt, loadPage, ids]);

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore || busyRef.current) return;
    const generation = generationRef.current;
    busyRef.current = true;
    setIsLoadingMore(true);
    loadPage(loadedRef.current)
      .then(({ page, hasMore: more, consumed }) => {
        if (generationRef.current !== generation) return;
        pageFailuresRef.current = 0;
        loadedRef.current += consumed;
        setHasMore(more);
        if (page.length === 0) return;
        itemsRef.current = itemsRef.current.concat(page);
        setItems(itemsRef.current);
      })
      .catch((err) => {
        if (generationRef.current === generation) pageFailuresRef.current += 1;
        logger.warn("Channels page load failed", err, { hook: "useChannels" });
      })
      .finally(() => {
        if (generationRef.current !== generation) return;
        const failures = pageFailuresRef.current;
        if (failures === 0) {
          busyRef.current = false;
          setIsLoadingMore(false);
          return;
        }
        pageBackoffRef.current = setTimeout(
          () => {
            pageBackoffRef.current = null;
            busyRef.current = false;
            setIsLoadingMore(false);
          },
          Math.min(30_000, 1_000 * 2 ** (failures - 1)),
        );
      });
  }, [isLoading, hasMore, loadPage]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { items, isLoading: isLoading || ids === "loading", isLoadingMore, hasMore, error, loadMore, retry };
}
