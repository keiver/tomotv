import { fetchCategoryChannelIds, fetchChannels, fetchChannelsByIds, fetchListedChannels, fillAiringFromGuides } from "@/services/jellyfinApi";
import { pendingChannelsAfter } from "@/services/jellyfin/playlistItems";
import { subscribeTunerDataRefreshed } from "@/services/jellyfin/tunerGroups";
import { channelSortParam, playlistGroupIds, type ChannelFavorite, type ChannelSort, type LiveTvCategory, type PlaylistEdit } from "@/services/liveTvPreferences";
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
 * The channel list a page at a time in the server's order for the sort.
 * A list (favorites, a group) comes in one fetch of its entries; playlist ids and a category's edited ids
 * page in their order, and "loading" waits for them. Any change starts over.
 */
export function useChannels(
  sort: ChannelSort,
  category: LiveTvCategory | null = null,
  list: readonly ChannelFavorite[] | null = null,
  ids: readonly string[] | "loading" | null = null,
  categoryEdit?: PlaylistEdit,
): ChannelsState {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The last page landed before the tuner playlists did: the next one is asked for here, since the grid may never reach its end.
  const [tailWaiting, setTailWaiting] = useState(false);
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
      const pageIds = Array.isArray(ids) ? ids : category ? playlistGroupIds(await fetchCategoryChannelIds(category, channelSortParam(sort)), categoryEdit) : null;
      if (pageIds) {
        // Slices whose ids the server does not know come back empty; keep going until items or the end.
        let consumed = 0;
        let page: JellyfinItem[] = [];
        while (page.length === 0 && startIndex + consumed < pageIds.length) {
          const slice = pageIds.slice(startIndex + consumed, startIndex + consumed + CHANNEL_WALL_PAGE);
          page = await fetchChannelsByIds(slice);
          consumed += slice.length;
        }
        return { page: await fillAiringFromGuides(page), hasMore: startIndex + consumed < pageIds.length, consumed, waiting: false };
      }
      if (list) {
        const page = startIndex === 0 ? await fetchListedChannels(list) : [];
        return { page, hasMore: false, consumed: page.length, waiting: false };
      }
      const { items: page, total } = await fetchChannels({ startIndex, limit: CHANNEL_WALL_PAGE, sortBy: channelSortParam(sort) });
      const loaded = startIndex + page.length;
      const hasMore = total !== undefined ? loaded < total : page.length >= CHANNEL_WALL_PAGE;
      if (!hasMore) {
        // The server catalog is done: channels only the tuner playlists carry yet follow, a page at a time.
        const tail = await pendingChannelsAfter(page, itemsRef.current, CHANNEL_WALL_PAGE);
        return { page: [...page, ...tail.pending], hasMore: tail.hasMore, consumed: page.length + tail.pending.length, waiting: tail.waiting };
      }
      return { page, hasMore, consumed: page.length, waiting: false };
    },
    [sort, category, categoryEdit, list, ids],
  );

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;
    busyRef.current = true;
    pageFailuresRef.current = 0;
    if (pageBackoffRef.current) clearTimeout(pageBackoffRef.current);
    pageBackoffRef.current = null;
    // A fresh load empties the wall and shows the loading state, so a filter pick reads at once.
    itemsRef.current = [];
    loadedRef.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems([]);
    setIsLoading(true);
    setHasMore(false);
    setTailWaiting(false);
    setError(null);
    // The ids still loading: the returned isLoading covers it without a state write.
    if (ids === "loading") return;
    loadPage(0)
      .then(({ page, hasMore: more, consumed, waiting }) => {
        if (cancelled) return;
        itemsRef.current = page;
        loadedRef.current = consumed;
        setItems(page);
        setHasMore(more);
        setTailWaiting(waiting);
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
      .then(({ page, hasMore: more, consumed, waiting }) => {
        if (generationRef.current !== generation) return;
        pageFailuresRef.current = 0;
        loadedRef.current += consumed;
        setHasMore(more);
        setTailWaiting(waiting);
        // A channel the server ingested since its stand-in landed comes back in a later page.
        const seen = new Set(itemsRef.current.map((item) => item.Id));
        const fresh = page.filter((item) => !seen.has(item.Id));
        if (fresh.length === 0) return;
        itemsRef.current = itemsRef.current.concat(fresh);
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

  useEffect(() => {
    if (tailWaiting) loadMore();
  }, [tailWaiting, loadMore]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  // A tuner playlist that arrived after playback can add playlist-only channels to the tail: the wall loads again.
  useEffect(() => subscribeTunerDataRefreshed(retry), [retry]);

  return { items, isLoading: isLoading || ids === "loading", isLoadingMore, hasMore, error, loadMore, retry };
}
